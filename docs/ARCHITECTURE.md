# Architecture — Distributed Wagering Processor

## 1. Visão geral

O **Distributed Wagering Processor** é um serviço financeiro distribuído responsável por processar transações de apostas recebidas de múltiplos provedores de jogos.

O sistema deve preservar a correção financeira mesmo diante de:

* mensagens duplicadas;
* mensagens entregues fora de ordem;
* processamento concorrente;
* múltiplas instâncias da aplicação;
* falhas de processo antes ou depois de commits;
* redelivery de mensagens;
* indisponibilidade temporária do PostgreSQL ou SQS.

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

# 2. Stack

| Componente                   | Tecnologia          |
| ---------------------------- | ------------------- |
| Runtime                      | Bun 1.x             |
| Linguagem                    | TypeScript strict   |
| Framework                    | NestJS              |
| Banco de dados               | PostgreSQL          |
| ORM                          | MikroORM            |
| Mensageria                   | AWS SQS             |
| Ambiente local de mensageria | LocalStack          |
| Orquestração                 | Docker Compose      |
| Testes                       | Bun test runner     |
| Migrations                   | MikroORM migrations |

O desafio permite MikroORM ou TypeORM e indica MikroORM como opção preferencial. Esta implementação utilizará MikroORM.

---

# 3. Princípios arquiteturais

## 3.1 Domain-first

As regras financeiras não devem depender de NestJS, MikroORM ou SQS.

O domínio deve ser capaz de representar e validar:

* dinheiro;
* wallet;
* transações de aposta;
* lançamentos do ledger;
* estados e transições;
* regras de reversão.

Infraestrutura será responsável por persistência, transporte e integração.

---

## 3.2 Banco como última linha de defesa

As invariantes críticas não serão protegidas somente pelo código da aplicação.

O PostgreSQL também será responsável por garantir:

* unicidade;
* relacionamentos;
* valores válidos;
* não-negatividade quando aplicável;
* integridade dos registros.

Isso é especialmente importante porque múltiplas instâncias podem executar operações simultaneamente.

---

## 3.3 Dinheiro nunca será representado por `number`

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

# 4. Arquitetura em alto nível

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

# 5. Organização da aplicação

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

# 6. Modelo de domínio

## 6.1 Money

`Money` será um Value Object imutável.

Responsabilidades:

* representar valor decimal;
* representar moeda;
* realizar operações aritméticas;
* impedir operações entre moedas diferentes;
* validar escala;
* impedir valores inválidos.

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

# 7. Wallet

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

* somente uma wallet para cada `playerId + currency`;
* saldo nunca negativo;
* moeda da operação deve corresponder à moeda da wallet;
* alteração de saldo precisa possuir lançamento correspondente;
* operações concorrentes não podem causar lost update;
* `version` começa em `1`;
* `version` aumenta somente quando o saldo muda.

A wallet será reconstruída do banco através de uma factory `rehydrate`.

---

# 8. WagerTransaction

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

# 9. Regras financeiras

| Operação |                  Saldo | Ledger            |
| -------- | ---------------------: | ----------------- |
| BET      |                 débito | DEBIT             |
| WIN      |                crédito | CREDIT            |
| LOSS     |          nenhum efeito | nenhum            |
| REFUND   |                crédito | CREDIT            |
| ROLLBACK | inversão da referência | entrada invertida |

## BET

Uma aposta debita o saldo.

Se o saldo for insuficiente:

```text
REJECTED
```

Nenhum lançamento financeiro é criado.

---

## WIN

Um `WIN` credita o saldo.

Pode possuir uma referência à `BET` da mesma rodada.

---

## LOSS

Não altera o saldo.

Ainda assim, a transação pode atingir `PROCESSED` e gerar o evento correspondente de processamento.

---

## REFUND

Um `REFUND`:

* exige referência;
* referencia uma `BET`;
* deve possuir o mesmo valor da referência;
* credita o valor de volta;
* só pode ocorrer uma vez para aquela referência.

---

## ROLLBACK

Um `ROLLBACK`:

* exige referência;
* pode referenciar `BET`, `WIN` ou `REFUND`;
* utiliza o mesmo valor da referência;
* aplica o efeito inverso;
* só pode ocorrer uma vez para aquela referência pelo mesmo tipo de operação.

Uma reversão que produziria saldo negativo será rejeitada explicitamente.

---

# 10. Idempotência

A idempotência será garantida no banco de dados.

A fonte de verdade da idempotência HTTP será o header:

```http
Idempotency-Key: provider-a:transaction-123
```

A chave recomendada é:

```text
{providerId}:{externalTransactionId}
```

Cada operação também terá:

```text
payloadHash
```

O hash será calculado a partir de um JSON canônico contendo os campos de negócio.

Headers e metadados de transporte não fazem parte do hash.

## Replay

Se a mesma chave chegar novamente com o mesmo payload:

```text
mesma operação
      ↓
retornar resultado original
```

A resposta deverá indicar:

```json
{
  "idempotentReplay": true
}
```

## Conflito

Se a mesma chave chegar com payload diferente:

```text
mesma key
+
payload diferente
      ↓
CONFLICT
```

Isso não será considerado replay.

A garantia final será implementada por constraints e índices no PostgreSQL.

---

# 11. Concorrência

A unidade de concorrência será a:

```text
walletId
```

A estratégia inicial será **pessimistic locking por wallet**.

Durante uma operação financeira, a wallet será bloqueada dentro de uma transação SQL.

Conceitualmente:

```text
BEGIN

SELECT wallet
FOR UPDATE

processar regra financeira

atualizar saldo

criar ledger

atualizar transaction

criar outbox

COMMIT
```

O lock será aplicado somente à wallet envolvida.

Wallets diferentes poderão continuar sendo processadas em paralelo.

Não será utilizado lock global da aplicação.

---

# 12. Exemplo de concorrência

Estado inicial:

```text
Wallet
balance = 100.00 BRL
```

Duas apostas chegam simultaneamente:

```text
BET A = 80.00
BET B = 80.00
```

O banco deverá serializar as operações sobre a mesma wallet.

Primeira operação:

```text
100 - 80 = 20
```

Segunda operação:

```text
20 - 80
```

Resultado:

```text
REJECTED
```

Estado final:

```text
balance = 20.00
```

Ledger:

```text
1 x DEBIT 80.00
```

Resultado esperado:

```text
BET A → PROCESSED
BET B → REJECTED
```

A ordem específica entre A e B não é importante, desde que apenas uma seja processada.

---

# 13. Transação financeira

A alteração financeira será atômica.

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

Se qualquer etapa falhar:

```text
ROLLBACK
```

Nenhuma alteração parcial poderá permanecer.

---

# 14. Ledger

O ledger será imutável.

Um lançamento conterá:

```text
id
walletId
transactionId
direction
money
balanceBefore
balanceAfter
createdAt
```

Exemplo:

```text
balanceBefore = 100.00
direction     = DEBIT
money         = 25.00
balanceAfter  = 75.00
```

A factory do ledger deverá verificar:

```text
balanceBefore - money == balanceAfter
```

para débitos, ou:

```text
balanceBefore + money == balanceAfter
```

para créditos.

Não existirão operações de atualização ou exclusão de lançamentos.

---

# 15. Reconciliação

O sistema disponibilizará:

```http
POST /wallets/:walletId/reconciliation
```

A reconciliação calculará o saldo através dos lançamentos do ledger e comparará com o saldo materializado da wallet.

Resultado esperado:

```text
storedBalance
calculatedBalance
difference
consistent
checkedEntries
```

Uma divergência não será corrigida automaticamente.

Ela deverá:

* ser registrada em log;
* gerar métrica;
* ser retornada na resposta.

---

# 16. Processamento HTTP

Fluxo:

```text
HTTP Request
     │
     ▼
Controller
     │
     ▼
DTO Validation
     │
     ▼
Application Use Case
     │
     ▼
Database Transaction
     │
     ├── WagerTransaction
     ├── Wallet
     ├── Ledger
     └── Outbox
     │
     ▼
HTTP Response
```

O controller não conterá regras financeiras.

Ele apenas:

* recebe a requisição;
* valida o contrato;
* cria o contexto da operação;
* chama o use case;
* traduz o resultado para HTTP.

---

# 17. Processamento assíncrono

As operações também poderão chegar através de SQS.

Fila principal:

```text
wager-transactions.fifo
```

DLQ:

```text
wager-transactions-dlq.fifo
```

O worker não implementará regras financeiras próprias.

Ele utilizará o mesmo use case usado pela API HTTP.

```text
SQS
 ↓
Consumer
 ↓
Inbox
 ↓
Wager Use Case
 ↓
PostgreSQL
```

---

# 18. Inbox

A Inbox fornece deduplicação persistente para mensagens SQS.

Chave lógica:

```text
consumerName + messageId
```

Estado:

```text
received
processedAt
payloadHash
```

Fluxo:

```text
Mensagem SQS
      ↓
registrar Inbox
      ↓
processar operação
      ↓
commit
      ↓
ack
```

O registro da Inbox, a operação financeira e a Outbox participarão da mesma transação SQL.

Se a mensagem for redelivered:

```text
Inbox já processada
       ↓
não repetir efeito financeiro
       ↓
ack
```

---

# 19. ACK e falhas

O ACK da mensagem ocorrerá somente depois do commit.

Não será feito:

```text
processar
ACK
COMMIT
```

O fluxo correto é:

```text
processar
COMMIT
ACK
```

Se o processo morrer depois do commit e antes do ACK:

```text
COMMIT
  ↓
processo morre
  ↓
SQS redelivers
  ↓
Inbox detecta duplicata
  ↓
efeito financeiro não é repetido
```

---

# 20. Mensagens fora de ordem

Operações que dependem de uma referência que ainda não existe serão persistidas como:

```text
PENDING_REFERENCE
```

Exemplo:

```text
REFUND BET-123
       ↓
BET-123 ainda não chegou
       ↓
PENDING_REFERENCE
```

Um worker agendado tentará novamente com backoff exponencial.

Fluxo:

```text
PENDING_REFERENCE
       ↓
retry
       ↓
referência encontrada?
   ┌───┴───┐
   │       │
  sim     não
   │       │
   ▼       ▼
processar retry
           │
           ▼
      limite atingido
           │
           ▼
        REJECTED
```

O limite de tentativas e o TTL serão definidos na implementação e documentados de acordo com o comportamento observado nos testes.

---

# 21. Transactional Outbox

A aplicação não publicará eventos diretamente no SQS antes do commit.

Em vez disso:

```text
Database Transaction
       │
       ├── Wallet
       ├── WagerTransaction
       ├── Ledger
       └── Outbox
```

Depois do commit:

```text
Outbox Worker
      ↓
SQS
```

Isso evita o problema:

```text
Banco COMMIT
     ↓
processo morre
     ↓
evento perdido
```

Com Outbox:

```text
Banco COMMIT
     ↓
evento está persistido
     ↓
processo morre
     ↓
outro worker continua
     ↓
evento publicado
```

---

# 22. Concorrência da Outbox

Múltiplos publishers poderão processar a Outbox simultaneamente.

A estratégia será baseada em mecanismos de locking/transação do PostgreSQL.

Um publisher deverá reservar os registros que está processando sem bloquear globalmente todos os demais publishers.

O objetivo é permitir:

```text
Publisher 1 → eventos A, B
Publisher 2 → eventos C, D
Publisher 3 → eventos E, F
```

simultaneamente.

Uma publicação duplicada deve ser considerada possível, pois a entrega externa continua sujeita a comportamento at-least-once.

Consumidores deverão utilizar identificadores de evento para manter o processamento idempotente.

---

# 23. Eventos

Eventos mínimos:

```text
WagerTransactionProcessed
WagerTransactionRejected
WalletBalanceChanged
WagerTransactionPendingReference
```

`WalletBalanceChanged` será publicado somente quando o saldo realmente mudar.

Cada evento possuirá envelope versionado contendo:

```text
eventId
eventType
aggregateId
correlationId
causationId
occurredAt
version
data
```

O payload será serializável em JSON.

Valores monetários continuarão sendo representados por strings decimais.

---

# 24. Retry e DLQ

Os erros serão classificados em três categorias.

## Erro de negócio

Exemplos:

```text
saldo insuficiente
referência inválida
moeda incompatível
payload conflitante
```

Esses erros são terminais e não devem gerar retries infinitos.

A mensagem poderá ser confirmada e a transação permanecerá auditável como `REJECTED`.

---

## Erro transitório

Exemplos:

```text
PostgreSQL temporariamente indisponível
SQS temporariamente indisponível
timeout
```

A mensagem deverá retornar para processamento posterior através do mecanismo de retry.

---

## Erro permanente

Após o limite de tentativas:

```text
retry
retry
retry
...
DLQ
```

A DLQ permitirá investigação operacional sem perder a mensagem original.

---

# 25. Shutdown

Em `SIGTERM`, os workers deverão:

1. parar de aceitar novas mensagens;
2. concluir mensagens já em processamento quando possível;
3. realizar commit antes do ACK;
4. devolver mensagens para o mecanismo de redelivery caso não seja possível concluir o processamento.

O objetivo é evitar perda de mensagens durante deploys ou reinicializações.

---

# 26. Autenticação

A autenticação não será prioridade da primeira implementação porque não representa pontuação relevante no desafio.

O desafio recomenda utilizar um Identity Provider externo caso seja implementada, como Keycloak ou Zitadel.

A aplicação será estruturada para permitir a inclusão de autenticação posteriormente através de uma abstração/guard.

Os endpoints:

```text
GET /health/live
GET /health/ready
```

permanecerão públicos.

Mensagens internas da fila serão tratadas como provenientes de um canal confiável, porém a identidade do provider continuará sujeita às validações de domínio.

---

# 27. API

Endpoints principais:

```text
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

O status HTTP deverá diferenciar:

* payload inválido;
* conflito de idempotência;
* rejeição de negócio;
* processamento pendente;
* falha transitória de infraestrutura.

---

# 28. Modelo de dados inicial

Modelo conceitual:

```text
players
   │
   │ 1
   │
   │ N
wallets
   │
   ├───────────────┐
   │               │
   │               │
   ▼               ▼
wager_transactions ledger_entries
   │
   │
   ├── inbox_messages
   │
   └── outbox_messages
```

Principais entidades:

### wallets

```text
id
player_id
currency
balance
version
created_at
updated_at
```

Constraint:

```text
UNIQUE(player_id, currency)
```

---

### wager_transactions

```text
id
provider_id
external_transaction_id
idempotency_key
payload_hash
wallet_id
player_id
round_id
game_id
kind
amount
currency
reference_external_transaction_id
reference_transaction_id
status
failure_code
processed_at
created_at
```

As constraints exatas serão definidas durante a criação das migrations.

---

### ledger_entries

```text
id
wallet_id
transaction_id
direction
amount
currency
balance_before
balance_after
created_at
```

Os registros serão imutáveis.

---

### inbox_messages

```text
message_id
consumer_name
payload_hash
received_at
processed_at
```

Constraint:

```text
UNIQUE(consumer_name, message_id)
```

---

### outbox_messages

```text
id
aggregate_id
event_type
payload
occurred_at
attempts
next_attempt_at
published_at
```

---

# 29. Fluxo completo de uma BET

```text
Provider
   │
   ▼
POST /wagering/transactions
   │
   ▼
Validate DTO
   │
   ▼
Generate/validate payload hash
   │
   ▼
BEGIN
   │
   ▼
Check idempotency
   │
   ▼
Lock Wallet
   │
   ▼
Check balance
   │
   ├───────────────┐
   │               │
 suficiente     insuficiente
   │               │
   ▼               ▼
Debit          REJECTED
   │               │
   ▼               │
Ledger             │
   │               │
   ▼               │
Transaction        │
   │               │
   └───────┬───────┘
           ▼
        Outbox
           │
           ▼
         COMMIT
           │
           ▼
       HTTP Response
```

---

# 30. Fluxo de uma mensagem SQS

```text
SQS
 │
 ▼
Consumer
 │
 ▼
Check Inbox
 │
 ├── já processada → ACK
 │
 └── nova
      │
      ▼
     BEGIN
      │
      ├── Inbox
      ├── Wallet
      ├── Transaction
      ├── Ledger
      └── Outbox
      │
      ▼
    COMMIT
      │
      ▼
     ACK
```

---

# 31. Observabilidade

Os logs serão estruturados em JSON.

Quando aplicável, conterão:

```text
correlationId
messageId
transactionId
walletId
providerId
```

Não serão registrados payloads financeiros completos ou dados sensíveis.

Métricas mínimas:

```text
transactions_by_status
duplicate_transactions
retry_count
dlq_messages
lock_conflicts
outbox_lag
processing_latency
```

Health checks:

```text
/health/live
/health/ready
```

`live` indica que o processo está funcionando.

`ready` verifica a disponibilidade das dependências necessárias, especialmente PostgreSQL e SQS.

---

# 32. Estratégia de testes

## Unitários

Serão testados:

* `Money`;
* `Wallet`;
* regras de `BET`;
* regras de `WIN`;
* regras de `LOSS`;
* `REFUND`;
* `ROLLBACK`;
* conflitos de moeda;
* idempotency key com payload diferente.

---

## Integração

Os testes utilizarão PostgreSQL e LocalStack/MiniStack reais em containers.

Serão testados:

* migrations;
* constraints;
* atomicidade;
* Inbox;
* redelivery;
* Outbox;
* publishers concorrentes;
* retry;
* DLQ;
* recuperação após reinicialização.

---

## Concorrência

Serão obrigatoriamente testados:

```text
50 requisições da mesma aposta em paralelo

operações concorrentes disputando o saldo

wallets diferentes em paralelo

3 ou mais instâncias

worker morto depois do commit e antes do ACK

dois publishers concorrentes

REFUND antes da BET

ROLLBACK antes da referência

reinicialização do serviço
```

A validação final deverá garantir:

```text
wallet.balance
        ==
saldo reconstruído pelo ledger
```

---

# 33. Invariantes verificadas

Ao final dos testes, o sistema deverá garantir:

```text
No duplicate financial effects
        +
No negative balance
        +
Persistent idempotency
        +
Immutable ledger
        +
Atomic financial transaction
        +
Recoverable messaging
        +
Correctness with multiple instances
```

O banco e a aplicação devem trabalhar juntos para preservar essas invariantes.

---

# 34. Trade-offs

## Pessimistic locking vs optimistic locking

A estratégia inicial será pessimistic locking por wallet.

### Motivo

O domínio possui uma unidade natural de concorrência:

```text
walletId
```

O lock permite serializar diretamente operações que disputam o mesmo saldo.

Wallets diferentes permanecem independentes.

### Trade-off

Uma wallet com altíssimo volume de operações pode se tornar um ponto de contenção.

Para o escopo do desafio, a simplicidade e a previsibilidade do locking são consideradas mais importantes que otimizações prematuras.

---

## SQS FIFO

A fila FIFO será utilizada conforme especificado pelo desafio.

Porém, a consistência financeira **não dependerá exclusivamente da ordenação ou deduplicação do SQS**.

O PostgreSQL continuará sendo a fonte de verdade das invariantes.

---

## Inbox + Outbox

A combinação aumenta a quantidade de persistência e processamento necessário, mas permite lidar de forma explícita com:

* redelivery;
* crash recovery;
* publicação após commit;
* duplicação de eventos.

A complexidade adicional é aceita porque esses comportamentos fazem parte do problema central do desafio.

---

## Saldo materializado + Ledger

Manter o saldo materializado evita reconstruir o saldo inteiro do ledger a cada consulta.

O ledger continua sendo necessário para auditoria e reconciliação.

A reconciliação permite detectar divergências entre os dois.

---

# 35. Limitações e escopo

Para manter o escopo controlado:

* será assumida uma única moeda operacional, BRL, embora o domínio seja multi-moeda;
* não será implementado double-entry bookkeeping completo;
* autenticação poderá permanecer como ponto de extensão;
* não haverá correção automática de divergências de reconciliação;
* não haverá reversão parcial;
* otimizações avançadas de performance serão tratadas somente após a correção funcional;
* dashboard de observabilidade e OpenTelemetry são opcionais.

Qualquer decisão adicional tomada durante a implementação deverá ser registrada neste documento.

---

# 36. Critério de sucesso

A arquitetura será considerada correta quando os testes demonstrarem que o sistema permanece consistente sob:

```text
duplicação
ordenação diferente
concorrência
redelivery
crash
retry
múltiplas instâncias
indisponibilidade temporária
```

O critério fundamental é:

```text
wallet.balance == ledger reconstructed balance
```

e nenhum cenário poderá produzir:

```text
duplicate debit
duplicate credit
negative balance
lost confirmed event
```

A implementação será guiada por estas invariantes, e não pela quantidade de endpoints ou operações CRUD implementadas.
