# CLAUDE.md

Instructions for Claude Code working in this repository. See [AGENTS.md](AGENTS.md) for the
tool-agnostic version (setup/build/test commands) and [README.txt](README.txt) for the human-facing
architecture and API reference.

---

# Current Architecture Snapshot

Ground truth before applying the policies below — keep this section in sync with reality.

- **Services**: `back-end/api-gateway` (public HTTP, REST + Swagger at `/api-docs`),
  `back-end/service-a` (GH Archive ingestion, RabbitMQ-only), `back-end/service-b`
  (processing-logs/stats/PDF reports, RabbitMQ-only), `back-end/libs/shared` (`@task1/shared`).
- **Transport between services**: RabbitMQ only, via NestJS `ClientProxy`
  (`.send`/`@MessagePattern` for RPC, `.emit`/`@EventPattern` for fire-and-forget lifecycle
  events). Never HTTP, never direct database access across a service boundary.
- **Persistence**: MongoDB is in active use, but only for the GH Archive pipeline — `events` and
  `imports` collections owned by `service-a`, `processing-logs` owned by `service-b`, each
  accessed directly via the `mongodb` driver (no ORM, no Repository pattern). The gateway persists
  nothing of its own. There is no general-purpose persistence layer, and none should be introduced
  speculatively — see "Persistence" and "Forbidden Without Explicit Approval" below.
- **Redis**: used by `service-a` for RedisTimeSeries pipeline metrics (`TS.ADD`), and by the
  gateway/all services for health-check pings. Not used as a cache.
- **Authentication**: `AuthGuard` (`back-end/api-gateway/src/auth/auth.guard.ts`) is registered
  globally, but is an **intentional placeholder** — its `isAuthenticated()` unconditionally
  returns `true`, so every endpoint currently responds normally with no credentials supplied. This
  is deliberate and documented in the code comment there. The structure (`canActivate`, the
  `@Public()` override on `/health*`, the `isAuthenticated` seam, `UnauthenticatedError`) is
  already in place so real credential verification (Auth0/Passport.js/JWT/OIDC or similar) can be
  dropped into `isAuthenticated()` later. Do not implement a real provider, and do not change the
  stub's behavior, unless explicitly asked to.
- Full endpoint list, RabbitMQ message-pattern names, and the correlation-ID/request-ID system:
  see [README.txt](README.txt).

---

# AI Skills

This project uses reusable AI skills located in:

skills/*.md

**Note:** `skills/backend-development.md` was written against a Sequelize/PostgreSQL/AWS stack and
contains examples (a `filing-cabinet` module, Sequelize repositories) that don't exist in this
repo. Apply its *principles* (SOLID, layer separation, reuse-before-create) — defer to the actual
code and to this file's Persistence/Forbidden sections over that skill's stack-specific examples.

---

# Tech Stack

- Nest.js microservices
- TypeScript
- pnpm
- Vitest
- RabbitMQ
- Monorepo
- Redis
- MongoDB

---

# AI Instructions

Always use Context7 MCP for:

- Nest.js
- Vitest
- any library or framework documentation
- API reference
- version-specific behavior

Never guess APIs when documentation is available.

---

# Git

Never create git commits automatically. The user commits their own work manually.

This applies even when a process/skill (e.g. brainstorming's spec-writing step)
would normally commit as part of its flow — skip the commit step and leave
changes staged/unstaged for the user instead.

---

# Core Principles

Always prioritize:

- Security
- Correctness
- Simplicity
- Deterministic behavior
- Explicit code
- Readability
- Maintainability

Avoid:

- unnecessary abstractions
- hidden behavior
- premature optimization
- speculative architecture

---

# Layer Responsibilities

## Controllers

Responsible for:

- routing
- validation
- authentication
- serialization

Must NOT contain:

- business logic
- authorization logic
- transactions
- database access

---

## Application Services

Responsible for:

- business logic
- authorization
- transactions
- orchestration
- audit logging

Must NOT:

- expose persistence models
- depend on HTTP
- perform serialization

---

## Persistence

MongoDB is used today, but only within the GH Archive pipeline (`service-a`'s `events`/`imports`
collections, `service-b`'s `processing-logs` collection) — see "Current Architecture Snapshot"
above. There is no general-purpose persistence layer for other modules yet; add one only when a
concrete need is decided, not speculatively.

Rules:

- Persistence models never leave the persistence boundary.
- Database access belongs only to the owning module — `service-a` never queries `service-b`'s
  collections or vice versa, and the gateway never accesses either directly.
- Do not introduce Repository pattern unless explicitly requested. Current code accesses MongoDB
  collections directly through injected `Collection<T>` providers (e.g.
  `back-end/service-a/src/archive/import-run-tracker.service.ts`) — follow that pattern.

---

# Module Boundaries

Each module owns:

- domain logic
- persistence
- validation
- public service interface

Communication between modules must happen only through exported services.

Never access another module's persistence models.

Avoid circular dependencies.

---

# Security

Security is the highest priority.

Always follow:

- Deny by default
- Least privilege
- Fail closed
- Explicit authorization
- Immutable audit

Never trust:

- request body
- headers
- JWT claims beyond identity
- client roles
- client permissions

Authorization data must always come from trusted storage.

Missing authorization configuration must fail application startup.

**Current state:** real authentication is not implemented yet — `AuthGuard`'s `isAuthenticated()`
is a placeholder that returns `true`, so nothing is actually enforced today (see "Current
Architecture Snapshot" above). The deny-by-default rules in this section describe how the guard
must behave once a real provider is wired into that seam; they are not a description of current
behavior. Do not rely on the guard for protection in the meantime, and keep overriding it in
integration tests rather than depending on its current always-allow result (see
`*.controller.int.spec.ts` for the pattern).

---

# Validation

Validate before executing business logic:

- body
- params
- query
- headers

Never trust external input.

---

# Transactions

Every state-changing operation must execute inside a single database transaction.

Audit records must be created in the same transaction.

Rollback the transaction if audit creation fails.

Transactions must never:

- call AWS
- call external APIs
- publish events
- perform file operations

**Current state:** no code path in this repo currently uses multi-document transactions or an
audit trail — the GH Archive pipeline's writes (`import-run-tracker.service.ts`,
`processing-logs` inserts) are simple single-document inserts/updates with no rollback semantics,
which is acceptable for that pipeline's own documented trade-offs (see README's "Trade-offs"
section). This section is the standard to apply when a change introduces a genuinely
transactional, audited write path (e.g. an administrative mutation) — it does not retroactively
apply to the existing import pipeline without an explicit request to add it.

---

# Audit

Audit records are:

- append-only
- immutable
- never deleted
- never updated

Every record contains:

- actor
- timestamp
- correlation ID

Every administrative action must be audited.

**Current state:** no audit-record collection exists yet in this codebase. Apply this section when
adding an administrative/mutating endpoint that needs one; it is not describing existing behavior.

---

# Concurrency

Use optimistic concurrency control.

Requirements:

- version-based locking
- deterministic conflict detection
- HTTP 409 on conflict

**Current state:** no document in this codebase carries a version field or uses optimistic locking
today (import-run updates are single-writer, append-style). Apply this section when a change
introduces concurrent writers to the same document/record.

---

# API

Follow REST principles.

Prefer:

```
GET    /badges
POST   /badges
GET    /badges/{id}
PATCH  /badges/{id}
```

Avoid:

```
/createBadge
/updateBadge
/deleteBadge
```

This project's actual endpoints follow the same resource-oriented shape — see
[README.txt](README.txt)'s "API reference" section for the real routes (`/imports`, `/events`,
`/logs`, `/stats`, `/reports`); `/badges` above is a generic illustrative example, not a route that
exists in this repo.

---

# Error Handling

Never throw raw `Error`.

Application exceptions must extend:

```ts
AppError
```

(`back-end/libs/shared/src/errors/base/app-error.ts`, exported via `@task1/shared/errors/index`).
Concrete error types live under `errors/{auth,internal,not-found,validation}/` in the same package
— reuse or extend one of those before adding a new category. `status-from-app-error.utility.ts`
maps each category to an HTTP status; add new mappings there if you add a new error category.

**Current state:** `ErrorCategory` (`errors/error-category.enum.ts`) also defines `CONFLICT`,
`RATE_LIMIT`, and `EXTERNAL`, but no concrete subclass or `status-from-app-error.utility.ts`
mapping exists for them yet — don't assume they're usable until both are added.

Error responses must follow a consistent contract.

---

# Forbidden Without Explicit Approval

Do not introduce:

- CQRS
- Event Sourcing
- Domain Events
- Repository pattern
- Generic CRUD frameworks
- Base service abstractions
- Background workers
- Caching
- Additional AWS services
- New infrastructure components

RabbitMQ and Redis are **not** on this list — they are already core, approved parts of the stack
(RabbitMQ is the inter-service transport; Redis stores RedisTimeSeries pipeline metrics and backs
health checks). "Caching" above refers to using Redis (or anything else) as an application cache,
which is not implemented and should not be added without an explicit ask.

---

# Before Completing Any Change

Verify:

## Architecture

- correct module boundaries
- no leaked persistence models
- no unnecessary abstractions

## Security

- authentication enforced
- authorization enforced
- validation added
- sensitive data not logged

## Database

- transaction boundaries correct (where transactions are actually in use — see "Transactions" above)
- concurrency handled (where concurrent writers actually exist — see "Concurrency" above)

## API

- REST semantics preserved
- error contract preserved

## Quality

- tests updated
- no duplicated logic
- no unrelated refactoring

---

# Additional Rules

Detailed rules are maintained separately:

- backend-development.md
- security.md
- api.md
- testing-development.md
