# Arquitetura — Distributed Wagering Processor

## 1. Visão Geral

O **Distributed Wagering Processor** é um serviço financeiro distribuído responsável por processar transações de apostas recebidas de múltiplos provedores de jogos.

O sistema deve preservar a correção financeira mesmo diante de:
- mensagens duplicadas;
- mensagens entregues fora de ordem;
- processamento concorrente;
- múltiplas instâncias da aplicação;
- falhas de processo antes ou depois de commits;
- redelivery de mensagens;
- indisponibilidade temporária do PostgreSQL ou SQS.

O objetivo principal da arquitetura é preservar os seguintes invariantes:

1. Uma operação financeira não pode produzir débito ou crédito duplicado.
2. O saldo de uma wallet nunca pode ficar negativo.
3. Toda alteração de saldo deve possuir um lançamento correspondente no ledger.
4. O ledger é imutável.
5. O saldo materializado deve ser reconciliável com o ledger.
6. A idempotência deve sobreviver ao reinício da aplicação.
7. A solução deve permanecer correta com múltiplas instâncias.
8. Eventos de integração não podem ser publicados antes do commit financeiro.

---

## 2. Stack Tecnológica

| Componente | Tecnologia |
|------------|------------|
| Runtime | Bun 1.x |
| Linguagem | TypeScript strict |
| Framework | NestJS |
| Banco de dados | PostgreSQL |
| ORM | MikroORM |
| Mensageria | AWS SQS |
| Ambiente local de mensageria | LocalStack |
| Orquestração | Docker Compose |
| Testes | Bun test runner |
| Migrations | MikroORM migrations |

---

## 3. Princípios Arquiteturais

### 3.1 Domain-First

As regras financeiras não devem depender de NestJS, MikroORM ou SQS.

O domínio deve ser capaz de representar e validar:
- dinheiro;
- wallet;
- transações de aposta;
- lançamentos do ledger;
- estados e transições;
- regras de reversão.

Infraestrutura será responsável por persistência, transporte e integração.

---

### 3.2 Banco como Última Linha de Defesa

As invariantes críticas não serão protegidas somente pelo código da aplicação.

O PostgreSQL também será responsável por garantir:
- unicidade;
- relacionamentos;
- valores válidos;
- não-negatividade quando aplicável;
- integridade dos registros.

Isso é especialmente importante porque múltiplas instâncias podem executar operações simultaneamente.

---

### 3.3 Dinheiro Nunca Será Representado por `number`

Valores monetários serão recebidos e serializados como strings decimais:

```json
{
  "amount": "25.00",
  "currency": "BRL"
}
```

O domínio utilizará uma abstração `Money` imutável.

A implementação deverá utilizar representação decimal exata, sem `number`, `float` ou `double`.

---

## 4. Arquitetura em Alto Nível

```text
                       ┌──────────────────────┐
                       │   Game Providers     │
                       └──────────┬───────────┘
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │     HTTP API         │
                       │       NestJS         │
                       └──────────┬───────────┘
                                  │
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │   Wager Use Case     │
                       └──────────┬───────────┘
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │     PostgreSQL       │
                       │                      │
                       │ Wallet               │
                       │ WagerTransaction     │
                       │ Ledger               │
                       │ Inbox                │
                       │ Outbox               │
                       └──────────┬───────────┘
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │    Outbox Worker     │
                       └──────────┬───────────┘
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │       AWS SQS        │
                       └──────────┬───────────┘
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │   Wager Worker(s)    │
                       │                      │
                       │ Inbox + Use Case     │
                       └──────────┬───────────┘
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │     PostgreSQL       │
                       └──────────────────────┘
```

HTTP e SQS utilizarão o mesmo caso de uso financeiro.

Isso evita que existam duas implementações diferentes das regras de negócio.

---

## 5. Organização da Aplicação

A estrutura inicial proposta é:

```text
src/
├── domain/
│   ├── money/
│   ├── wallet/
│   ├── wager/
│   ├── ledger/
│   ├── inbox/
│   └── outbox/
│
├── application/
│   ├── use-cases/
│   └── ports/
│
├── infrastructure/
│   ├── database/
│   │   ├── entities/
│   │   ├── repositories/
│   │   └── migrations/
│   │
│   ├── messaging/
│   │   ├── sqs/
│   │   ├── consumers/
│   │   └── publishers/
│   │
│   └── observability/
│
├── interfaces/
│   └── http/
│       ├── wallets/
│       ├── wagering/
│       └── health/
│
└── main.ts
```

A separação acima representa responsabilidades, e não necessariamente uma obrigação de quantidade exata de arquivos.

---

## 6. Modelo de Domínio

### 6.1 Money

`Money` será um Value Object imutável.

Responsabilidades:
- representar valor decimal;
- representar moeda;
- realizar operações aritméticas;
- impedir operações entre moedas diferentes;
- validar escala;
- impedir valores inválidos.

Interface conceitual:

```typescript
Money.from({
  amount: "25.00",
  currency: "BRL"
});

money.add(other);
money.subtract(other);
money.negate();

money.isZero();
money.isPositive();
money.isNegative();
money.isLessThan(other);
money.equals(other);
```

A escala será de duas casas decimais.

O sistema poderá assumir BRL para o processamento do desafio, mas o modelo continuará contendo a moeda.

---

### 6.2 Wallet

`Wallet` será o Aggregate Root responsável pelo saldo do jogador.

Estado conceitual:

```text
Wallet
├── id
├── playerId
├── currency
├── balance
├── version
├── createdAt
└── updatedAt
```

Invariantes:
- somente uma wallet para cada `playerId + currency`;
- saldo nunca negativo;
- moeda da operação deve corresponder à moeda da wallet;
- alteração de saldo precisa possuir lançamento correspondente;
- operações concorrentes não podem causar lost update;
- `version` começa em `1`;
- `version` aumenta somente quando o saldo muda.

A wallet será reconstruída do banco através de uma factory `rehydrate`.

---

### 6.3 WagerTransaction

Representa uma operação recebida do provedor.

Tipos:

```text
OPENING
BET
WIN
LOSS
REFUND
ROLLBACK
```

`OPENING` é uma operação interna utilizada para registrar o saldo inicial da wallet.

Estados:

```text
PENDING
PENDING_REFERENCE
PROCESSED
REJECTED
FAILED
```

Os estados:

```text
PROCESSED
REJECTED
FAILED
```

são terminais.

Uma operação em estado terminal não pode ser processada novamente como uma nova transição de domínio.

---

### 6.4 Regras Financeiras

| Operação | Saldo | Ledger |
|----------|-------|--------|
| BET | débito | DEBIT |
| WIN | crédito | CREDIT |
| LOSS | nenhum efeito | nenhum |
| REFUND | crédito | CREDIT |
| ROLLBACK | inversão da referência | entrada invertida |

#### BET
Uma aposta debita o saldo. Se o saldo for insuficiente → `REJECTED`. Nenhum lançamento financeiro é criado.

#### WIN
Um `WIN` credita o saldo. Pode possuir uma referência à `BET` da mesma rodada.

#### LOSS
Não altera o saldo. Ainda assim, a transação pode atingir `PROCESSED` e gerar o evento correspondente.

#### REFUND
- exige referência;
- referencia uma `BET`;
- deve possuir o mesmo valor da referência;
- credita o valor de volta;
- só pode ocorrer uma vez para aquela referência.

#### ROLLBACK
- exige referência;
- pode referenciar `BET`, `WIN` ou `REFUND`;
- utiliza o mesmo valor da referência;
- aplica o efeito inverso;
- só pode ocorrer uma vez para aquela referência pelo mesmo tipo de operação.

Uma reversão que produziria saldo negativo será rejeitada explicitamente.

---

### 6.5 Idempotência

A idempotência será garantida no banco de dados.

A fonte de verdade da idempotência HTTP será o header:

```http
Idempotency-Key: provider-a:transaction-123
```

A chave recomendada é:
```
{providerId}:{externalTransactionId}
```

Cada operação também terá:
```
payloadHash
```

O hash será calculado a partir de um JSON canônico contendo os campos de negócio. Headers e metadados de transporte não fazem parte do hash.

**Replay**: Se a mesma chave chegar novamente com o mesmo payload → retornar resultado original com `"idempotentReplay": true`.

**Conflito**: Se a mesma chave chegar com payload diferente → `CONFLICT` (409). A garantia final será implementada por constraints e índices no PostgreSQL.

---

### 6.6 Concorrência

A unidade de concorrência será a: `walletId`

A estratégia inicial será **pessimistic locking por wallet**.

Durante uma operação financeira, a wallet será bloqueada dentro de uma transação SQL:

```text
BEGIN
SELECT wallet FOR UPDATE
processar regra financeira
atualizar saldo
criar ledger
atualizar transaction
criar outbox
COMMIT
```

O lock será aplicado somente à wallet envolvida. Wallets diferentes poderão continuar sendo processadas em paralelo. Não será utilizado lock global da aplicação.

#### Exemplo de Concorrência

Estado inicial: `Wallet balance = 100.00 BRL`

Duas apostas chegam simultaneamente: `BET A = 80.00`, `BET B = 80.00`

O banco serializa as operações sobre a mesma wallet.
- Primeira: `100 - 80 = 20` → PROCESSED
- Segunda: `20 - 80` → REJECTED (INSUFFICIENT_BALANCE)

Estado final: `balance = 20.00`, Ledger: `1 x DEBIT 80.00`
Resultado: `BET A → PROCESSED`, `BET B → REJECTED`

---

### 6.7 Transação Financeira Atômica

Uma operação financeira seguirá conceitualmente:

```text
BEGIN
1. carregar e bloquear Wallet
2. validar operação
3. validar idempotência
4. aplicar alteração no domínio
5. atualizar Wallet
6. criar LedgerEntry
7. atualizar WagerTransaction
8. criar OutboxMessage
COMMIT
```

Se qualquer etapa falhar → `ROLLBACK`. Nenhuma alteração parcial poderá permanecer.

---

### 6.8 Ledger

O ledger será imutável.

Um lançamento conterá:
```text
id, walletId, transactionId, direction, money, balanceBefore, balanceAfter, createdAt
```

Exemplo:
```text
balanceBefore = 100.00
direction     = DEBIT
money         = 25.00
balanceAfter  = 75.00
```

A factory do ledger verificará:
- Para débitos: `balanceBefore - money == balanceAfter`
- Para créditos: `balanceBefore + money == balanceAfter`

Não existirão operações de atualização ou exclusão de lançamentos.

---

### 6.9 Reconciliação

Endpoint: `POST /wallets/:walletId/reconciliation`

Calcula o saldo através dos lançamentos do ledger e compara com o saldo materializado da wallet.

Resultado:
```text
storedBalance, calculatedBalance, difference, consistent, checkedEntries
```

Uma divergência não será corrigida automaticamente. Será registrada em log, gerará métrica e será retornada na resposta.

---

### 6.10 Processamento HTTP

```text
HTTP Request → Controller → DTO Validation → Application Use Case → Database Transaction (Wallet, WagerTransaction, Ledger, Outbox) → HTTP Response
```

O controller não conterá regras financeiras. Apenas: recebe requisição, valida contrato, cria contexto, chama use case, traduz resultado para HTTP.

---

### 6.11 Processamento Assíncrono (SQS)

Fila principal: `wager-transactions.fifo`
DLQ: `wager-transactions-dlq.fifo`

O worker não implementa regras financeiras próprias. Utiliza o mesmo use case da API HTTP.

```text
SQS → Consumer → Inbox → Wager Use Case → PostgreSQL
```

---

### 6.12 Inbox

Deduplicação persistente para mensagens SQS.

Chave lógica: `consumerName + messageId`

Estado: `received`, `processedAt`, `payloadHash`

Fluxo:
```text
Mensagem SQS → registrar Inbox → processar operação → commit → ack
```

O registro da Inbox, a operação financeira e a Outbox participam da mesma transação SQL.

Se a mensagem for redelivered:
```text
Inbox já processada → não repetir efeito financeiro → ack
```

---

### 6.13 ACK e Falhas

O ACK ocorrerá **somente depois do commit**.

Fluxo correto:
```text
processar → COMMIT → ACK
```

Se o processo morrer depois do commit e antes do ACK:
```text
COMMIT → processo morre → SQS redelivers → Inbox detecta duplicata → efeito financeiro não é repetido
```

---

### 6.14 Mensagens Fora de Ordem

Operações que dependem de uma referência que ainda não existe → `PENDING_REFERENCE`.

Exemplo: `REFUND BET-123` chega antes de `BET-123` → `PENDING_REFERENCE`.

Um worker agendado tentará novamente com backoff exponencial até limite de tentativas → `REJECTED`.

---

### 6.15 Transactional Outbox

A aplicação não publicará eventos diretamente no SQS antes do commit.

```text
Database Transaction → Wallet, WagerTransaction, Ledger, Outbox
Commit → Outbox Worker → SQS
```

Isso evita: `Banco COMMIT → processo morre → evento perdido`

Com Outbox: `Banco COMMIT → evento persistido → processo morre → outro worker continua → evento publicado`

---

### 6.16 Concorrência da Outbox

Múltiplos publishers processam a Outbox simultaneamente.

Estratégia: `SELECT ... FOR UPDATE SKIP LOCKED` no PostgreSQL.

Permite: `Publisher 1 → A, B`, `Publisher 2 → C, D`, `Publisher 3 → E, F` simultaneamente.

Publicação duplicada é possível (at-least-once). Consumidores usam `eventId` para idempotência.

---

### 6.17 Eventos

Eventos mínimos:
- `WagerTransactionProcessed`
- `WagerTransactionRejected`
- `WalletBalanceChanged`
- `WagerTransactionPendingReference`

`WalletBalanceChanged` só quando o saldo realmente mudar.

Envelope versionado:
```text
eventId, eventType, aggregateId, correlationId, causationId, occurredAt, version, data
```

Valores monetários continuam como strings decimais.

---

### 6.18 Retry e DLQ

**Erro de negócio** (saldo insuficiente, referência inválida, moeda incompatível, payload conflitante): Terminais, não geram retries infinitos. Mensagem confirmada, transação fica como `REJECTED`.

**Erro transitório** (PostgreSQL/SQS indisponível, timeout): Retry via mecanismo de backoff.

**Erro permanente**: Após limite de tentativas → DLQ para investigação operacional.

---

### 6.19 Shutdown

Em `SIGTERM`, workers:
1. param de aceitar novas mensagens;
2. concluem mensagens em processamento;
3. realizam commit antes do ACK;
4. devolvem mensagens para redelivery se não for possível concluir.

Objetivo: evitar perda de mensagens durante deploys/reinicializações.

---

### 6.20 Autenticação

Não é prioridade da primeira implementação. A aplicação é estruturada para permitir inclusão posterior via abstração/guard (ex: Keycloak/Zitadel).

Endpoints públicos: `GET /health/live`, `GET /health/ready`.

Mensagens internas da fila tratadas como canal confiável, mas identidade do provider sujeita a validações de domínio.

---

### 6.21 API

Endpoints principais:
```
POST /wallets
GET /wallets/:walletId
GET /wallets/:walletId/ledger
POST /wagering/transactions
GET /wagering/transactions/:transactionId
GET /providers/:providerId/wagering/transactions/:externalTransactionId
POST /wallets/:walletId/reconciliation
GET /health/live
GET /health/ready
```

Status HTTP diferenciam: payload inválido (400), conflito idempotência (409), rejeição negócio (422), processamento pendente, falha transitória (503).

---

### 6.22 Modelo de Dados

```
players (1) ───< wallets (>─── wager_transactions
                                    ├── ledger_entries
                                    ├── inbox_messages
                                    └── outbox_messages
```

**wallets**: `id, player_id, currency, balance, version, created_at, updated_at` + `UNIQUE(player_id, currency)`

**wager_transactions**: `id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id, player_id, round_id, game_id, kind, amount, currency, reference_external_transaction_id, reference_transaction_id, status, failure_code, processed_at, created_at`

**ledger_entries**: `id, wallet_id, transaction_id, direction, amount, currency, balance_before, balance_after, created_at` (imutáveis)

**inbox_messages**: `message_id, consumer_name, payload_hash, received_at, processed_at` + `UNIQUE(consumer_name, message_id)`

**outbox_messages**: `id, aggregate_id, event_type, payload, occurred_at, attempts, next_attempt_at, published_at`

---

## 7. Decisões Arquiteturais Críticas

### 7.1 Pessimistic Locking por Wallet

**Decisão**: Usar `SELECT ... FOR UPDATE` na wallet durante operações financeiras.

**Alternativas**: Optimistic locking (versão), Lock global.

**Racional**: 
- Wallet é a unidade natural de concorrência
- Serviços financeiros priorizam correção sobre throughput
- PostgreSQL `FOR UPDATE` garante serialização cross-instâncias
- Contenção limitada a wallets com operações concorrentes reais

### 7.2 Money Value Object: Aritmética Decimal Exata

**Decisão**: Value Object imutável com aritmética baseada em string/BigInt, escala 2.

**Por que não `number`/`float`**:
```typescript
0.1 + 0.2 // 0.30000000000000004 ❌
```

**Implementação**: `BigInt` em inteiros escalados (valor × 100). Todas operações retornam novas instâncias imutáveis. Currency mismatch lança erro.

**Banco**: `NUMERIC(14,2)` + `CHAR(3)` para currency.

**Serialização**: Sempre strings no JSON: `{"amount": "25.00", "currency": "BRL"}`.

### 7.3 Inbox + Outbox: Consistência Eventual Garantida

**Problema**: Crash entre DB commit e SQS publish → evento perdido. Redelivery sem deduplicação → efeito duplicado.

**Solução**: Dual persistence patterns.

**Inbox (Consumer)**:
```text
SQS Message → Inbox Table (consumerName + messageId UNIQUE) → Process → Mark Processed → ACK
```
- Deduplicação: constraint única `(consumerName, messageId)`
- Atomicidade: Inbox + operação financeira + Outbox na **mesma transação SQL**
- Redelivery: Se já em Inbox com `processedAt`, apenas ACK

**Outbox (Producer)**:
```text
Operação Financeira → Outbox Table → Outbox Worker → SQS → Mark Published
```
- Confiabilidade: Eventos persistidos **antes** de publish externo
- Paralelismo: `SELECT ... FOR UPDATE SKIP LOCKED`
- Retry com backoff exponencial (1s, 2s, 4s... max 5min)

**Garantia Combinada**:
```text
┌─────────────────────────────────────────────────────────────┐
│                    SINGLE SQL TRANSACTION                   │
├─────────────────────────────────────────────────────────────┤
│ 1. Lock Wallet (FOR UPDATE)                                 │
│ 2. Validar & Aplicar Regras Financeiras                     │
│ 3. Atualizar Wallet Balance + Version                       │
│ 4. Criar Ledger Entry                                       │
│ 5. Atualizar WagerTransaction Status                        │
│ 6. Inserir Inbox Record (se do SQS)                         │
│ 7. Inserir Outbox Record(s)                                 │
│ 8. COMMIT                                                   │
└─────────────────────────────────────────────────────────────┘
```

### 7.4 Autenticação: Extension Point

**Decisão**: Sem implementação v1. Abstração limpa para integração futura.

```typescript
const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [...]);
    if (isPublic) return true;
    // TODO: Validar JWT quando implementado
    return true;
  }
}
```

Endpoints de health permanecem públicos. Integração futura: validar JWT no guard, adicionar endpoint de token, remover fallback.

---

## 8. Trade-offs Aceitos

| Decisão | Trade-off | Mitigação |
|---------|-----------|-----------|
| Pessimistic locking | Contenção em wallets quentes | Sharding natural por walletId; monitorar `lock_conflicts` |
| Escopo TXN single-wallet | Cross-wallet precisa saga | Não necessário no domínio atual |
| Money string-based | Ligeiramente mais lento | Desprezível vs latência DB; correção paramount |
| Inbox + Outbox tables | Storage + write amplification extra | Necessário para exactly-once; storage barato |
| Sem auth v1 | Gap de segurança produção | Extension point claro; documentado |

---

## 9. Verificação e Critérios de Sucesso

### Testes de Concorrência (85 passando)
- 50 BETs paralelas na mesma wallet → todas 50 PROCESSED, saldo 0
- 2 BETs competindo (100 BRL, 80 cada) → 1 PROCESSED, 1 REJECTED
- Wallets diferentes em paralelo → sem interferência
- Idempotency replay → mesmo resultado
- Idempotency conflict → 409
- Reconciliação completa → `wallet.balance == ledger sum`
- REFUND antes da BET → PENDING_REFERENCE → PROCESSED
- ROLLBACK de WIN → reverte crédito

### Critério Fundamental
```text
wallet.balance == ledger reconstructed balance
AND no duplicate debit
AND no duplicate credit
AND no negative balance
AND no lost confirmed event
```