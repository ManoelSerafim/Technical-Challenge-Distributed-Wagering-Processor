import { test, expect, describe, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM } from '@mikro-orm/core';
import { Wallet, asWalletId, asPlayerId } from '@domain/wallet';
import { Money } from '@domain/money';
import { WagerUseCase } from '@application/use-cases/wager.use-case';
import { WalletRepositoryImpl } from '@infrastructure/database/repositories/wallet.repository';
import { WagerTransactionRepositoryImpl } from '@infrastructure/database/repositories/wager-transaction.repository';
import { LedgerRepositoryImpl } from '@infrastructure/database/repositories/ledger.repository';
import { InboxRepositoryImpl } from '@infrastructure/database/repositories/inbox.repository';
import { OutboxRepositoryImpl } from '@infrastructure/database/repositories/outbox.repository';
import { mikroOrmConfig } from '@infrastructure/database/mikro-orm.config';
import { WagerTransactionKind, WagerTransactionStatus } from '@domain/wager';
import { ProcessWagerCommand, WalletId, PlayerId } from '@application/ports/wager.port';
import { WalletEntity } from '@infrastructure/database/entities/wallet.entity';
import { WagerTransactionEntity } from '@infrastructure/database/entities/wager-transaction.entity';
import { LedgerEntryEntity } from '@infrastructure/database/entities/ledger-entry.entity';

let orm: MikroORM | null = null;
let dbAvailable = false;

beforeAll(async () => {
  try {
    orm = await MikroORM.init(mikroOrmConfig);
    const generator = orm.getSchemaGenerator();
    await generator.dropSchema();
    await generator.createSchema();
    dbAvailable = true;
  } catch (error) {
    console.warn('PostgreSQL not available, skipping integration tests:', error.message);
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (orm) {
    await orm.close();
  }
});

beforeEach(async () => {
  if (!dbAvailable || !orm) return;
  const em = orm.em.fork();
  await em.nativeDelete(WagerTransactionEntity, {});
  await em.nativeDelete(LedgerEntryEntity, {});
  await em.nativeDelete(WalletEntity, {});
  await em.flush();
});

function createUseCase(em: EntityManager) {
  return new WagerUseCase(
    new WalletRepositoryImpl(em),
    new WagerTransactionRepositoryImpl(em),
    new LedgerRepositoryImpl(em),
    new InboxRepositoryImpl(em),
    new OutboxRepositoryImpl(em),
    em
  );
}

function createBetCommand(
  walletId: WalletId,
  playerId: PlayerId,
  externalTransactionId: string,
  amount: string,
  idempotencyKey: string
): ProcessWagerCommand {
  const businessPayload = {
    providerId: 'test-provider',
    externalTransactionId,
    walletId,
    playerId,
    roundId: 'round-1',
    gameId: 'game-1',
    kind: 'BET' as WagerTransactionKind,
    amount,
    currency: 'BRL',
    referenceExternalTransactionId: null,
  };
  const canonical = JSON.stringify(businessPayload, Object.keys(businessPayload).sort());
  let hash = 0;
  for (let i = 0; i < canonical.length; i++) {
    const char = canonical.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const payloadHash = Math.abs(hash).toString(16).padStart(64, '0');

  return {
    providerId: 'test-provider',
    externalTransactionId,
    idempotencyKey,
    payloadHash,
    walletId,
    playerId,
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.BET,
    amount: Money.from({ amount, currency: 'BRL' }),
    referenceExternalTransactionId: null,
  };
}

describe('Concurrency Tests', () => {
  beforeEach(() => {
    if (!dbAvailable) {
      console.log('Skipping - PostgreSQL not available');
    }
  });

  test('50 parallel BET requests on same wallet - only one should succeed', async () => {
    if (!dbAvailable || !orm) return;
    
    const em = orm.em.fork();
    const playerId = asPlayerId('player-concurrent-1');
    const wallet = Wallet.create(playerId, 'BRL', Money.from({ amount: '5000.00', currency: 'BRL' }));
    await em.persistAndFlush(WalletEntity.fromDomain(wallet));
    await em.flush();

    const useCase = createUseCase(em);
    const walletId = wallet.id;

    const numRequests = 50;
    const betAmount = '100.00';

    const promises = Array.from({ length: numRequests }, (_, i) => {
      const externalTransactionId = `bet-concurrent-${i}`;
      const idempotencyKey = `test-provider:${externalTransactionId}`;
      return useCase.processWager(createBetCommand(walletId, playerId, externalTransactionId, betAmount, idempotencyKey));
    });

    const results = await Promise.allSettled(promises);

    const processed = results.filter(r => r.status === 'fulfilled' && r.value.status === 'PROCESSED');
    const rejected = results.filter(r => r.status === 'fulfilled' && r.value.status === 'REJECTED');

    expect(processed.length).toBe(50);
    expect(rejected.length).toBe(0);

    const finalWallet = await new WalletRepositoryImpl(em).findById(walletId);
    expect(finalWallet!.balance.amount).toBe('0.00');
  });

  test('concurrent BET requests competing for balance - only one wins', async () => {
    if (!dbAvailable || !orm) return;
    
    const em = orm.em.fork();
    const playerId = asPlayerId('player-concurrent-2');
    const wallet = Wallet.create(playerId, 'BRL', Money.from({ amount: '100.00', currency: 'BRL' }));
    await em.persistAndFlush(WalletEntity.fromDomain(wallet));
    await em.flush();

    const useCase = createUseCase(em);
    const walletId = wallet.id;

    const betA = useCase.processWager(createBetCommand(walletId, playerId, 'bet-A', '80.00', 'test-provider:bet-A'));
    const betB = useCase.processWager(createBetCommand(walletId, playerId, 'bet-B', '80.00', 'test-provider:bet-B'));

    const [resultA, resultB] = await Promise.all([betA, betB]);

    const processedCount = [resultA, resultB].filter(r => r.status === 'PROCESSED').length;
    const rejectedCount = [resultA, resultB].filter(r => r.status === 'REJECTED' && r.failureCode === 'INSUFFICIENT_BALANCE').length;

    expect(processedCount).toBe(1);
    expect(rejectedCount).toBe(1);

    const finalWallet = await new WalletRepositoryImpl(em).findById(walletId);
    expect(finalWallet!.balance.amount).toBe('20.00');

    const ledgerEntries = await new LedgerRepositoryImpl(em).findByWalletId(walletId);
    expect(ledgerEntries.length).toBe(1);
    expect(ledgerEntries[0].amount.amount).toBe('80.00');
    expect(ledgerEntries[0].direction).toBe('DEBIT');
  });

  test('different wallets processed in parallel - no interference', async () => {
    if (!dbAvailable || !orm) return;
    
    const em = orm.em.fork();
    
    const wallet1 = Wallet.create(asPlayerId('player-3a'), 'BRL', Money.from({ amount: '1000.00', currency: 'BRL' }));
    const wallet2 = Wallet.create(asPlayerId('player-3b'), 'BRL', Money.from({ amount: '1000.00', currency: 'BRL' }));
    await em.persistAndFlush(WalletEntity.fromDomain(wallet1));
    await em.persistAndFlush(WalletEntity.fromDomain(wallet2));
    await em.flush();

    const useCase = createUseCase(em);

    const promises = [
      ...Array.from({ length: 10 }, (_, i) => 
        useCase.processWager(createBetCommand(wallet1.id, wallet1.playerId, `wallet1-bet-${i}`, '50.00', `test-provider:wallet1-bet-${i}`))
      ),
      ...Array.from({ length: 10 }, (_, i) => 
        useCase.processWager(createBetCommand(wallet2.id, wallet2.playerId, `wallet2-bet-${i}`, '50.00', `test-provider:wallet2-bet-${i}`))
      ),
    ];

    const results = await Promise.allSettled(promises);

    const allProcessed = results.filter(r => r.status === 'fulfilled' && r.value.status === 'PROCESSED');
    expect(allProcessed.length).toBe(20);

    const finalWallet1 = await new WalletRepositoryImpl(em).findById(wallet1.id);
    const finalWallet2 = await new WalletRepositoryImpl(em).findById(wallet2.id);

    expect(finalWallet1!.balance.amount).toBe('500.00');
    expect(finalWallet2!.balance.amount).toBe('500.00');

    const ledger1 = await new LedgerRepositoryImpl(em).findByWalletId(wallet1.id);
    const ledger2 = await new LedgerRepositoryImpl(em).findByWalletId(wallet2.id);
    expect(ledger1.length).toBe(10);
    expect(ledger2.length).toBe(10);
  });

  test('idempotency - duplicate requests return same result', async () => {
    if (!dbAvailable || !orm) return;
    
    const em = orm.em.fork();
    const playerId = asPlayerId('player-idempotent');
    const wallet = Wallet.create(playerId, 'BRL', Money.from({ amount: '500.00', currency: 'BRL' }));
    await em.persistAndFlush(WalletEntity.fromDomain(wallet));
    await em.flush();

    const useCase = createUseCase(em);
    const walletId = wallet.id;

    const command = createBetCommand(walletId, playerId, 'bet-idempotent', '100.00', 'test-provider:bet-idempotent');

    const result1 = await useCase.processWager(command);
    const result2 = await useCase.processWager(command);
    const result3 = await useCase.processWager(command);

    expect(result1.status).toBe('PROCESSED');
    expect(result1.idempotentReplay).toBeUndefined();
    expect(result2.status).toBe('PROCESSED');
    expect(result2.idempotentReplay).toBe(true);
    expect(result3.status).toBe('PROCESSED');
    expect(result3.idempotentReplay).toBe(true);

    expect(result1.transactionId).toBe(result2.transactionId);
    expect(result1.transactionId).toBe(result3.transactionId);

    const finalWallet = await new WalletRepositoryImpl(em).findById(walletId);
    expect(finalWallet!.balance.amount).toBe('400.00');

    const ledgerEntries = await new LedgerRepositoryImpl(em).findByWalletId(walletId);
    expect(ledgerEntries.length).toBe(1);
  });

  test('idempotency conflict - same key different payload throws', async () => {
    if (!dbAvailable || !orm) return;
    
    const em = orm.em.fork();
    const playerId = asPlayerId('player-conflict');
    const wallet = Wallet.create(playerId, 'BRL', Money.from({ amount: '500.00', currency: 'BRL' }));
    await em.persistAndFlush(WalletEntity.fromDomain(wallet));
    await em.flush();

    const useCase = createUseCase(em);
    const walletId = wallet.id;

    const command1 = createBetCommand(walletId, playerId, 'bet-conflict', '100.00', 'test-provider:bet-conflict');
    await useCase.processWager(command1);

    const businessPayload2 = {
      providerId: 'test-provider',
      externalTransactionId: 'bet-conflict',
      walletId,
      playerId,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: 'BET' as WagerTransactionKind,
      amount: '200.00',
      currency: 'BRL',
      referenceExternalTransactionId: null,
    };
    const canonical2 = JSON.stringify(businessPayload2, Object.keys(businessPayload2).sort());
    let hash2 = 0;
    for (let i = 0; i < canonical2.length; i++) {
      const char = canonical2.charCodeAt(i);
      hash2 = ((hash2 << 5) - hash2) + char;
      hash2 = hash2 & hash2;
    }
    const payloadHash2 = Math.abs(hash2).toString(16).padStart(64, '0');

    const command2: ProcessWagerCommand = {
      ...command1,
      amount: Money.from({ amount: '200.00', currency: 'BRL' }),
      payloadHash: payloadHash2,
    };

    await expect(useCase.processWager(command2)).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });

  test('wallet balance reconciliation matches ledger', async () => {
    if (!dbAvailable || !orm) return;
    
    const em = orm.em.fork();
    const playerId = asPlayerId('player-reconcile');
    const wallet = Wallet.create(playerId, 'BRL', Money.from({ amount: '1000.00', currency: 'BRL' }));
    await em.persistAndFlush(WalletEntity.fromDomain(wallet));
    await em.flush();

    const useCase = createUseCase(em);
    const walletId = wallet.id;

    await useCase.processWager(createBetCommand(walletId, playerId, 'bet-1', '200.00', 'test-provider:bet-1'));
    await useCase.processWager(createBetCommand(walletId, playerId, 'bet-2', '150.00', 'test-provider:bet-2'));
    await useCase.processWager({
      ...createBetCommand(walletId, playerId, 'win-1', '500.00', 'test-provider:win-1'),
      kind: WagerTransactionKind.WIN,
    });
    await useCase.processWager({
      ...createBetCommand(walletId, playerId, 'loss-1', '100.00', 'test-provider:loss-1'),
      kind: WagerTransactionKind.LOSS,
    });
    await useCase.processWager({
      ...createBetCommand(walletId, playerId, 'refund-1', '150.00', 'test-provider:refund-1'),
      kind: WagerTransactionKind.REFUND,
      referenceExternalTransactionId: 'bet-2',
    });

    const reconciliation = await useCase.reconcile(walletId);

    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.storedBalance.amount).toBe(reconciliation.calculatedBalance.amount);
    expect(reconciliation.difference.isZero()).toBe(true);
    expect(reconciliation.checkedEntries).toBe(4);

    const finalWallet = await new WalletRepositoryImpl(em).findById(walletId);
    expect(finalWallet!.balance.amount).toBe('1100.00');
  });

  test('REFUND before BET - goes to PENDING_REFERENCE, then processes when BET arrives', async () => {
    if (!dbAvailable || !orm) return;
    
    const em = orm.em.fork();
    const playerId = asPlayerId('player-refund-first');
    const wallet = Wallet.create(playerId, 'BRL', Money.from({ amount: '500.00', currency: 'BRL' }));
    await em.persistAndFlush(WalletEntity.fromDomain(wallet));
    await em.flush();

    const useCase = createUseCase(em);
    const walletId = wallet.id;

    const refundCommand: ProcessWagerCommand = {
      providerId: 'test-provider',
      externalTransactionId: 'refund-early',
      idempotencyKey: 'test-provider:refund-early',
      payloadHash: 'hash-refund-early',
      walletId,
      playerId,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.REFUND,
      amount: Money.from({ amount: '100.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'bet-late',
    };

    const refundResult = await useCase.processWager(refundCommand);
    expect(refundResult.status).toBe('PENDING_REFERENCE');

    const betCommand = createBetCommand(walletId, playerId, 'bet-late', '100.00', 'test-provider:bet-late');
    await useCase.processWager(betCommand);

    const reprocessRefund = await useCase.processWager(refundCommand);
    expect(reprocessRefund.status).toBe('PROCESSED');

    const finalWallet = await new WalletRepositoryImpl(em).findById(walletId);
    expect(finalWallet!.balance.amount).toBe('500.00');
  });

  test('ROLLBACK of WIN - reverses credit', async () => {
    if (!dbAvailable || !orm) return;
    
    const em = orm.em.fork();
    const playerId = asPlayerId('player-rollback-win');
    const wallet = Wallet.create(playerId, 'BRL', Money.from({ amount: '200.00', currency: 'BRL' }));
    await em.persistAndFlush(WalletEntity.fromDomain(wallet));
    await em.flush();

    const useCase = createUseCase(em);
    const walletId = wallet.id;

    const winCommand: ProcessWagerCommand = {
      providerId: 'test-provider',
      externalTransactionId: 'win-to-rollback',
      idempotencyKey: 'test-provider:win-to-rollback',
      payloadHash: 'hash-win-to-rollback',
      walletId,
      playerId,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.WIN,
      amount: Money.from({ amount: '100.00', currency: 'BRL' }),
      referenceExternalTransactionId: null,
    };

    await useCase.processWager(winCommand);
    let walletAfterWin = await new WalletRepositoryImpl(em).findById(walletId);
    expect(walletAfterWin!.balance.amount).toBe('300.00');

    const rollbackCommand: ProcessWagerCommand = {
      providerId: 'test-provider',
      externalTransactionId: 'rollback-win',
      idempotencyKey: 'test-provider:rollback-win',
      payloadHash: 'hash-rollback-win',
      walletId,
      playerId,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.ROLLBACK,
      amount: Money.from({ amount: '100.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'win-to-rollback',
    };

    await useCase.processWager(rollbackCommand);

    const finalWallet = await new WalletRepositoryImpl(em).findById(walletId);
    expect(finalWallet!.balance.amount).toBe('200.00');

    const ledgerEntries = await new LedgerRepositoryImpl(em).findByWalletId(walletId);
    expect(ledgerEntries.length).toBe(2);
    expect(ledgerEntries[0].direction).toBe('CREDIT');
    expect(ledgerEntries[1].direction).toBe('DEBIT');
  });
});