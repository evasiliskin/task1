# Gateway Aggregated Health-Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the gateway's two per-service health routes with a single
aggregated `GET /health`, plus `GET /health/live` and `GET /health/ready`,
covering six independently-checked dependencies: the gateway process,
RabbitMQ broker connectivity, Service A, Service B, MongoDB, and Redis.

**Architecture:** `HealthController` → `HealthCheckService` → six
`HealthIndicatorService`-based indicators (one new "gateway" self-check, one
new RabbitMQ broker-connection check, the existing RabbitMQ `health.check`
RPC ping reused twice for Service A/B, and two new indicators for MongoDB
and Redis). `HealthCheckService` always runs all six via Terminus's
`HealthCheckService.check()`, catches Terminus's own throw-on-any-down
behavior internally, and shapes the result into `{status, services}`.
Readiness treats RabbitMQ/Service A/Service B as critical (503 if down) and
MongoDB/Redis as informational only.

**Tech Stack:** NestJS 11, `@nestjs/terminus`, `@nestjs/microservices` (RMQ),
`amqp-connection-manager`, `mongodb` (native driver, new), `ioredis` (new),
`@nestjs/swagger` (new), Zod config validation, Vitest.

**Design spec:** `docs/superpowers/specs/2026-08-12-gateway-health-check-design.md`
— read it first; this plan implements it exactly, including its two
"implementation note" corrections (Terminus's throw-on-any-down behavior,
and why `/health/ready` must not throw through the existing
`GlobalExceptionFilter`).

## Global Constraints

- Never create git commits. Per `CLAUDE.md`, the user commits their own
  work — every task below ends with staging changes (`git add`), not
  committing.
- All env-derived config lives in `back-end/gateway/src/config/*.config.ts`
  as a Zod-validated `registerAs(...)` factory. Nothing else reads
  `process.env` directly.
- Never throw a raw `Error`. This plan reuses NestJS/Terminus's own
  `HttpException` subclasses (already the established pattern for health
  checks in this codebase) — no new exception types are needed.
- Tests are Vitest, colocated as `src/**/*.spec.ts` (unit) or
  `*.int.spec.ts` (HTTP integration via `supertest`), BDD-style
  `describe`/`it('should X, when Y')`. Coverage thresholds are 90%
  lines/branches (`vitest.config.mts`) — do not drop below them.
- `@typescript-eslint/explicit-member-accessibility` is enforced — every
  class member needs `public`/`private`/`protected`.
- `security/detect-object-injection` is enforced (`error` severity) — never
  write `obj[someVariable]`; use literal property access or
  `Object.fromEntries`/`.map()` instead.
- Run `pnpm --filter gateway lint` at the end of each task; let `--fix`
  resolve import ordering (`import-x/order`: builtin/external group, blank
  line, then relative imports, alphabetized).
- MongoDB/Redis clients are added *only* for health-check pinging — do not
  wire them into any business logic, caching, or persistence anywhere else.

---

## Task 1: Close the missing timeout test on the existing RabbitMQ ping indicator

Requirement 17.7 ("timeout while waiting for a microservice") has no test
today. `RabbitMqPingHealthIndicator` already implements the timeout
(`rabbitmq-ping.health-indicator.ts:21`, `timeout(this.config.pingTimeoutMs)`)
but nothing exercises it. No production code changes in this task.

> **Correction (verified against the code on re-check):** the plan below
> originally assumed a 2-arg `RabbitMqPingHealthIndicator` constructor. The
> correlation-id/request-id effort (`2026-08-12-correlation-request-id-design.md`)
> has since landed, and the real constructor is
> `(healthIndicatorService, requestContextService, config)` — it also calls
> `this.requestContextService.requireContext()` internally, so any test must
> run through `RequestContextService.run(...)`. The step below is corrected
> accordingly; see also Task 8's correction for requirement 13 logging, which
> was descoped in the design doc for the same now-resolved reason.

**Files:**
- Modify: `back-end/gateway/src/health/rabbitmq-ping.health-indicator.spec.ts`

**Interfaces:**
- Consumes: `RabbitMqPingHealthIndicator` (existing, unchanged) — constructor
  `(healthIndicatorService: HealthIndicatorService, requestContextService: RequestContextService, config: ConfigType<typeof rabbitmqConfig>)`,
  method `isHealthy(key: string, client: ClientProxy): Promise<HealthIndicatorResult>`.

- [ ] **Step 1: Add the failing timeout test**

Add `NEVER` to the existing `rxjs` import at the top of the file (change
`import { of, throwError } from 'rxjs';` to
`import { NEVER, of, throwError } from 'rxjs';`), then add this test inside
the existing `describe('RabbitMqPingHealthIndicator', ...)` block, after the
existing tests (use the file's own `requestContextService`/`runWithinContext`
helpers, not a bare constructor call):

```typescript
  it('should report the indicator as down, when the target service does not reply within the configured timeout', async () => {
    const expectedResult = { 'service-b': { status: 'down', message: 'timed out' } };
    downMock.mockReturnValue(expectedResult);

    const healthIndicatorService = {
      check: vi.fn().mockReturnValue({ up: upMock, down: downMock }),
    } as unknown as HealthIndicatorService;

    const shortTimeoutIndicator = new RabbitMqPingHealthIndicator(healthIndicatorService, requestContextService, {
      pingTimeoutMs: 10,
    } as ConfigType<typeof rabbitmqConfig>);

    const client = {
      send: vi.fn().mockReturnValue(NEVER),
    } as unknown as ClientProxy;

    const result = await runWithinContext(() => shortTimeoutIndicator.isHealthy('service-b', client));

    expect(result).toEqual(expectedResult);
    expect(downMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) }),
    );
  });
```

Note: this asserts `downMock` was called with *some* string message (not the
exact RxJS `TimeoutError` wording), since that wording is an RxJS
implementation detail, not part of our contract.

- [ ] **Step 2: Run it and confirm it currently passes for the wrong reason (sanity check), then verify the timeout actually fires**

Run:
```bash
pnpm --filter gateway test -- src/health/rabbitmq-ping.health-indicator.spec.ts
```
Expected: all 4 tests PASS (including the new one) in well under 3 seconds —
if the suite takes ~10 seconds or longer, the `NEVER` observable is not
actually triggering the 10ms timeout and the test is silently relying on
something else; re-check the `pingTimeoutMs: 10` override took effect.

- [ ] **Step 3: Lint and stage**

```bash
pnpm --filter gateway lint
git add back-end/gateway/src/health/rabbitmq-ping.health-indicator.spec.ts
```

---

## Task 2: Gateway self-liveness indicator

**Files:**
- Create: `back-end/gateway/src/health/indicators/gateway.health-indicator.ts`
- Test: `back-end/gateway/src/health/indicators/gateway.health-indicator.spec.ts`

**Interfaces:**
- Produces: `GatewayHealthIndicator` — constructor
  `(healthIndicatorService: HealthIndicatorService)`, method
  `isHealthy(key: string): HealthIndicatorResult` (synchronous, no I/O).

- [ ] **Step 1: Write the failing test**

```typescript
import { type HealthIndicatorService } from '@nestjs/terminus';

import { GatewayHealthIndicator } from './gateway.health-indicator';

describe('GatewayHealthIndicator', () => {
  it('should report the indicator as up, when checked', () => {
    const upMock = vi.fn().mockReturnValue({ gateway: { status: 'up' } });
    const healthIndicatorService = {
      check: vi.fn().mockReturnValue({ up: upMock, down: vi.fn() }),
    } as unknown as HealthIndicatorService;

    const indicator = new GatewayHealthIndicator(healthIndicatorService);

    const result = indicator.isHealthy('gateway');

    expect(result).toEqual({ gateway: { status: 'up' } });
    expect(upMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter gateway test -- src/health/indicators/gateway.health-indicator.spec.ts
```
Expected: FAIL — `Cannot find module './gateway.health-indicator'`.

- [ ] **Step 3: Write the implementation**

```typescript
import { Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';

@Injectable()
export class GatewayHealthIndicator {
  public constructor(private readonly healthIndicatorService: HealthIndicatorService) {}

  public isHealthy(key: string): HealthIndicatorResult {
    return this.healthIndicatorService.check(key).up();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter gateway test -- src/health/indicators/gateway.health-indicator.spec.ts
```
Expected: PASS (1 test).

- [ ] **Step 5: Lint and stage**

```bash
pnpm --filter gateway lint
git add back-end/gateway/src/health/indicators/gateway.health-indicator.ts back-end/gateway/src/health/indicators/gateway.health-indicator.spec.ts
```

---

## Task 3: RabbitMQ broker connection indicator

Distinguishes "the broker itself is unreachable" from "Service A/B isn't
responding" (design spec, "Why RabbitMQ and Service A/B are checked
separately"). Uses its own long-lived `amqp-connection-manager` connection,
injected via a DI token so it stays mockable like the existing
`ClientProxy` tokens.

**Files:**
- Modify: `back-end/gateway/src/health/rabbitmq-clients.tokens.ts`
- Create: `back-end/gateway/src/health/indicators/rabbitmq-connection.health-indicator.ts`
- Test: `back-end/gateway/src/health/indicators/rabbitmq-connection.health-indicator.spec.ts`

**Interfaces:**
- Produces: token `RABBITMQ_CONNECTION_MANAGER` (string constant).
- Produces: `RabbitMqConnectionHealthIndicator` — constructor
  `(healthIndicatorService: HealthIndicatorService, connectionManager: AmqpConnectionManager)`,
  method `isHealthy(key: string): HealthIndicatorResult`, lifecycle method
  `onModuleDestroy(): Promise<void>`.
- Consumed by: Task 8 (registers the `RABBITMQ_CONNECTION_MANAGER` provider
  in `health.module.ts` and injects this indicator into `HealthCheckService`).

- [ ] **Step 1: Add the new token**

In `back-end/gateway/src/health/rabbitmq-clients.tokens.ts`, add a third
line:

```typescript
export const SERVICE_B_RMQ_CLIENT = 'SERVICE_B_RMQ_CLIENT';
export const SERVICE_A_RMQ_CLIENT = 'SERVICE_A_RMQ_CLIENT';
export const RABBITMQ_CONNECTION_MANAGER = 'RABBITMQ_CONNECTION_MANAGER';
```

- [ ] **Step 2: Write the failing test**

```typescript
import { type HealthIndicatorService } from '@nestjs/terminus';
import { type AmqpConnectionManager } from 'amqp-connection-manager';

import { RabbitMqConnectionHealthIndicator } from './rabbitmq-connection.health-indicator';

describe('RabbitMqConnectionHealthIndicator', () => {
  let upMock: ReturnType<typeof vi.fn>;
  let downMock: ReturnType<typeof vi.fn>;
  let healthIndicatorService: HealthIndicatorService;

  beforeEach(() => {
    upMock = vi.fn();
    downMock = vi.fn();
    healthIndicatorService = {
      check: vi.fn().mockReturnValue({ up: upMock, down: downMock }),
    } as unknown as HealthIndicatorService;
  });

  it('should report the indicator as up, when the broker connection is open', () => {
    const expectedResult = { rabbitmq: { status: 'up' } };
    upMock.mockReturnValue(expectedResult);

    const connectionManager = {
      isConnected: vi.fn().mockReturnValue(true),
    } as unknown as AmqpConnectionManager;
    const indicator = new RabbitMqConnectionHealthIndicator(healthIndicatorService, connectionManager);

    expect(indicator.isHealthy('rabbitmq')).toEqual(expectedResult);
  });

  it('should report the indicator as down, when the broker connection is closed', () => {
    const expectedResult = { rabbitmq: { status: 'down', message: 'not connected to the RabbitMQ broker' } };
    downMock.mockReturnValue(expectedResult);

    const connectionManager = {
      isConnected: vi.fn().mockReturnValue(false),
    } as unknown as AmqpConnectionManager;
    const indicator = new RabbitMqConnectionHealthIndicator(healthIndicatorService, connectionManager);

    expect(indicator.isHealthy('rabbitmq')).toEqual(expectedResult);
    expect(downMock).toHaveBeenCalledWith({ message: 'not connected to the RabbitMQ broker' });
  });

  it('should close the underlying connection manager, when the module is destroyed', async () => {
    const closeMock = vi.fn().mockResolvedValue(undefined);
    const connectionManager = {
      isConnected: vi.fn(),
      close: closeMock,
    } as unknown as AmqpConnectionManager;
    const indicator = new RabbitMqConnectionHealthIndicator(healthIndicatorService, connectionManager);

    await indicator.onModuleDestroy();

    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter gateway test -- src/health/indicators/rabbitmq-connection.health-indicator.spec.ts
```
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```typescript
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { type AmqpConnectionManager } from 'amqp-connection-manager';

import { RABBITMQ_CONNECTION_MANAGER } from '../rabbitmq-clients.tokens';

@Injectable()
export class RabbitMqConnectionHealthIndicator implements OnModuleDestroy {
  public constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(RABBITMQ_CONNECTION_MANAGER) private readonly connectionManager: AmqpConnectionManager,
  ) {}

  public isHealthy(key: string): HealthIndicatorResult {
    const indicator = this.healthIndicatorService.check(key);

    if (this.connectionManager.isConnected()) {
      return indicator.up();
    }

    return indicator.down({ message: 'not connected to the RabbitMQ broker' });
  }

  public async onModuleDestroy(): Promise<void> {
    await this.connectionManager.close();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter gateway test -- src/health/indicators/rabbitmq-connection.health-indicator.spec.ts
```
Expected: PASS (3 tests).

- [ ] **Step 6: Lint and stage**

```bash
pnpm --filter gateway lint
git add back-end/gateway/src/health/rabbitmq-clients.tokens.ts back-end/gateway/src/health/indicators/rabbitmq-connection.health-indicator.ts back-end/gateway/src/health/indicators/rabbitmq-connection.health-indicator.spec.ts
```

---

## Task 4: MongoDB config

Mirrors `back-end/gateway/src/config/rabbitmq.config.ts` exactly.

**Files:**
- Create: `back-end/gateway/src/config/mongodb.config.ts`
- Test: `back-end/gateway/src/config/mongodb.config.spec.ts`

**Interfaces:**
- Produces: default export `mongodbConfig` — `registerAs('mongodb', ...)`
  factory returning `{ uri: string; pingTimeoutMs: number }`; also exposes
  `mongodbConfig.KEY` (the `@nestjs/config` namespace token) for DI.
- Consumed by: Task 5 (`MongoHealthIndicator`), Task 8 (`health.module.ts`),
  Task 9 (`app.module.ts`'s `ConfigModule.forRoot({ load: [...] })`).

- [ ] **Step 1: Write the failing test**

```typescript
import mongodbConfig from './mongodb.config';

describe('mongodbConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return documented defaults, when no environment variables are set', () => {
      delete process.env.MONGODB_URI;
      delete process.env.MONGODB_PING_TIMEOUT_MS;

      expect(mongodbConfig()).toEqual({
        uri: 'mongodb://localhost:27017/gateway',
        pingTimeoutMs: 3000,
      });
    });
  });

  describe('environment overrides', () => {
    it('should parse values from environment variables, when all variables are set', () => {
      process.env.MONGODB_URI = 'mongodb://user:pass@mongo-host:27017/custom-db';
      process.env.MONGODB_PING_TIMEOUT_MS = '5000';

      expect(mongodbConfig()).toEqual({
        uri: 'mongodb://user:pass@mongo-host:27017/custom-db',
        pingTimeoutMs: 5000,
      });
    });
  });

  describe('validation', () => {
    it('should throw, when MONGODB_URI is not a valid url', () => {
      process.env.MONGODB_URI = 'not-a-valid-url';

      expect(() => mongodbConfig()).toThrow();
    });

    it('should throw, when MONGODB_PING_TIMEOUT_MS is not a positive number', () => {
      process.env.MONGODB_PING_TIMEOUT_MS = '-1';

      expect(() => mongodbConfig()).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter gateway test -- src/config/mongodb.config.spec.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const mongodbConfigSchema = z.object({
  uri: z.url().default('mongodb://localhost:27017/gateway'),
  pingTimeoutMs: z.coerce.number().int().positive().default(3000),
});

export type MongodbConfiguration = z.infer<typeof mongodbConfigSchema>;

export default registerAs('mongodb', (): MongodbConfiguration =>
  mongodbConfigSchema.parse({
    uri: process.env.MONGODB_URI,
    pingTimeoutMs: process.env.MONGODB_PING_TIMEOUT_MS,
  }),
);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter gateway test -- src/config/mongodb.config.spec.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Lint and stage**

```bash
pnpm --filter gateway lint
git add back-end/gateway/src/config/mongodb.config.ts back-end/gateway/src/config/mongodb.config.spec.ts
```

---

## Task 5: MongoDB health indicator

**Files:**
- Modify: `back-end/gateway/package.json` (add `mongodb` dependency)
- Create: `back-end/gateway/src/health/infra-clients.tokens.ts`
- Create: `back-end/gateway/src/health/indicators/mongo.health-indicator.ts`
- Test: `back-end/gateway/src/health/indicators/mongo.health-indicator.spec.ts`

**Interfaces:**
- Consumes: `mongodbConfig` from Task 4.
- Produces: token `MONGO_CLIENT` (in `infra-clients.tokens.ts`, alongside
  `REDIS_CLIENT` added in Task 7).
- Produces: `MongoHealthIndicator` — constructor
  `(healthIndicatorService: HealthIndicatorService, client: MongoClient, config: ConfigType<typeof mongodbConfig>)`,
  method `isHealthy(key: string): Promise<HealthIndicatorResult>`.
- Consumed by: Task 8 (`health.module.ts`, `HealthCheckService`).

- [ ] **Step 1: Add the `mongodb` dependency**

```bash
pnpm --filter gateway add mongodb@^7.5.0
```

- [ ] **Step 2: Create the token file**

```typescript
export const MONGO_CLIENT = 'MONGO_CLIENT';
export const REDIS_CLIENT = 'REDIS_CLIENT';
```

Save as `back-end/gateway/src/health/infra-clients.tokens.ts`.

- [ ] **Step 3: Write the failing test**

```typescript
import { type ConfigType } from '@nestjs/config';
import { type HealthIndicatorService } from '@nestjs/terminus';
import { type MongoClient } from 'mongodb';

import type mongodbConfig from '../../config/mongodb.config';

import { MongoHealthIndicator } from './mongo.health-indicator';

describe('MongoHealthIndicator', () => {
  let upMock: ReturnType<typeof vi.fn>;
  let downMock: ReturnType<typeof vi.fn>;
  let healthIndicatorService: HealthIndicatorService;
  const config = { pingTimeoutMs: 3000 } as ConfigType<typeof mongodbConfig>;

  beforeEach(() => {
    upMock = vi.fn();
    downMock = vi.fn();
    healthIndicatorService = {
      check: vi.fn().mockReturnValue({ up: upMock, down: downMock }),
    } as unknown as HealthIndicatorService;
  });

  it('should report the indicator as up, when the ping command resolves', async () => {
    const expectedResult = { mongodb: { status: 'up' } };
    upMock.mockReturnValue(expectedResult);

    const client = {
      db: vi.fn().mockReturnValue({ command: vi.fn().mockResolvedValue({ ok: 1 }) }),
    } as unknown as MongoClient;

    const indicator = new MongoHealthIndicator(healthIndicatorService, client, config);

    expect(await indicator.isHealthy('mongodb')).toEqual(expectedResult);
  });

  it('should report the indicator as down, when the ping command rejects', async () => {
    const expectedResult = { mongodb: { status: 'down', message: 'connection refused' } };
    downMock.mockReturnValue(expectedResult);

    const client = {
      db: vi.fn().mockReturnValue({ command: vi.fn().mockRejectedValue(new Error('connection refused')) }),
    } as unknown as MongoClient;

    const indicator = new MongoHealthIndicator(healthIndicatorService, client, config);

    expect(await indicator.isHealthy('mongodb')).toEqual(expectedResult);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
pnpm --filter gateway test -- src/health/indicators/mongo.health-indicator.spec.ts
```
Expected: FAIL — module not found.

- [ ] **Step 5: Write the implementation**

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { type MongoClient } from 'mongodb';
import { firstValueFrom, from, timeout } from 'rxjs';

import mongodbConfig from '../../config/mongodb.config';

import { MONGO_CLIENT } from '../infra-clients.tokens';

@Injectable()
export class MongoHealthIndicator {
  public constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
    @Inject(mongodbConfig.KEY) private readonly config: ConfigType<typeof mongodbConfig>,
  ) {}

  public async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    try {
      await firstValueFrom(
        from(this.client.db().command({ ping: 1 })).pipe(timeout(this.config.pingTimeoutMs)),
      );

      return indicator.up();
    } catch (error) {
      return indicator.down({ message: error instanceof Error ? error.message : 'unknown error' });
    }
  }
}
```

Save as `back-end/gateway/src/health/indicators/mongo.health-indicator.ts`.

- [ ] **Step 6: Run test to verify it passes**

```bash
pnpm --filter gateway test -- src/health/indicators/mongo.health-indicator.spec.ts
```
Expected: PASS (2 tests).

- [ ] **Step 7: Lint and stage**

```bash
pnpm --filter gateway lint
git add back-end/gateway/package.json back-end/gateway/src/health/infra-clients.tokens.ts back-end/gateway/src/health/indicators/mongo.health-indicator.ts back-end/gateway/src/health/indicators/mongo.health-indicator.spec.ts
```

---

## Task 6: Redis config

Mirrors Task 4 exactly, for Redis.

**Files:**
- Create: `back-end/gateway/src/config/redis.config.ts`
- Test: `back-end/gateway/src/config/redis.config.spec.ts`

**Interfaces:**
- Produces: default export `redisConfig` — `registerAs('redis', ...)`
  factory returning `{ url: string; pingTimeoutMs: number }`; also exposes
  `redisConfig.KEY`.
- Consumed by: Task 7 (`RedisHealthIndicator`), Task 8 (`health.module.ts`),
  Task 9 (`app.module.ts`).

- [ ] **Step 1: Write the failing test**

```typescript
import redisConfig from './redis.config';

describe('redisConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return documented defaults, when no environment variables are set', () => {
      delete process.env.REDIS_URL;
      delete process.env.REDIS_PING_TIMEOUT_MS;

      expect(redisConfig()).toEqual({
        url: 'redis://localhost:6379',
        pingTimeoutMs: 3000,
      });
    });
  });

  describe('environment overrides', () => {
    it('should parse values from environment variables, when all variables are set', () => {
      process.env.REDIS_URL = 'redis://redis-host:6380';
      process.env.REDIS_PING_TIMEOUT_MS = '5000';

      expect(redisConfig()).toEqual({
        url: 'redis://redis-host:6380',
        pingTimeoutMs: 5000,
      });
    });
  });

  describe('validation', () => {
    it('should throw, when REDIS_URL is not a valid url', () => {
      process.env.REDIS_URL = 'not-a-valid-url';

      expect(() => redisConfig()).toThrow();
    });

    it('should throw, when REDIS_PING_TIMEOUT_MS is not a positive number', () => {
      process.env.REDIS_PING_TIMEOUT_MS = '-1';

      expect(() => redisConfig()).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter gateway test -- src/config/redis.config.spec.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const redisConfigSchema = z.object({
  url: z.url().default('redis://localhost:6379'),
  pingTimeoutMs: z.coerce.number().int().positive().default(3000),
});

export type RedisConfiguration = z.infer<typeof redisConfigSchema>;

export default registerAs('redis', (): RedisConfiguration =>
  redisConfigSchema.parse({
    url: process.env.REDIS_URL,
    pingTimeoutMs: process.env.REDIS_PING_TIMEOUT_MS,
  }),
);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter gateway test -- src/config/redis.config.spec.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Lint and stage**

```bash
pnpm --filter gateway lint
git add back-end/gateway/src/config/redis.config.ts back-end/gateway/src/config/redis.config.spec.ts
```

---

## Task 7: Redis health indicator

**Files:**
- Modify: `back-end/gateway/package.json` (add `ioredis` dependency)
- Create: `back-end/gateway/src/health/indicators/redis.health-indicator.ts`
- Test: `back-end/gateway/src/health/indicators/redis.health-indicator.spec.ts`

**Interfaces:**
- Consumes: `redisConfig` from Task 6, `REDIS_CLIENT` token from Task 5's
  `infra-clients.tokens.ts`.
- Produces: `RedisHealthIndicator` — constructor
  `(healthIndicatorService: HealthIndicatorService, client: Redis, config: ConfigType<typeof redisConfig>)`,
  method `isHealthy(key: string): Promise<HealthIndicatorResult>`.
- Consumed by: Task 8 (`health.module.ts`, `HealthCheckService`).

- [ ] **Step 1: Add the `ioredis` dependency**

```bash
pnpm --filter gateway add ioredis@^6.0.0
```

- [ ] **Step 2: Write the failing test**

```typescript
import { type ConfigType } from '@nestjs/config';
import { type HealthIndicatorService } from '@nestjs/terminus';
import { type Redis } from 'ioredis';

import type redisConfig from '../../config/redis.config';

import { RedisHealthIndicator } from './redis.health-indicator';

describe('RedisHealthIndicator', () => {
  let upMock: ReturnType<typeof vi.fn>;
  let downMock: ReturnType<typeof vi.fn>;
  let healthIndicatorService: HealthIndicatorService;
  const config = { pingTimeoutMs: 3000 } as ConfigType<typeof redisConfig>;

  beforeEach(() => {
    upMock = vi.fn();
    downMock = vi.fn();
    healthIndicatorService = {
      check: vi.fn().mockReturnValue({ up: upMock, down: downMock }),
    } as unknown as HealthIndicatorService;
  });

  it('should report the indicator as up, when ping resolves', async () => {
    const expectedResult = { redis: { status: 'up' } };
    upMock.mockReturnValue(expectedResult);

    const client = { ping: vi.fn().mockResolvedValue('PONG') } as unknown as Redis;

    const indicator = new RedisHealthIndicator(healthIndicatorService, client, config);

    expect(await indicator.isHealthy('redis')).toEqual(expectedResult);
  });

  it('should report the indicator as down, when ping rejects', async () => {
    const expectedResult = { redis: { status: 'down', message: 'connection refused' } };
    downMock.mockReturnValue(expectedResult);

    const client = { ping: vi.fn().mockRejectedValue(new Error('connection refused')) } as unknown as Redis;

    const indicator = new RedisHealthIndicator(healthIndicatorService, client, config);

    expect(await indicator.isHealthy('redis')).toEqual(expectedResult);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter gateway test -- src/health/indicators/redis.health-indicator.spec.ts
```
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { type Redis } from 'ioredis';
import { firstValueFrom, from, timeout } from 'rxjs';

import redisConfig from '../../config/redis.config';

import { REDIS_CLIENT } from '../infra-clients.tokens';

@Injectable()
export class RedisHealthIndicator {
  public constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    @Inject(redisConfig.KEY) private readonly config: ConfigType<typeof redisConfig>,
  ) {}

  public async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    try {
      await firstValueFrom(from(this.client.ping()).pipe(timeout(this.config.pingTimeoutMs)));

      return indicator.up();
    } catch (error) {
      return indicator.down({ message: error instanceof Error ? error.message : 'unknown error' });
    }
  }
}
```

Save as `back-end/gateway/src/health/indicators/redis.health-indicator.ts`.

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter gateway test -- src/health/indicators/redis.health-indicator.spec.ts
```
Expected: PASS (2 tests).

- [ ] **Step 6: Lint and stage**

```bash
pnpm --filter gateway lint
git add back-end/gateway/package.json back-end/gateway/src/health/indicators/redis.health-indicator.ts back-end/gateway/src/health/indicators/redis.health-indicator.spec.ts
```

---

## Task 8: `HealthCheckService` orchestration + module wiring

This is the core of the feature: aggregates all six indicators, shapes the
`{status, services}` contract, and implements the readiness criticality
split. Also updates `health.module.ts` to register every provider from
Tasks 2–7. The old `HealthController` (still `/health/service-a`,
`/health/service-b`) is left untouched and still works after this task —
it's rewritten in Task 9.

> **Correction — requirement 13 is no longer descoped.** The design doc's
> "Decisions made during brainstorming" #3 skipped structured logging because
> at the time no logging/correlation-id module existed. It has since landed
> (`back-end/gateway/src/core/logger/` — `LoggerService.getLogger(source, channel)`
> returns an `AppLogger` with `.error(fields, message)`; `back-end/gateway/src/core/request-context/`
> — `RequestContextService.getCorrelationId()` / `.getRequestId()`, both
> non-throwing, safe to call outside a request context, returning
> `undefined` there). Requirement 13 asks for exactly this: log failed health
> checks with service name, correlationId, requestId, error, and response
> time. Implement it in `HealthCheckService` (not in each indicator — one
> place, wrapping every indicator call, keeps this out of the six indicator
> classes and out of the controller):
>
> - Constructor gains one more param: `private readonly loggerService: LoggerService`
>   (from `../core/logger/logger.service`), and one field set in the
>   constructor body: `private readonly logger = this.loggerService.getLogger('HealthCheckService')`
>   (default `channel: 'http'` is correct here — these are HTTP-triggered checks).
> - Log from `runAllChecks()`, after `executeIndicators()` resolves — not by
>   wrapping the six functions passed to `this.terminus.check([...])`. Every
>   existing/planned unit test in this file mocks `terminus.check` itself
>   (`vi.fn().mockResolvedValue(...)`/`mockRejectedValue(...)`) and never
>   actually invokes the callbacks passed to it, so per-indicator wrapping
>   would be untestable dead code under this suite's established mocking
>   convention. Instead, time the one call to `executeIndicators()` as a
>   whole (one elapsed value per request — satisfies "response time if
>   practical" without needing per-indicator instrumentation), then iterate
>   the resolved `details` and log each one that is down:
>   ```typescript
>   private async runAllChecks(): Promise<AggregatedHealth> {
>     const startedAt = Date.now();
>     const raw = await this.executeIndicators();
>     const responseTimeMs = Date.now() - startedAt;
>
>     this.logFailures(raw.details, responseTimeMs);
>
>     const services: AggregatedHealth['services'] = {
>       gateway: raw.details.gateway?.status === 'up' ? 'ok' : 'unavailable',
>       rabbitmq: raw.details.rabbitmq?.status === 'up' ? 'ok' : 'unavailable',
>       serviceA: raw.details.serviceA?.status === 'up' ? 'ok' : 'unavailable',
>       serviceB: raw.details.serviceB?.status === 'up' ? 'ok' : 'unavailable',
>       mongodb: raw.details.mongodb?.status === 'up' ? 'ok' : 'unavailable',
>       redis: raw.details.redis?.status === 'up' ? 'ok' : 'unavailable',
>     };
>
>     const status: AggregatedHealth['status'] = Object.values(services).every((value) => value === 'ok')
>       ? 'ok'
>       : 'degraded';
>
>     return { status, services };
>   }
>
>   private logFailures(details: HealthCheckResult['details'], responseTimeMs: number): void {
>     const correlationId = this.requestContextService.getCorrelationId();
>     const requestId = this.requestContextService.getRequestId();
>
>     Object.entries(details).forEach(([service, detail]) => {
>       if (detail.status === 'down') {
>         this.logger.error(
>           { service, correlationId, requestId, error: detail.message, responseTimeMs },
>           `health check failed for ${service}`,
>         );
>       }
>     });
>   }
>   ```
>   This needs `RequestContextService` injected too (import from
>   `../core/request-context/request-context.service`) — add it as another
>   constructor param. `executeIndicators()` itself is unchanged from the
>   version below (plain lambdas, no wrapping).
> - `health.module.ts` (Step 5 below) must import `LoggerModule` (from
>   `../core/logger/logger.module`) — it is not `@Global()`, so `HealthModule`
>   needs it explicitly. `RequestContextService` *is* provided by the
>   `@Global()` `RequestContextModule` already imported at the app root, so no
>   extra import is needed for it.
> - Update the Step 1 test's `buildService()` helper to pass a stub
>   `LoggerService` (`{ getLogger: vi.fn().mockReturnValue({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn() }) } as unknown as LoggerService`)
>   and a real `new RequestContextService()` as the two extra constructor
>   args, and add one new test: "should log the failure with service name,
>   error, and response time, when a dependency is down" — assert the stub
>   logger's `error` mock was called with an object containing
>   `service: 'serviceB'` and `error: 'connection refused'` (build via
>   `buildRejection(['serviceB'])`).

**Files:**
- Create: `back-end/gateway/src/health/health-check.service.ts`
- Test: `back-end/gateway/src/health/health-check.service.spec.ts`
- Modify: `back-end/gateway/src/health/health.module.ts`

**Interfaces:**
- Consumes: `GatewayHealthIndicator` (Task 2), `RabbitMqConnectionHealthIndicator`
  (Task 3), `RabbitMqPingHealthIndicator` (existing), `MongoHealthIndicator`
  (Task 5), `RedisHealthIndicator` (Task 7), `SERVICE_A_RMQ_CLIENT`/
  `SERVICE_B_RMQ_CLIENT` (existing tokens), Terminus's own
  `HealthCheckService`.
- Produces: `HealthCheckService` — constructor
  `(terminus: TerminusHealthCheckService, gatewayIndicator: GatewayHealthIndicator, rabbitMqConnectionIndicator: RabbitMqConnectionHealthIndicator, rabbitMqPingIndicator: RabbitMqPingHealthIndicator, mongoIndicator: MongoHealthIndicator, redisIndicator: RedisHealthIndicator, serviceAClient: ClientProxy, serviceBClient: ClientProxy)`.
  Methods:
  - `getHealth(): Promise<AggregatedHealth>`
  - `getLiveness(): { status: 'ok'; service: 'gateway' }`
  - `getReadiness(): Promise<{ ready: boolean; result: AggregatedHealth }>`
- Produces types: `ServiceStatus = 'ok' | 'unavailable'`,
  `AggregatedHealth = { status: 'ok' | 'degraded'; services: { gateway: ServiceStatus; rabbitmq: ServiceStatus; serviceA: ServiceStatus; serviceB: ServiceStatus; mongodb: ServiceStatus; redis: ServiceStatus } }`.
- Consumed by: Task 9 (`HealthController`).

- [ ] **Step 1: Write the failing test**

```typescript
import { ServiceUnavailableException } from '@nestjs/common';
import { type ClientProxy } from '@nestjs/microservices';
import { type HealthCheckService as TerminusHealthCheckService } from '@nestjs/terminus';

import { type LoggerService } from '../core/logger/logger.service';
import { RequestContextService } from '../core/request-context/request-context.service';

import { HealthCheckService } from './health-check.service';
import { type GatewayHealthIndicator } from './indicators/gateway.health-indicator';
import { type MongoHealthIndicator } from './indicators/mongo.health-indicator';
import { type RabbitMqConnectionHealthIndicator } from './indicators/rabbitmq-connection.health-indicator';
import { type RedisHealthIndicator } from './indicators/redis.health-indicator';
import { type RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator';

const ALL_KEYS = ['gateway', 'rabbitmq', 'serviceA', 'serviceB', 'mongodb', 'redis'];

const ALL_UP_DETAILS = Object.fromEntries(ALL_KEYS.map((key) => [key, { status: 'up' }]));

function buildService(
  terminusCheck: ReturnType<typeof vi.fn>,
  loggerErrorMock: ReturnType<typeof vi.fn> = vi.fn(),
): HealthCheckService {
  const terminus = { check: terminusCheck } as unknown as TerminusHealthCheckService;
  const loggerService = {
    getLogger: vi.fn().mockReturnValue({
      error: loggerErrorMock,
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    }),
  } as unknown as LoggerService;

  return new HealthCheckService(
    terminus,
    {} as GatewayHealthIndicator,
    {} as RabbitMqConnectionHealthIndicator,
    {} as RabbitMqPingHealthIndicator,
    {} as MongoHealthIndicator,
    {} as RedisHealthIndicator,
    {} as ClientProxy,
    {} as ClientProxy,
    new RequestContextService(),
    loggerService,
  );
}

function buildRejection(downKeys: readonly string[]): ServiceUnavailableException {
  const entries = ALL_KEYS.map(
    (key): [string, { status: 'up' | 'down'; message?: string }] =>
      downKeys.includes(key) ? [key, { status: 'down', message: 'connection refused' }] : [key, { status: 'up' }],
  );

  const details = Object.fromEntries(entries);
  const info = Object.fromEntries(entries.filter(([, value]) => value.status === 'up'));
  const error = Object.fromEntries(entries.filter(([, value]) => value.status === 'down'));

  return new ServiceUnavailableException({ status: 'error', info, error, details });
}

describe('HealthCheckService', () => {
  describe('getHealth', () => {
    it('should return status ok with every service ok, when everything is healthy', async () => {
      const terminusCheck = vi
        .fn()
        .mockResolvedValue({ status: 'ok', info: ALL_UP_DETAILS, error: {}, details: ALL_UP_DETAILS });

      const result = await buildService(terminusCheck).getHealth();

      expect(result).toEqual({
        status: 'ok',
        services: { gateway: 'ok', rabbitmq: 'ok', serviceA: 'ok', serviceB: 'ok', mongodb: 'ok', redis: 'ok' },
      });
    });

    it('should mark serviceA as unavailable and report the rest as ok, when service-a is unavailable', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['serviceA']));

      const result = await buildService(terminusCheck).getHealth();

      expect(result).toEqual({
        status: 'degraded',
        services: { gateway: 'ok', rabbitmq: 'ok', serviceA: 'unavailable', serviceB: 'ok', mongodb: 'ok', redis: 'ok' },
      });
    });

    it('should mark serviceB as unavailable and report the rest as ok, when service-b is unavailable', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['serviceB']));

      const result = await buildService(terminusCheck).getHealth();

      expect(result.services).toEqual({
        gateway: 'ok',
        rabbitmq: 'ok',
        serviceA: 'ok',
        serviceB: 'unavailable',
        mongodb: 'ok',
        redis: 'ok',
      });
    });

    it('should mark rabbitmq as unavailable and report the rest as ok, when the broker is unreachable', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['rabbitmq']));

      const result = await buildService(terminusCheck).getHealth();

      expect(result.services).toEqual({
        gateway: 'ok',
        rabbitmq: 'unavailable',
        serviceA: 'ok',
        serviceB: 'ok',
        mongodb: 'ok',
        redis: 'ok',
      });
    });

    it('should mark mongodb as unavailable and report the rest as ok, when MongoDB is unreachable', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['mongodb']));

      const result = await buildService(terminusCheck).getHealth();

      expect(result.services).toEqual({
        gateway: 'ok',
        rabbitmq: 'ok',
        serviceA: 'ok',
        serviceB: 'ok',
        mongodb: 'unavailable',
        redis: 'ok',
      });
    });

    it('should mark redis as unavailable and report the rest as ok, when Redis is unreachable', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['redis']));

      const result = await buildService(terminusCheck).getHealth();

      expect(result.services).toEqual({
        gateway: 'ok',
        rabbitmq: 'ok',
        serviceA: 'ok',
        serviceB: 'ok',
        mongodb: 'ok',
        redis: 'unavailable',
      });
    });

    it('should mark serviceB as unavailable, when its ping times out (indistinguishable from any other failure at this layer)', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['serviceB']));

      const result = await buildService(terminusCheck).getHealth();

      expect(result.status).toBe('degraded');
      expect(result.services.serviceB).toBe('unavailable');
    });

    it('should mark both serviceB and redis as unavailable independently, when both are down simultaneously', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['serviceB', 'redis']));

      const result = await buildService(terminusCheck).getHealth();

      expect(result).toEqual({
        status: 'degraded',
        services: { gateway: 'ok', rabbitmq: 'ok', serviceA: 'ok', serviceB: 'unavailable', mongodb: 'ok', redis: 'unavailable' },
      });
    });

    it('should log the failure with service name and error, and not log for services that are up, when a dependency is down', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['serviceB']));
      const loggerErrorMock = vi.fn();

      await buildService(terminusCheck, loggerErrorMock).getHealth();

      expect(loggerErrorMock).toHaveBeenCalledTimes(1);
      expect(loggerErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'serviceB',
          error: 'connection refused',
          responseTimeMs: expect.any(Number),
        }),
        expect.stringContaining('serviceB'),
      );
    });
  });

  describe('getReadiness', () => {
    it('should be ready, when only redis (non-critical) is unavailable', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['redis']));

      const { ready, result } = await buildService(terminusCheck).getReadiness();

      expect(ready).toBe(true);
      expect(result.services.redis).toBe('unavailable');
    });

    it('should not be ready, when service-a (critical) is unavailable', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['serviceA']));

      const { ready } = await buildService(terminusCheck).getReadiness();

      expect(ready).toBe(false);
    });

    it('should not be ready, when rabbitmq (critical) is unavailable even if redis (non-critical) is also down', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['rabbitmq', 'redis']));

      const { ready, result } = await buildService(terminusCheck).getReadiness();

      expect(ready).toBe(false);
      expect(result.services.redis).toBe('unavailable');
    });
  });

  describe('getLiveness', () => {
    it('should always return status ok without checking any dependency', () => {
      const terminusCheck = vi.fn();

      const result = buildService(terminusCheck).getLiveness();

      expect(result).toEqual({ status: 'ok', service: 'gateway' });
      expect(terminusCheck).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter gateway test -- src/health/health-check.service.spec.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { type ClientProxy } from '@nestjs/microservices';
import { HealthCheckService as TerminusHealthCheckService, type HealthCheckResult } from '@nestjs/terminus';

import { type AppLogger } from '../core/logger/app-logger';
import { LoggerService } from '../core/logger/logger.service';
import { RequestContextService } from '../core/request-context/request-context.service';

import { GatewayHealthIndicator } from './indicators/gateway.health-indicator';
import { MongoHealthIndicator } from './indicators/mongo.health-indicator';
import { RabbitMqConnectionHealthIndicator } from './indicators/rabbitmq-connection.health-indicator';
import { RedisHealthIndicator } from './indicators/redis.health-indicator';
import { SERVICE_A_RMQ_CLIENT, SERVICE_B_RMQ_CLIENT } from './rabbitmq-clients.tokens';
import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator';

export type ServiceStatus = 'ok' | 'unavailable';

export interface AggregatedHealth {
  status: 'ok' | 'degraded';
  services: {
    gateway: ServiceStatus;
    rabbitmq: ServiceStatus;
    serviceA: ServiceStatus;
    serviceB: ServiceStatus;
    mongodb: ServiceStatus;
    redis: ServiceStatus;
  };
}

@Injectable()
export class HealthCheckService {
  private readonly logger: AppLogger;

  public constructor(
    private readonly terminus: TerminusHealthCheckService,
    private readonly gatewayIndicator: GatewayHealthIndicator,
    private readonly rabbitMqConnectionIndicator: RabbitMqConnectionHealthIndicator,
    private readonly rabbitMqPingIndicator: RabbitMqPingHealthIndicator,
    private readonly mongoIndicator: MongoHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
    @Inject(SERVICE_A_RMQ_CLIENT) private readonly serviceAClient: ClientProxy,
    @Inject(SERVICE_B_RMQ_CLIENT) private readonly serviceBClient: ClientProxy,
    private readonly requestContextService: RequestContextService,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger('HealthCheckService');
  }

  public async getHealth(): Promise<AggregatedHealth> {
    return this.runAllChecks();
  }

  public getLiveness(): { status: 'ok'; service: 'gateway' } {
    return { status: 'ok', service: 'gateway' };
  }

  public async getReadiness(): Promise<{ ready: boolean; result: AggregatedHealth }> {
    const result = await this.runAllChecks();

    // Critical for readiness: rabbitmq, serviceA, serviceB — the gateway's
    // sole purpose is routing through them. mongodb/redis are informational
    // (nothing in the gateway's request path uses them today).
    const ready = result.services.rabbitmq === 'ok' && result.services.serviceA === 'ok' && result.services.serviceB === 'ok';

    return { ready, result };
  }

  private async runAllChecks(): Promise<AggregatedHealth> {
    const startedAt = Date.now();
    const raw = await this.executeIndicators();
    const responseTimeMs = Date.now() - startedAt;

    this.logFailures(raw.details, responseTimeMs);

    const services: AggregatedHealth['services'] = {
      gateway: raw.details.gateway?.status === 'up' ? 'ok' : 'unavailable',
      rabbitmq: raw.details.rabbitmq?.status === 'up' ? 'ok' : 'unavailable',
      serviceA: raw.details.serviceA?.status === 'up' ? 'ok' : 'unavailable',
      serviceB: raw.details.serviceB?.status === 'up' ? 'ok' : 'unavailable',
      mongodb: raw.details.mongodb?.status === 'up' ? 'ok' : 'unavailable',
      redis: raw.details.redis?.status === 'up' ? 'ok' : 'unavailable',
    };

    const status: AggregatedHealth['status'] = Object.values(services).every((value) => value === 'ok')
      ? 'ok'
      : 'degraded';

    return { status, services };
  }

  private async executeIndicators(): Promise<HealthCheckResult> {
    try {
      return await this.terminus.check([
        () => this.gatewayIndicator.isHealthy('gateway'),
        () => this.rabbitMqConnectionIndicator.isHealthy('rabbitmq'),
        () => this.rabbitMqPingIndicator.isHealthy('serviceA', this.serviceAClient),
        () => this.rabbitMqPingIndicator.isHealthy('serviceB', this.serviceBClient),
        () => this.mongoIndicator.isHealthy('mongodb'),
        () => this.redisIndicator.isHealthy('redis'),
      ]);
    } catch (error) {
      // Terminus's own check() throws ServiceUnavailableException as soon as
      // any indicator is down; its response body still holds every
      // indicator's result (up and down alike), so we recover it here
      // instead of letting the throw propagate — /health and /health/ready
      // decide what to do with a down dependency themselves.
      if (error instanceof ServiceUnavailableException) {
        return error.getResponse() as HealthCheckResult;
      }

      throw error;
    }
  }

  // Requirement 13: structured logging for failed health checks — service
  // name, correlationId, requestId, error, and the response time of the
  // overall check cycle. One place, not duplicated across six indicators.
  private logFailures(details: HealthCheckResult['details'], responseTimeMs: number): void {
    const correlationId = this.requestContextService.getCorrelationId();
    const requestId = this.requestContextService.getRequestId();

    Object.entries(details).forEach(([service, detail]) => {
      if (detail.status === 'down') {
        this.logger.error(
          { service, correlationId, requestId, error: detail.message, responseTimeMs },
          `health check failed for ${service}`,
        );
      }
    });
  }
}
```

Save as `back-end/gateway/src/health/health-check.service.ts`.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter gateway test -- src/health/health-check.service.spec.ts
```
Expected: PASS (12 tests, including the new logging test from the requirement-13
correction above).

- [ ] **Step 5: Wire everything into `health.module.ts`**

Replace the full contents of `back-end/gateway/src/health/health.module.ts`
with:

```typescript
import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { TerminusModule } from '@nestjs/terminus';
import * as amqp from 'amqp-connection-manager';
import { Redis } from 'ioredis';
import { MongoClient } from 'mongodb';

import mongodbConfig from '../config/mongodb.config';
import rabbitmqConfig from '../config/rabbitmq.config';
import redisConfig from '../config/redis.config';
import { LoggerModule } from '../core/logger/logger.module';

import { HealthCheckService } from './health-check.service';
import { HealthController } from './health.controller';
import { GatewayHealthIndicator } from './indicators/gateway.health-indicator';
import { MongoHealthIndicator } from './indicators/mongo.health-indicator';
import { RabbitMqConnectionHealthIndicator } from './indicators/rabbitmq-connection.health-indicator';
import { RedisHealthIndicator } from './indicators/redis.health-indicator';
import { MONGO_CLIENT, REDIS_CLIENT } from './infra-clients.tokens';
import {
  RABBITMQ_CONNECTION_MANAGER,
  SERVICE_A_RMQ_CLIENT,
  SERVICE_B_RMQ_CLIENT,
} from './rabbitmq-clients.tokens';
import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator';

@Module({
  imports: [
    TerminusModule,
    LoggerModule,
    ClientsModule.registerAsync([
      {
        name: SERVICE_B_RMQ_CLIENT,
        inject: [rabbitmqConfig.KEY],
        useFactory: (config: ConfigType<typeof rabbitmqConfig>) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.url],
            queue: config.serviceBQueue,
            queueOptions: { durable: true },
          },
        }),
      },
      {
        name: SERVICE_A_RMQ_CLIENT,
        inject: [rabbitmqConfig.KEY],
        useFactory: (config: ConfigType<typeof rabbitmqConfig>) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.url],
            queue: config.serviceAQueue,
            queueOptions: { durable: true },
          },
        }),
      },
    ]),
  ],
  controllers: [HealthController],
  providers: [
    HealthCheckService,
    RabbitMqPingHealthIndicator,
    GatewayHealthIndicator,
    RabbitMqConnectionHealthIndicator,
    MongoHealthIndicator,
    RedisHealthIndicator,
    {
      provide: RABBITMQ_CONNECTION_MANAGER,
      inject: [rabbitmqConfig.KEY],
      useFactory: (config: ConfigType<typeof rabbitmqConfig>) => amqp.connect([config.url]),
    },
    {
      provide: MONGO_CLIENT,
      inject: [mongodbConfig.KEY],
      useFactory: (config: ConfigType<typeof mongodbConfig>) => new MongoClient(config.uri),
    },
    {
      provide: REDIS_CLIENT,
      inject: [redisConfig.KEY],
      useFactory: (config: ConfigType<typeof redisConfig>) => {
        const client = new Redis(config.url, { lazyConnect: true });

        // ioredis emits 'error' on the lazily-connected client before the
        // first health check ever runs; without a listener, that would
        // crash the process (unhandled EventEmitter 'error' event).
        client.on('error', () => {});

        return client;
      },
    },
  ],
})
export class HealthModule {}
```

Note: this task deliberately does *not* change `health.controller.ts` — it
still exports the Task-1-era `HealthController` with the old
`/health/service-a`/`/health/service-b` routes, which still compile because
`RabbitMqPingHealthIndicator` and both `ClientProxy` tokens are untouched.
Task 9 replaces the controller.

- [ ] **Step 6: Run the full gateway test suite to confirm nothing broke**

```bash
pnpm --filter gateway test
```
Expected: PASS — all existing tests plus the new ones from Tasks 1–8.

- [ ] **Step 7: Lint and stage**

```bash
pnpm --filter gateway lint
git add back-end/gateway/src/health/health-check.service.ts back-end/gateway/src/health/health-check.service.spec.ts back-end/gateway/src/health/health.module.ts
```

---

## Task 9: Rewrite `HealthController` (`/health`, `/health/live`, `/health/ready`) + Swagger

Replaces the old two-route controller. Adds `@nestjs/swagger` and documents
the three new routes. Also registers the two new configs
(`mongodbConfig`, `redisConfig`) in `app.module.ts` and bootstraps Swagger in
`main.ts`.

**Files:**
- Modify: `back-end/gateway/package.json` (add `@nestjs/swagger`)
- Modify: `back-end/gateway/src/app.module.ts`
- Modify: `back-end/gateway/src/main.ts`
- Modify: `back-end/gateway/src/health/health.controller.ts`
- Modify: `back-end/gateway/src/health/health.controller.int.spec.ts`

**Interfaces:**
- Consumes: `HealthCheckService` from Task 8.

- [ ] **Step 1: Add the `@nestjs/swagger` dependency**

```bash
pnpm --filter gateway add @nestjs/swagger@^11.4.6
```

- [ ] **Step 2: Register the new configs in `app.module.ts`**

Replace the full contents of `back-end/gateway/src/app.module.ts` with:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import appConfig from './config/app.config';
import mongodbConfig from './config/mongodb.config';
import rabbitmqConfig from './config/rabbitmq.config';
import redisConfig from './config/redis.config';
import { ExceptionHandlingModule } from './core/exception-handling/exception-handling.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [appConfig, rabbitmqConfig, mongodbConfig, redisConfig],
    }),
    ExceptionHandlingModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Bootstrap Swagger in `main.ts`**

Replace the full contents of `back-end/gateway/src/main.ts` with:

```typescript
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import appConfig from './config/app.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder().setTitle('Gateway API').setVersion('1.0').build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, swaggerDocument);

  const { port } = appConfig();
  await app.listen(port);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 4: Rewrite the failing integration test**

Replace the full contents of
`back-end/gateway/src/health/health.controller.int.spec.ts` with:

```typescript
import { type INestApplication, HttpStatus } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { Test, type TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import request from 'supertest';
import type { App } from 'supertest/types';

import mongodbConfig from '../config/mongodb.config';
import rabbitmqConfig from '../config/rabbitmq.config';
import redisConfig from '../config/redis.config';

import { HealthModule } from './health.module';
import { MONGO_CLIENT, REDIS_CLIENT } from './infra-clients.tokens';
import {
  RABBITMQ_CONNECTION_MANAGER,
  SERVICE_A_RMQ_CLIENT,
  SERVICE_B_RMQ_CLIENT,
} from './rabbitmq-clients.tokens';

describe('HealthController (HTTP Integration)', () => {
  let app: INestApplication;
  let serviceAClient: { send: ReturnType<typeof vi.fn> };
  let serviceBClient: { send: ReturnType<typeof vi.fn> };
  let connectionManager: { isConnected: ReturnType<typeof vi.fn> };
  let mongoClient: { db: ReturnType<typeof vi.fn> };
  let redisClient: { ping: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    serviceAClient = { send: vi.fn() };
    serviceBClient = { send: vi.fn() };
    connectionManager = { isConnected: vi.fn() };
    mongoClient = { db: vi.fn() };
    redisClient = { ping: vi.fn() };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [rabbitmqConfig, mongodbConfig, redisConfig],
        }),
        HealthModule,
      ],
    })
      .overrideProvider(SERVICE_A_RMQ_CLIENT)
      .useValue(serviceAClient as unknown as ClientProxy)
      .overrideProvider(SERVICE_B_RMQ_CLIENT)
      .useValue(serviceBClient as unknown as ClientProxy)
      .overrideProvider(RABBITMQ_CONNECTION_MANAGER)
      .useValue(connectionManager)
      .overrideProvider(MONGO_CLIENT)
      .useValue(mongoClient)
      .overrideProvider(REDIS_CLIENT)
      .useValue(redisClient)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();

    serviceAClient.send.mockReturnValue(of({ status: 'ok' }));
    serviceBClient.send.mockReturnValue(of({ status: 'ok' }));
    connectionManager.isConnected.mockReturnValue(true);
    mongoClient.db.mockReturnValue({ command: vi.fn().mockResolvedValue({ ok: 1 }) });
    redisClient.ping.mockResolvedValue('PONG');
  });

  describe('GET /health', () => {
    it('should return 200 and status ok, when every dependency is healthy', async () => {
      const response = await request(app.getHttpServer() as App).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        services: { gateway: 'ok', rabbitmq: 'ok', serviceA: 'ok', serviceB: 'ok', mongodb: 'ok', redis: 'ok' },
      });
    });

    it('should return 200 and status degraded, when service-b is unavailable', async () => {
      serviceBClient.send.mockReturnValue(throwError(() => new Error('connection refused')));

      const response = await request(app.getHttpServer() as App).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'degraded',
        services: { gateway: 'ok', rabbitmq: 'ok', serviceA: 'ok', serviceB: 'unavailable', mongodb: 'ok', redis: 'ok' },
      });
    });
  });

  describe('GET /health/live', () => {
    it('should return 200 and status ok, without checking any dependency', async () => {
      const response = await request(app.getHttpServer() as App).get('/health/live');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok', service: 'gateway' });
      expect(serviceAClient.send).not.toHaveBeenCalled();
    });
  });

  describe('GET /health/ready', () => {
    it('should return 200, when all critical dependencies are healthy even if redis is down', async () => {
      redisClient.ping.mockRejectedValue(new Error('connection refused'));

      const response = await request(app.getHttpServer() as App).get('/health/ready');

      expect(response.status).toBe(200);
      expect(response.body.services.redis).toBe('unavailable');
    });

    it('should return 503, when service-a is unavailable', async () => {
      serviceAClient.send.mockReturnValue(throwError(() => new Error('connection refused')));

      const response = await request(app.getHttpServer() as App).get('/health/ready');

      expect(response.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(response.body.services.serviceA).toBe('unavailable');
    });
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

```bash
pnpm --filter gateway test -- src/health/health.controller.int.spec.ts
```
Expected: FAIL — old controller still only has `/health/service-a`/`/health/service-b`.

- [ ] **Step 6: Rewrite the controller**

Replace the full contents of
`back-end/gateway/src/health/health.controller.ts` with:

```typescript
import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { type AggregatedHealth, HealthCheckService } from './health-check.service';

const HEALTHY_EXAMPLE = {
  status: 'ok',
  services: { gateway: 'ok', rabbitmq: 'ok', serviceA: 'ok', serviceB: 'ok', mongodb: 'ok', redis: 'ok' },
};

const DEGRADED_EXAMPLE = {
  status: 'degraded',
  services: { gateway: 'ok', rabbitmq: 'ok', serviceA: 'ok', serviceB: 'unavailable', mongodb: 'ok', redis: 'ok' },
};

@ApiTags('health')
@Controller('health')
export class HealthController {
  public constructor(private readonly healthCheckService: HealthCheckService) {}

  @Get()
  @ApiOperation({ summary: 'Aggregated health of the gateway and all its dependencies' })
  @ApiOkResponse({
    description: 'Always returned; inspect `status` for overall health.',
    schema: { example: HEALTHY_EXAMPLE },
  })
  public async health(): Promise<AggregatedHealth> {
    return this.healthCheckService.getHealth();
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — is the gateway process running' })
  @ApiOkResponse({ schema: { example: { status: 'ok', service: 'gateway' } } })
  public live(): { status: 'ok'; service: 'gateway' } {
    return this.healthCheckService.getLiveness();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe — can the gateway currently serve requests',
    description:
      'Critical for readiness: rabbitmq, serviceA, serviceB. mongodb/redis are reported but never fail readiness.',
  })
  @ApiOkResponse({ schema: { example: HEALTHY_EXAMPLE } })
  @ApiServiceUnavailableResponse({ schema: { example: DEGRADED_EXAMPLE } })
  public async ready(@Res({ passthrough: true }) response: Response): Promise<AggregatedHealth> {
    const { ready, result } = await this.healthCheckService.getReadiness();

    response.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return result;
  }
}
```

- [ ] **Step 7: Run test to verify it passes**

```bash
pnpm --filter gateway test -- src/health/health.controller.int.spec.ts
```
Expected: PASS (5 tests).

- [ ] **Step 8: Run the full gateway test suite**

```bash
pnpm --filter gateway test
```
Expected: PASS, all suites.

- [ ] **Step 9: Lint and stage**

```bash
pnpm --filter gateway lint
git add back-end/gateway/package.json back-end/gateway/src/app.module.ts back-end/gateway/src/main.ts back-end/gateway/src/health/health.controller.ts back-end/gateway/src/health/health.controller.int.spec.ts
```

---

## Task 10: Docker Compose, Dockerfile, `.env.example`

**Files:**
- Modify: `docker-compose.yml` (repo root)
- Modify: `back-end/gateway/Dockerfile`
- Modify: `back-end/gateway/.env.example`

**Interfaces:** none (infrastructure config only).

- [ ] **Step 1: Add `mongodb` and `redis` services to `docker-compose.yml`**

In `docker-compose.yml`, add two new services (placed after `rabbitmq`, before
`service-b`), and update `gateway`'s `environment`/`depends_on`:

```yaml
  mongodb:
    image: mongo:7
    container_name: task1-mongodb
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping')"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    container_name: task1-redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10
```

Update the `gateway` service's `environment` and `depends_on` blocks to:

```yaml
    environment:
      <<: *rabbitmq_url
      PORT: 3000
      RABBITMQ_SERVICE_B_QUEUE: service_b_queue
      RABBITMQ_SERVICE_A_QUEUE: service_a_queue
      MONGODB_URI: mongodb://mongodb:27017/gateway
      REDIS_URL: redis://redis:6379
    depends_on:
      rabbitmq:
        condition: service_healthy
      mongodb:
        condition: service_healthy
      redis:
        condition: service_healthy
```

- [ ] **Step 2: Validate the compose file**

```bash
docker compose config --quiet
```
Expected: no output, exit code 0. If Docker isn't running locally, at least
confirm the YAML parses: `docker compose config` should not error on syntax
even without a daemon reachable for image checks.

- [ ] **Step 3: Update the gateway `Dockerfile`'s `HEALTHCHECK`**

In `back-end/gateway/Dockerfile`, replace the `HEALTHCHECK` instruction:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "\
    const http = require('http'); \
    http.get('http://127.0.0.1:3000/health/ready', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1));"
```

- [ ] **Step 4: Update `.env.example`**

Append to `back-end/gateway/.env.example`:

```
MONGODB_URI=mongodb://localhost:27017/gateway
MONGODB_PING_TIMEOUT_MS=3000
REDIS_URL=redis://localhost:6379
REDIS_PING_TIMEOUT_MS=3000
```

- [ ] **Step 5: Stage**

```bash
git add docker-compose.yml back-end/gateway/Dockerfile back-end/gateway/.env.example
```

---

## Task 11: README — health-check documentation

**Files:**
- Modify: `back-end/gateway/README.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Insert a "Health Checks" section**

In `back-end/gateway/README.md`, insert the following section immediately
after the `## Description` section (before `## Project setup`):

```markdown
## Health Checks

The gateway exposes three endpoints under `/health`:

- `GET /health` — aggregated status of every dependency in one response. Always `200`; check the `status` field.
- `GET /health/live` — liveness: is the gateway *process* running. Always `200`, no downstream calls.
- `GET /health/ready` — readiness: can the gateway currently *serve requests*. `200` when ready, `503` when a critical dependency is down.

### Why liveness and readiness are different

Liveness answers "is the process alive" — a process manager (or Docker's own `HEALTHCHECK`) uses this to decide whether to restart the container. It never calls out to anything, because a slow dependency should never cause a healthy process to be killed and restarted.

Readiness answers "can this process currently do its job" — it's what should gate traffic. A gateway with a dead RabbitMQ connection is alive but not ready: restarting it would not help, but it also shouldn't receive requests it cannot fulfill.

### Critical vs informational dependencies

`/health/ready` treats **RabbitMQ, Service A, and Service B** as critical — the gateway's only purpose is routing requests to those services through the broker, so if any of them is unreachable, `/health/ready` returns `503`.

**MongoDB and Redis** are reported for visibility but are informational only — nothing in the gateway's request path uses them today (there is no persistence layer or caching configured), so their failure never causes `/health/ready` to fail.

### Why the gateway never accesses Service A/B's databases directly

The gateway has no visibility into, or dependency on, Service A/B's internal storage. Checking their databases directly would violate the module boundary (each service owns its own persistence) and would report "healthy" even if the service's own RabbitMQ consumer had crashed — the opposite of what a caller needs to know. Instead, the gateway sends a dedicated `health.check` RabbitMQ message to each service and waits (with a timeout) for a reply — the same transport and pattern used for every other inter-service call, exercising the actual path a real request would take.

### Example responses

`GET /health` — everything healthy:

\`\`\`json
{
  "status": "ok",
  "services": {
    "gateway": "ok",
    "rabbitmq": "ok",
    "serviceA": "ok",
    "serviceB": "ok",
    "mongodb": "ok",
    "redis": "ok"
  }
}
\`\`\`

`GET /health` — Service B unreachable:

\`\`\`json
{
  "status": "degraded",
  "services": {
    "gateway": "ok",
    "rabbitmq": "ok",
    "serviceA": "ok",
    "serviceB": "unavailable",
    "mongodb": "ok",
    "redis": "ok"
  }
}
\`\`\`

`GET /health/live`:

\`\`\`json
{ "status": "ok", "service": "gateway" }
\`\`\`

`GET /health/ready` — not ready (`503`, Service A down):

\`\`\`json
{
  "status": "degraded",
  "services": {
    "gateway": "ok",
    "rabbitmq": "ok",
    "serviceA": "unavailable",
    "serviceB": "ok",
    "mongodb": "ok",
    "redis": "ok"
  }
}
\`\`\`
```

- [ ] **Step 2: Stage**

```bash
git add back-end/gateway/README.md
```

---

## Final verification (run once, after all tasks)

```bash
pnpm --filter gateway test:cov
pnpm --filter gateway lint
pnpm --filter gateway build
```

Expected: full suite passes at ≥90% lines/branches coverage, lint is clean,
and the TypeScript build succeeds. Do not commit — leave everything staged
for the user.
