# Distributed Wagering Processor

> Serviço financeiro distribuído para transações de apostas iGaming com garantias de consistência forte.

## Visão Geral

O **Distributed Wagering Processor** é um serviço financeiro de alta concorrência projetado para processar transações de apostas (apostas, ganhos, reembolsos, rollbacks) de múltiplos provedores de jogos mantendo invariantes financeiras rigorosas:

- **Sem efeitos financeiros duplicados** - Idempotência garantida no nível do banco de dados
- **Sem saldos negativos** - Saldo nunca fica abaixo de zero
- **Ledger imutável** - Toda alteração de saldo tem lançamento correspondente no ledger
- **Transações atômicas** - Wallet, transação, ledger e outbox em uma única transação SQL
- **Recuperação de crash** - Padrões Inbox/Outbox sobrevivem a reinicializações de processo

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            HTTP API (NestJS)                                │
│  POST /wallets          GET /wallets/:id      POST /wagering/transactions  │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          WagerUseCase (Lógica de Domínio)                   │
│  • Regras BET/WIN/LOSS/REFUND/ROLLBACK/OPENING                             │
│  • Pessimistic locking (FOR UPDATE) por wallet                             │
│  • Atômico: Wallet + Transação + Ledger + Outbox                           │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
            ┌──────────────┐ ┌──────────┐ ┌────────────┐
            │  PostgreSQL  │ │  SQS     │ │  Outbox    │
            │  (Wallets,   │ │  (Inbox  │ │  Worker    │
            │  Txns,       │ │  Pattern)│ │  (SKIP     │
            │  Ledger,     │ │          │ │  LOCKED)   │
            │  Inbox,      │ │          │ │            │
            │  Outbox)     │ │          │ │            │
            └──────────────┘ └──────────┘ └────────────┘
```

## Início Rápido

### Pré-requisitos

- [Bun](https://bun.sh/) 1.0+
- Docker & Docker Compose
- PostgreSQL (via Docker)
- LocalStack (para SQS via Docker)

### 1. Iniciar Infraestrutura

```bash
docker-compose up -d
```

Isso inicia:
- **PostgreSQL** na porta 5432 (database: `wagering`, usuário: `wagering`, senha: `wagering`)
- **LocalStack** na porta 4566 (endpoint SQS)

### 2. Instalar Dependências

```bash
bun install
```

### 3. Executar Migrations

```bash
bun run db:migrate
```

### 4. Iniciar Aplicação

```bash
# Desenvolvimento (com hot reload)
bun run dev

# Produção
bun run start
```

A API estará disponível em:
- **HTTP API**: http://localhost:3000
- **Swagger Docs**: http://localhost:3000/api/docs
- **Health Checks**: http://localhost:3000/health/live | /health/ready

### 5. Iniciar Workers (terminais separados)

```bash
# Terminal 1: SQS Inbox Consumer + Outbox + Pending Reference
bun run src/workers.ts
```

Ou executar todos os workers juntos:
```bash
bun run src/workers.ts
```

## Endpoints da API

### Wallets
| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/wallets` | Criar wallet para jogador |
| GET | `/wallets/:walletId` | Obter detalhes da wallet |
| POST | `/wallets/:walletId/reconciliation` | Reconciliar wallet com ledger |

### Wagering
| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/wagering/transactions` | Submeter transação (requer `Idempotency-Key`) |
| GET | `/wagering/transactions/:transactionId` | Obter transação por ID |
| GET | `/providers/:providerId/wagering/transactions/:externalTransactionId` | Obter por provider + ID externo |

### Health
| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/health/live` | Liveness probe (sempre retorna OK) |
| GET | `/health/ready` | Readiness probe (verifica PG + SQS) |

## Submetendo Transações

### Header Obrigatório
```http
Idempotency-Key: provider-a:transaction-123
```

Formato: `{providerId}:{externalTransactionId}`

### Corpo da Requisição
```json
{
  "providerId": "provider-a",
  "externalTransactionId": "txn-123",
  "walletId": "uuid-da-wallet",
  "playerId": "uuid-do-jogador",
  "roundId": "round-456",
  "gameId": "game-789",
  "kind": "BET",
  "amount": "50.00",
  "currency": "BRL",
  "referenceExternalTransactionId": null
}
```

### Tipos de Transação
| Tipo | Descrição | Efeito no Saldo | Ledger |
|------|-----------|-----------------|--------|
| `OPENING` | Financiamento inicial da wallet | Crédito | CREDIT |
| `BET` | Fazer uma aposta | Débito | DEBIT |
| `WIN` | Pagamento de ganho | Crédito | CREDIT |
| `LOSS` | Aposta perdida | Nenhum | Nenhum |
| `REFUND` | Reembolsar uma aposta | Crédito | CREDIT |
| `ROLLBACK` | Reverter operação anterior | Inverso | Inverso |

### Códigos de Resposta
| Código | Significado |
|--------|-------------|
| 200 | Transação processada (verifique `status` no corpo) |
| 400 | Payload inválido ou idempotency key ausente |
| 409 | Conflito de idempotência (mesma key, payload diferente) |
| 422 | Rejeição de negócio (saldo insuficiente, referência inválida, etc.) |
| 503 | Falha transitória de infraestrutura |

### Exemplo de Resposta
```json
{
  "transactionId": "uuid",
  "status": "PROCESSED",
  "balanceAfter": "950.00",
  "idempotentReplay": false
}
```

## Executando Testes

```bash
# Todos os testes
bun test

# Modo watch
bun test --watch

# Apenas testes unitários (77 testes)
bun test src/domain

# Testes de integração (requer PostgreSQL)
bun test test/integration
```

## Teste de Carga

```bash
# Teste de carga básico
bun run test:load

# Parâmetros customizados
BASE_URL=http://localhost:3000 CONCURRENT=100 TOTAL_REQUESTS=1000 bun run test:load

# Com wallet existente
WALLET_ID=uuid PLAYER_ID=uuid CONCURRENT=50 TOTAL_REQUESTS=500 bun run test:load
```

### Saída do Teste de Carga
```
========== RESULTADOS DO TESTE DE CARGA ==========
Total de Requisições:     500
Bem-sucedidas:            500
Falhas:                   0
Duração:                  1234ms
Throughput:               405.18 req/s

Latência (requisições bem-sucedidas):
  p50:              12.34ms
  p95:              45.67ms
  p99:              89.12ms
  média:            18.45ms
  mín:              2.10ms
  máx:              156.78ms
================================================
```

## Estrutura do Projeto

```
src/
├── domain/                 # Lógica pura de domínio (sem dependências)
│   ├── money/             # Value Object Money
│   ├── wallet/            # Aggregate Root Wallet
│   ├── wager/             # Entidade WagerTransaction
│   ├── ledger/            # WalletLedgerEntry
│   ├── inbox/             # Padrão Inbox
│   └── outbox/            # Padrão Outbox
├── application/           # Casos de uso & ports
│   ├── use-cases/         # WagerUseCase, reconciliação
│   └── ports/             # Interfaces de repositório
├── infrastructure/        # Implementações de framework
│   ├── database/
│   │   ├── entities/      # Entidades MikroORM
│   │   ├── repositories/  # Implementações de repositório
│   │   └── migrations/    # Migrations SQL
│   └── messaging/
│       ├── consumers/     # SQS Inbox Consumer, Pending Reference Worker
│       └── publishers/    # Outbox Worker (SKIP LOCKED)
├── interfaces/            # Camada HTTP
│   └── http/
│       ├── wallets/
│       ├── wagering/
│       ├── health/
│       └── auth/
├── common/                # Utilitários compartilhados
│   ├── shutdown/          # Graceful shutdown
│   ├── logger/            # Logger JSON estruturado
│   └── metrics/           # Coletor de métricas
├── main.ts                # Bootstrap NestJS
└── workers.ts             # Entry point dos workers em background
```

## Configuração

Variáveis de ambiente:

| Variável | Padrão | Descrição |
|----------|---------|-------------|
| `PORT` | 3000 | Porta do servidor HTTP |
| `DB_HOST` | localhost | Host do PostgreSQL |
| `DB_PORT` | 5432 | Porta do PostgreSQL |
| `DB_NAME` | wagering | Nome do database |
| `DB_USER` | wagering | Usuário do database |
| `DB_PASSWORD` | wagering | Senha do database |
| `SQS_ENDPOINT` | http://localhost:4566 | Endpoint SQS do LocalStack |
| `SQS_QUEUE_URL` | .../wager-transactions.fifo | Fila SQS principal |
| `SQS_DLQ_URL` | .../wager-transactions-dlq.fifo | Dead letter queue |
| `SQS_OUTBOX_QUEUE_URL` | .../wager-events.fifo | Fila de eventos do outbox |
| `CONSUMER_NAME` | wager-worker-1 | Identificador do consumidor |

## Invariantes Financeiras

O sistema garante estas invariantes mesmo sob:
- Duplicação de mensagens
- Entrega fora de ordem
- Processamento concorrente
- Múltiplas instâncias da aplicação
- Falhas de processo antes/depois de commits
- Redelivery de mensagens
- Indisponibilidade temporária do PostgreSQL/SQS

### Invariantes Principais
1. **Sem débito/crédito duplicado** - Idempotency key + payload hash
2. **Sem saldo negativo** - Verificado no domínio + constraint no DB
3. **Ledger corresponde ao saldo** - Toda alteração tem lançamento no ledger
4. **Ledger imutável** - Sem UPDATE/DELETE em ledger_entries
5. **Reconciliável** - `wallet.balance == SOMA(ledger)`
6. **Idempotência persistente** - Sobrevive a reinicializações
7. **Transações atômicas** - Tudo-ou-nada em única transação SQL
8. **Mensageria recuperável** - Padrões Inbox + Outbox
9. **Corretude multi-instância** - Pessimistic locking

## Serviços do Docker Compose

```yaml
services:
  postgres:    # PostgreSQL 16
  localstack:  # SQS via LocalStack
  app:         # NestJS API
  worker-1:    # SQS Consumer + Outbox + Pending Reference
  worker-2:    # Instância adicional de consumer
  worker-3:    # Instância adicional de consumer
```

## Licença

MIT