# API

# AI Skills

This project uses reusable AI skills located in:

skills/*.md
---

# Tech Stack

- Nest.js
- TypeScript
- PostgreSQL
- AWS
- pnpm
- Vitest

---

# AI Instructions

Always use Context7 MCP for:

- Nest.js
- PostgreSQL
- AWS
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

# Architecture

Current architecture:

```
HTTP
    │
Controller
    │
Application Service
    │
PostgreSQL
```

Do not introduce additional architectural layers unless explicitly requested.

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

No persistence layer is configured yet (previously Prisma; removed — to be
decided when persistence is added back).

Rules:

- Persistence models never leave the persistence boundary.
- Database access belongs only to the owning module.
- Do not introduce Repository pattern unless explicitly requested.

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

---

# Concurrency

Use optimistic concurrency control.

Requirements:

- version-based locking
- deterministic conflict detection
- HTTP 409 on conflict

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

---

# Error Handling

Never throw raw `Error`.

Application exceptions must extend:

```ts
AppException
```

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
- Message brokers
- Redis
- Caching
- Additional AWS services
- New infrastructure components

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

- transaction boundaries correct
- concurrency handled

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