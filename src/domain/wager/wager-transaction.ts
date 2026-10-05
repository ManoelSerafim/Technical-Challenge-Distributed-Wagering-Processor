export enum WagerTransactionKind {
  OPENING = 'OPENING',
  BET = 'BET',
  WIN = 'WIN',
  LOSS = 'LOSS',
  REFUND = 'REFUND',
  ROLLBACK = 'ROLLBACK',
}

export enum WagerTransactionStatus {
  PENDING = 'PENDING',
  PENDING_REFERENCE = 'PENDING_REFERENCE',
  PROCESSED = 'PROCESSED',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
}

export interface WagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string | null;
  gameId: string | null;
  kind: WagerTransactionKind;
  amount: string;
  currency: string;
  referenceExternalTransactionId: string | null;
  referenceTransactionId: string | null;
  status: WagerTransactionStatus;
  failureCode: string | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class WagerTransaction {
  private readonly _id: string;
  private readonly _providerId: string;
  private readonly _externalTransactionId: string;
  private readonly _idempotencyKey: string;
  private readonly _payloadHash: string;
  private readonly _walletId: string;
  private readonly _playerId: string;
  private readonly _roundId: string | null;
  private readonly _gameId: string | null;
  private readonly _kind: WagerTransactionKind;
  private readonly _amount: string;
  private readonly _currency: string;
  private readonly _referenceExternalTransactionId: string | null;
  private _referenceTransactionId: string | null;
  private _status: WagerTransactionStatus;
  private _failureCode: string | null;
  private _processedAt: Date | null;
  private readonly _createdAt: Date;
  private _updatedAt: Date;

  private constructor(props: WagerTransactionProps) {
    this._id = props.id;
    this._providerId = props.providerId;
    this._externalTransactionId = props.externalTransactionId;
    this._idempotencyKey = props.idempotencyKey;
    this._payloadHash = props.payloadHash;
    this._walletId = props.walletId;
    this._playerId = props.playerId;
    this._roundId = props.roundId;
    this._gameId = props.gameId;
    this._kind = props.kind;
    this._amount = props.amount;
    this._currency = props.currency;
    this._referenceExternalTransactionId = props.referenceExternalTransactionId;
    this._referenceTransactionId = props.referenceTransactionId;
    this._status = props.status;
    this._failureCode = props.failureCode;
    this._processedAt = props.processedAt;
    this._createdAt = props.createdAt;
    this._updatedAt = props.updatedAt;
  }

  static create(props: {
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    payloadHash: string;
    walletId: string;
    playerId: string;
    roundId: string | null;
    gameId: string | null;
    kind: WagerTransactionKind;
    amount: string;
    currency: string;
    referenceExternalTransactionId: string | null;
  }): WagerTransaction {
    const now = new Date();
    const requiresReference = [WagerTransactionKind.REFUND, WagerTransactionKind.ROLLBACK].includes(props.kind);

    return new WagerTransaction({
      id: crypto.randomUUID(),
      providerId: props.providerId,
      externalTransactionId: props.externalTransactionId,
      idempotencyKey: props.idempotencyKey,
      payloadHash: props.payloadHash,
      walletId: props.walletId,
      playerId: props.playerId,
      roundId: props.roundId,
      gameId: props.gameId,
      kind: props.kind,
      amount: props.amount,
      currency: props.currency.toUpperCase(),
      referenceExternalTransactionId: props.referenceExternalTransactionId,
      referenceTransactionId: null,
      status: requiresReference ? WagerTransactionStatus.PENDING_REFERENCE : WagerTransactionStatus.PENDING,
      failureCode: null,
      processedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static rehydrate(props: WagerTransactionProps): WagerTransaction {
    return new WagerTransaction(props);
  }

  get id(): string {
    return this._id;
  }

  get providerId(): string {
    return this._providerId;
  }

  get externalTransactionId(): string {
    return this._externalTransactionId;
  }

  get idempotencyKey(): string {
    return this._idempotencyKey;
  }

  get payloadHash(): string {
    return this._payloadHash;
  }

  get walletId(): string {
    return this._walletId;
  }

  get playerId(): string {
    return this._playerId;
  }

  get roundId(): string | null {
    return this._roundId;
  }

  get gameId(): string | null {
    return this._gameId;
  }

  get kind(): WagerTransactionKind {
    return this._kind;
  }

  get amount(): string {
    return this._amount;
  }

  get currency(): string {
    return this._currency;
  }

  get referenceExternalTransactionId(): string | null {
    return this._referenceExternalTransactionId;
  }

  get referenceTransactionId(): string | null {
    return this._referenceTransactionId;
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get failureCode(): string | null {
    return this._failureCode;
  }

  get processedAt(): Date | null {
    return this._processedAt;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  isTerminal(): boolean {
    return [
      WagerTransactionStatus.PROCESSED,
      WagerTransactionStatus.REJECTED,
      WagerTransactionStatus.FAILED,
    ].includes(this._status);
  }

  setReferenceTransactionId(referenceTransactionId: string): void {
    if (this._referenceTransactionId !== null) {
      throw new Error('Reference transaction already set');
    }
    this._referenceTransactionId = referenceTransactionId;
    this._status = WagerTransactionStatus.PENDING;
    this._updatedAt = new Date();
  }

  markProcessed(): void {
    if (this.isTerminal()) {
      throw new Error('Cannot process a terminal transaction');
    }
    this._status = WagerTransactionStatus.PROCESSED;
    this._processedAt = new Date();
    this._updatedAt = new Date();
  }

  markRejected(failureCode: string): void {
    if (this.isTerminal()) {
      throw new Error('Cannot reject a terminal transaction');
    }
    this._status = WagerTransactionStatus.REJECTED;
    this._failureCode = failureCode;
    this._processedAt = new Date();
    this._updatedAt = new Date();
  }

  markFailed(failureCode: string): void {
    if (this.isTerminal()) {
      throw new Error('Cannot fail a terminal transaction');
    }
    this._status = WagerTransactionStatus.FAILED;
    this._failureCode = failureCode;
    this._processedAt = new Date();
    this._updatedAt = new Date();
  }

  toSnapshot(): WagerTransactionProps {
    return {
      id: this._id,
      providerId: this._providerId,
      externalTransactionId: this._externalTransactionId,
      idempotencyKey: this._idempotencyKey,
      payloadHash: this._payloadHash,
      walletId: this._walletId,
      playerId: this._playerId,
      roundId: this._roundId,
      gameId: this._gameId,
      kind: this._kind,
      amount: this._amount,
      currency: this._currency,
      referenceExternalTransactionId: this._referenceExternalTransactionId,
      referenceTransactionId: this._referenceTransactionId,
      status: this._status,
      failureCode: this._failureCode,
      processedAt: this._processedAt,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
    };
  }
}