# Architecture Decision Records

This document captures the critical architectural decisions made during the implementation of the Distributed Wagering Processor.

---

## 1. Concurrency Control: Pessimistic Locking per Wallet

### Decision
Use **pessimistic locking (`SELECT ... FOR UPDATE`)** on the wallet row during financial operations, with the lock scope limited to a single wallet.

### Alternatives Considered
| Approach | Pros | Cons |
|----------|------|------|
| **Optimistic Locking (version column)** | No blocking, high throughput for low contention | Retry storms under high contention; lost updates possible without careful retry logic |
| **Global Application Lock** | Simple to reason about | Serializes all wallets; kills horizontal scalability |
| **Pessimistic Locking (Chosen)** | Strong consistency; natural fit for financial domain; wallet is natural concurrency unit | Can become contention hotspot for high-volume wallets |

### Rationale
- The **wallet is the natural unit of concurrency** in this domain - all financial operations affect a single wallet's balance
- Financial services prioritize **correctness over throughput** - a blocked operation is better than a corrupted balance
- PostgreSQL's `FOR UPDATE` provides **database-enforced serialization** that works correctly across multiple application instances
- Contention is limited to wallets with actual concurrent operations - different wallets process in parallel
- For extremely high-volume wallets, the architecture supports **sharding by walletId** at the routing layer

### Implementation
```typescript
// In WalletRepository
async findByIdLocked(walletId: WalletId, em: EntityManager): Promise<Wallet | null> {
  const repo = em.getRepository(WalletEntity);
  return repo.findOne({ id: walletId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
}
```

---

## 2. Money Value Object: Exact Decimal Arithmetic

### Decision
Represent all monetary values as **immutable Value Objects** using **string-based decimal arithmetic** with **scale of 2**. Never use `number`, `float`, or `double`.

### Design
```typescript
class Money {
  private readonly _amount: string;  // e.g., "123.45", "-50.00"
  private readonly _currency: string; // ISO 4217, e.g., "BRL"

  add(other: Money): Money      // string-based addition
  subtract(other: Money): Money // string-based subtraction
  // ...
}
```

### Arithmetic Implementation
- Uses `BigInt` on scaled integers (amount × 100) for exact precision
- All operations return **new immutable instances**
- Currency mismatch throws at runtime (not silent coercion)
- Scale validated at construction (max 2 decimals)

### Database Mapping
| Column | Type | Rationale |
|--------|------|-----------|
| `amount` | `NUMERIC(14,2)` | Exact storage matching domain scale |
| `currency` | `CHAR(3)` | ISO 4278 code, separate from amount |

### Why Not `decimal` / `numeric` in Code?
JavaScript/TypeScript `number` is IEEE 754 double-precision binary floating point:
```typescript
0.1 + 0.2 // 0.30000000000000004 ❌
```
Even `BigInt` alone isn't enough - we need **decimal semantics** (base-10) not binary.

### Serialization
```json
{
  "amount": "25.00",
  "currency": "BRL"
}
```
Always strings in JSON - never numbers.

---

## 3. Inbox + Outbox: Guaranteed Eventual Consistency

### Problem
In distributed systems with message queues:
- Process crashes **after DB commit but before SQS publish** → lost event
- SQS redelivery **without deduplication** → duplicate financial effects
- Need **exactly-once semantics** for financial events

### Solution: Dual Persistence Patterns

#### Inbox Pattern (Consumer Side)
```
SQS Message → Inbox Table (consumerName + messageId UNIQUE) → Process → Mark Processed → ACK
```
- **Deduplication**: `(consumerName, messageId)` unique constraint
- **Atomicity**: Inbox record + financial operation + Outbox in **same SQL transaction**
- **Redelivery handling**: If message already in Inbox with `processedAt`, just ACK
- **Payload verification**: Hash mismatch = conflict (potential replay attack)

#### Outbox Pattern (Producer Side)
```
Financial Operation → Outbox Table → Outbox Worker → SQS → Mark Published
```
- **Reliability**: Events persisted **before** external publish
- **Parallel publishing**: `SELECT ... FOR UPDATE SKIP LOCKED` allows multiple workers
- **Retry with backoff**: Exponential backoff (1s, 2s, 4s... max 5min)
- **At-least-once delivery**: Consumers must be idempotent (use eventId)

### Combined Guarantee
```
┌─────────────────────────────────────────────────────────────┐
│                    SINGLE SQL TRANSACTION                   │
├─────────────────────────────────────────────────────────────┤
│  1. Lock Wallet (FOR UPDATE)                                │
│  2. Validate & Apply Financial Rules                        │
│  3. Update Wallet Balance + Version                         │
│  4. Create Ledger Entry                                     │
│  5. Update WagerTransaction Status                          │
│  6. Insert Inbox Record (if from SQS)                       │
│  7. Insert Outbox Record(s)                                 │
│  8. COMMIT                                                   │
└─────────────────────────────────────────────────────────────┘
         │                          │
         ▼                          ▼
   Database                    SQS (async)
   Committed                   Published
```

### Crash Scenarios Handled
| Scenario | Outcome |
|----------|---------|
| Crash after DB commit, before SQS publish | Outbox worker picks up on restart |
| Crash after SQS publish, before ACK | Redelivery → Inbox detects duplicate → ACK only |
| SQS redelivery | Inbox finds existing record → No double processing |
| Process kill during TXN | DB rolls back → No partial state |

---

## 4. Authentication: Extension Point Design

### Decision
**No authentication implementation** in the initial version. Instead, provide a **clean abstraction** for future integration.

### Design
```typescript
// Public decorator for unprotected endpoints
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// Guard checks metadata
@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    // TODO: Validate JWT when implemented
    return true; // Allow all for now
  }
}
```

### Rationale
- Authentication is **not a differentiator** for this challenge (explicitly stated)
- Adding real auth (Keycloak, OAuth2) would add **operational complexity** without demonstrating core financial engineering skills
- The abstraction allows **zero-downtime addition** of authentication later:
  1. Implement `JwtAuthGuard` validation
  2. Add token acquisition endpoint
  3. Remove `return true` fallback
- Health endpoints (`/health/live`, `/health/ready`) remain **public by design** for infrastructure probes

### Future Integration Points
- `Authorization` header validation in `JwtAuthGuard`
- Role-based access control via custom decorators (`@Roles('admin')`)
- Provider-scoped tokens for game providers
- Audit logging of authenticated operations

---

## 5. Additional Critical Decisions

### Domain-First Architecture
```
src/domain/          # Zero dependencies (pure TypeScript)
    ├── money/
    ├── wallet/
    ├── wager/
    ├── ledger/
    ├── inbox/
    └── outbox/

src/application/     # Depends on domain only
    ├── use-cases/
    └── ports/       # Interfaces (Repository, etc.)

src/infrastructure/  # Depends on domain + application
    ├── database/    # MikroORM, PostgreSQL
    └── messaging/   # SQS, LocalStack
```

**Rule**: Domain never imports from infrastructure or application.

### Entity Rehydration
```typescript
// Domain factory - no validation on rehydration
static rehydrate(props: WalletProps): Wallet {
  return new Wallet(props); // Private constructor
}
```
- `create()` = validation + business rules
- `rehydrate()` = trusted reconstruction from DB
- Prevents re-triggering transitions on load

### Idempotency: Key + Payload Hash
```
Idempotency-Key: provider-a:txn-123
Payload Hash: SHA256(canonicalBusinessFields)
```
- Same key + same hash = **replay** (return original result)
- Same key + different hash = **conflict** (409)
- Hash excludes transport metadata (headers, timestamps)

### Reconciliation as First-Class Operation
```http
POST /wallets/:walletId/reconciliation
```
```json
{
  "walletId": "...",
  "storedBalance": "100.00",
  "calculatedBalance": "100.00",
  "difference": "0.00",
  "consistent": true,
  "checkedEntries": 42
}
```
- Not automatic correction - **detection and alerting only**
- Runs on-demand (not scheduled) to avoid false positives during in-flight txns
- Metrics: `reconciliation_divergences_total`, `reconciliation_duration_ms`

### Health Checks Separation
| Endpoint | Purpose | Dependencies |
|----------|---------|--------------|
| `/health/live` | Process alive | None |
| `/health/ready` | Can serve traffic | PostgreSQL + SQS |

Allows Kubernetes to:
- Restart dead pods (liveness)
- Remove not-ready pods from service (readiness)

---

## 6. Trade-offs Accepted

| Decision | Trade-off | Mitigation |
|----------|-----------|------------|
| Pessimistic locking | Contention on hot wallets | Natural wallet sharding; monitor `lock_conflicts` metric |
| Single-wallet TXN scope | Cross-wallet operations need saga | Not required for current domain |
| String-based Money | Slightly slower than native | Negligible vs DB latency; correctness paramount |
| Inbox + Outbox tables | Extra storage + write amplification | Required for exactly-once; storage cheap |
| No auth v1 | Security gap for production | Clear extension point; documented |
| Bun runtime | Newer ecosystem | Fast startup, native TS, built-in test runner |

---

## 7. Verification Strategy

### Concurrency Tests (85 passing)
- 50 parallel BETs on same wallet → all 50 PROCESSED, balance 0
- 2 competing BETs (100 BRL, 80 each) → 1 PROCESSED, 1 REJECTED
- Different wallets parallel → no interference
- Idempotency replay → same result
- Idempotency conflict → 409
- Full reconciliation → wallet.balance == ledger sum
- REFUND before BET → PENDING_REFERENCE → PROCESSED
- ROLLBACK of WIN → reverses credit

### Success Criteria
```text
wallet.balance == ledger reconstructed balance
AND no duplicate debit
AND no duplicate credit
AND no negative balance
AND no lost confirmed event
```

---

*This document should be updated as architectural decisions evolve.*