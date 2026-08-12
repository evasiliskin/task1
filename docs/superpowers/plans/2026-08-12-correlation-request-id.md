# Correlation ID & Request ID Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every request through `gateway → service-a → service-b` a stable `correlationId` (one per logical flow) and a per-hop `requestId` (one per service-to-service call), available to controllers/services/logs via `AsyncLocalStorage` with no manual threading, plus full pino/nestjs-pino structured logging that automatically includes both IDs.

**Architecture:** Each of the three services gets its own duplicated `src/core/request-context/` module (no shared `libs/` package — matches this repo's existing per-service duplication of `core/errors`, `core/exception-handling`). `gateway` resolves IDs in HTTP middleware; `service-a`/`service-b` resolve them in a global RMQ interceptor. Every outbound `ClientProxy.send` call forwards the correlation ID unchanged and mints a fresh request ID via `RmqRecordBuilder` message headers. `service-a`'s health check is extended to call `service-b`, giving a real 3-hop chain to test against. Logging: `gateway` uses `nestjs-pino` (real HTTP app); `service-a`/`service-b` use a bare `pino()` instance (RMQ-only apps have no HTTP adapter for `nestjs-pino`'s middleware to attach to) behind the identical `LoggerService`/`AppLogger` API.

**Tech Stack:** NestJS 11, TypeScript, `@nestjs/microservices` (RMQ transport), Vitest, `node:crypto` `randomUUID` (no `uuid` package), `pino`/`nestjs-pino`/`pino-pretty` (new dependencies), Zod for config.

**Design doc:** `docs/superpowers/specs/2026-08-12-correlation-request-id-design.md`

## Global Constraints

- Never throw raw `Error` — application exceptions extend `AppError` (via each service's `core/errors/internal/internal-error.ts` `InternalError` base, itself abstract).
- Every class member has explicit `public`/`private`/`protected` accessibility (`@typescript-eslint/explicit-member-accessibility`).
- Interfaces are `PascalCase` prefixed with `I` (`@typescript-eslint/naming-convention`).
- Type-only imports use inline `type` modifiers, combined with value imports from the same module where applicable (`@typescript-eslint/consistent-type-imports`, `fixStyle: inline-type-imports`).
- Imports are grouped (`builtin`, `external`, `internal`, `parent`, `sibling`, `index`) and alphabetized ascending, case-insensitive, with a blank line between groups (`import-x/order`).
- `@typescript-eslint/strict-boolean-expressions` is on with default (strict) options — no implicit truthiness checks on nullable strings/numbers; use explicit `typeof`/`=== undefined`/`.length` checks.
- Blank line required before every `return`/`throw` that follows a `const`/`let`/`var` or an expression statement, and before every `if` (`padding-line-between-statements`).
- Member ordering: public fields → public constructor → public methods → ... → private fields/methods last (`@typescript-eslint/member-ordering`).
- No business DTOs/payloads may carry tracing metadata — IDs travel only via RMQ message headers (`RmqRecordBuilder.setOptions({ headers })`) or HTTP headers, never the payload.
- Do **not** create a `libs/*` workspace package — duplicate `core/request-context/` and `core/logger/` per service, matching the existing `core/errors`/`core/exception-handling` convention.
- No `git commit` in any step — per this project's CLAUDE.md, the user commits manually. Every "commit" checkpoint below is written as "stage the files" instead.
- Vitest: `globals: true` (no `describe`/`it`/`vi`/`expect` imports needed), colocated `*.spec.ts`, `.int.spec.ts` for HTTP-integration tests via `supertest` (gateway only), BDD phrasing `it('should X, when Y')`.
- Coverage thresholds (`vitest.config.mts`, all three services): 90% lines, 90% branches — every new file needs tests covering its branches.

---

## Task 1: Gateway — request-context core (types, validation, propagation, service)

**Files:**
- Create: `back-end/gateway/src/core/request-context/request-context.types.ts`
- Create: `back-end/gateway/src/core/request-context/missing-request-context.error.ts`
- Create: `back-end/gateway/src/core/request-context/id-validation.util.ts`
- Create: `back-end/gateway/src/core/request-context/propagation.util.ts`
- Create: `back-end/gateway/src/core/request-context/request-context.service.ts`
- Test: `back-end/gateway/src/core/request-context/id-validation.util.spec.ts`
- Test: `back-end/gateway/src/core/request-context/propagation.util.spec.ts`
- Test: `back-end/gateway/src/core/request-context/request-context.service.spec.ts`

**Interfaces:**
- Produces: `IRequestContext { correlationId: string; requestId: string }`, `CORRELATION_ID_HEADER = 'x-correlation-id'`, `REQUEST_ID_HEADER = 'x-request-id'`, `MAX_ID_LENGTH = 200`, `resolveId(raw: string | string[] | undefined): string`, `buildOutboundHeaders(context: IRequestContext): Record<string, string>`, `RequestContextService` with `run<T>(context, callback: () => T): T`, `getCorrelationId(): string | undefined`, `getRequestId(): string | undefined`, `getAttributes(): Partial<IRequestContext>`, `requireContext(): IRequestContext` (throws `MissingRequestContextError` if called outside an active context).

- [ ] **Step 1: Create the types/constants file**

`back-end/gateway/src/core/request-context/request-context.types.ts`:
```ts
export interface IRequestContext {
  correlationId: string;
  requestId: string;
}

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const REQUEST_ID_HEADER = 'x-request-id';
export const MAX_ID_LENGTH = 200;
```

- [ ] **Step 2: Create the missing-context error**

`back-end/gateway/src/core/request-context/missing-request-context.error.ts`:
```ts
import { ErrorCategory } from '../errors/error-category.enum';
import { InternalError } from '../errors/internal/internal-error';

export class MissingRequestContextError extends InternalError {
  public constructor() {
    super(
      'RequestContextService was accessed outside of an active request context',
      MissingRequestContextError.buildOptions({
        code: 'MISSING_REQUEST_CONTEXT',
        category: ErrorCategory.INTERNAL,
      }),
    );
  }
}
```

- [ ] **Step 3: Write the failing tests for `resolveId`**

`back-end/gateway/src/core/request-context/id-validation.util.spec.ts`:
```ts
import { resolveId } from './id-validation.util';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('resolveId', () => {
  it('should return the trimmed value, when given a valid header value with surrounding whitespace', () => {
    const result = resolveId('  11111111-1111-4111-8111-111111111111  ');

    expect(result).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('should return a generated UUID v4, when the header is undefined', () => {
    const result = resolveId(undefined);

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should return a generated UUID v4, when the header is an empty string', () => {
    const result = resolveId('');

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should return a generated UUID v4, when the header is only whitespace', () => {
    const result = resolveId('   ');

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should return a generated UUID v4, when the header exceeds the max length', () => {
    const result = resolveId('a'.repeat(201));

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should accept a value at exactly the max length', () => {
    const value = 'a'.repeat(200);

    const result = resolveId(value);

    expect(result).toBe(value);
  });

  it('should return a generated UUID v4, when the header contains a control character', () => {
    const result = resolveId('bad\r\nvalue');

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should return a generated UUID v4, when the header contains a space', () => {
    const result = resolveId('has space');

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should use the first value, when the header arrives as an array (repeated header)', () => {
    const result = resolveId(['11111111-1111-4111-8111-111111111111', 'other-value']);

    expect(result).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('should return a generated UUID v4, when the header array is empty', () => {
    const result = resolveId([]);

    expect(result).toMatch(UUID_V4_PATTERN);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter gateway test -- id-validation.util.spec.ts`
Expected: FAIL with a module-not-found error for `./id-validation.util`.

- [ ] **Step 5: Implement `resolveId`**

`back-end/gateway/src/core/request-context/id-validation.util.ts`:
```ts
import { randomUUID } from 'node:crypto';

import { MAX_ID_LENGTH } from './request-context.types';

// Printable ASCII, no whitespace/control chars - blocks header/log injection
// via a spoofed id while still allowing non-UUID correlation ids from clients.
const SAFE_ID_PATTERN = /^[\x21-\x7E]+$/;

export function resolveId(raw: string | string[] | undefined): string {
  const candidate = Array.isArray(raw) ? raw[0] : raw;

  if (typeof candidate !== 'string') {
    return randomUUID();
  }

  const trimmed = candidate.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_ID_LENGTH || !SAFE_ID_PATTERN.test(trimmed)) {
    return randomUUID();
  }

  return trimmed;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter gateway test -- id-validation.util.spec.ts`
Expected: PASS (10 tests).

- [ ] **Step 7: Write the failing tests for `buildOutboundHeaders`**

`back-end/gateway/src/core/request-context/propagation.util.spec.ts`:
```ts
import { buildOutboundHeaders } from './propagation.util';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from './request-context.types';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('buildOutboundHeaders', () => {
  it('should forward the correlation id unchanged', () => {
    const headers = buildOutboundHeaders({ correlationId: 'c-123', requestId: 'r-456' });

    expect(headers[CORRELATION_ID_HEADER]).toBe('c-123');
  });

  it('should mint a fresh request id, distinct from the inbound request id', () => {
    const headers = buildOutboundHeaders({ correlationId: 'c-123', requestId: 'r-456' });

    expect(headers[REQUEST_ID_HEADER]).not.toBe('r-456');
    expect(headers[REQUEST_ID_HEADER]).toMatch(UUID_V4_PATTERN);
  });

  it('should mint a different request id on every call, given the same context', () => {
    const context = { correlationId: 'c-123', requestId: 'r-456' };

    const first = buildOutboundHeaders(context);
    const second = buildOutboundHeaders(context);

    expect(first[REQUEST_ID_HEADER]).not.toBe(second[REQUEST_ID_HEADER]);
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `pnpm --filter gateway test -- propagation.util.spec.ts`
Expected: FAIL with a module-not-found error for `./propagation.util`.

- [ ] **Step 9: Implement `buildOutboundHeaders`**

`back-end/gateway/src/core/request-context/propagation.util.ts`:
```ts
import { randomUUID } from 'node:crypto';

import { CORRELATION_ID_HEADER, type IRequestContext, REQUEST_ID_HEADER } from './request-context.types';

export function buildOutboundHeaders(context: IRequestContext): Record<string, string> {
  return {
    [CORRELATION_ID_HEADER]: context.correlationId,
    [REQUEST_ID_HEADER]: randomUUID(),
  };
}
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `pnpm --filter gateway test -- propagation.util.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 11: Write the failing tests for `RequestContextService`**

`back-end/gateway/src/core/request-context/request-context.service.spec.ts`:
```ts
import { MissingRequestContextError } from './missing-request-context.error';
import { RequestContextService } from './request-context.service';

describe('RequestContextService', () => {
  let service: RequestContextService;

  beforeEach(() => {
    service = new RequestContextService();
  });

  describe('run', () => {
    it('should make the context available inside the callback via getCorrelationId/getRequestId', () => {
      const result = service.run({ correlationId: 'c-1', requestId: 'r-1' }, () => ({
        correlationId: service.getCorrelationId(),
        requestId: service.getRequestId(),
      }));

      expect(result).toEqual({ correlationId: 'c-1', requestId: 'r-1' });
    });

    it('should isolate concurrent contexts from each other', async () => {
      const readBackAfterDelay = async (context: { correlationId: string; requestId: string }, delayMs: number) =>
        service.run(context, async () => {
          await new Promise((resolve) => setTimeout(resolve, delayMs));

          return service.getAttributes();
        });

      const [first, second] = await Promise.all([
        readBackAfterDelay({ correlationId: 'c-1', requestId: 'r-1' }, 10),
        readBackAfterDelay({ correlationId: 'c-2', requestId: 'r-2' }, 0),
      ]);

      expect(first).toEqual({ correlationId: 'c-1', requestId: 'r-1' });
      expect(second).toEqual({ correlationId: 'c-2', requestId: 'r-2' });
    });
  });

  describe('getCorrelationId', () => {
    it('should return undefined, when called outside of any context', () => {
      expect(service.getCorrelationId()).toBeUndefined();
    });
  });

  describe('getRequestId', () => {
    it('should return undefined, when called outside of any context', () => {
      expect(service.getRequestId()).toBeUndefined();
    });
  });

  describe('getAttributes', () => {
    it('should return an empty object, when called outside of any context', () => {
      expect(service.getAttributes()).toEqual({});
    });

    it('should return a copy of the active context, when called inside one', () => {
      const result = service.run({ correlationId: 'c-1', requestId: 'r-1' }, () => service.getAttributes());

      expect(result).toEqual({ correlationId: 'c-1', requestId: 'r-1' });
    });
  });

  describe('requireContext', () => {
    it('should return the active context, when called inside one', () => {
      const result = service.run({ correlationId: 'c-1', requestId: 'r-1' }, () => service.requireContext());

      expect(result).toEqual({ correlationId: 'c-1', requestId: 'r-1' });
    });

    it('should throw MissingRequestContextError, when called outside of any context', () => {
      expect(() => service.requireContext()).toThrow(MissingRequestContextError);
    });
  });
});
```

- [ ] **Step 12: Run the test to verify it fails**

Run: `pnpm --filter gateway test -- request-context.service.spec.ts`
Expected: FAIL with a module-not-found error for `./request-context.service`.

- [ ] **Step 13: Implement `RequestContextService`**

`back-end/gateway/src/core/request-context/request-context.service.ts`:
```ts
import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';

import { MissingRequestContextError } from './missing-request-context.error';
import { type IRequestContext } from './request-context.types';

@Injectable()
export class RequestContextService {
  public run<T>(context: IRequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  public getCorrelationId(): string | undefined {
    return this.storage.getStore()?.correlationId;
  }

  public getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }

  public getAttributes(): Partial<IRequestContext> {
    const store = this.storage.getStore();

    return store === undefined ? {} : { ...store };
  }

  public requireContext(): IRequestContext {
    const store = this.storage.getStore();

    if (store === undefined) {
      throw new MissingRequestContextError();
    }

    return store;
  }

  private readonly storage = new AsyncLocalStorage<IRequestContext>();
}
```

- [ ] **Step 14: Run the test to verify it passes**

Run: `pnpm --filter gateway test -- request-context.service.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 15: Run the full gateway test suite and lint**

Run: `pnpm --filter gateway test && pnpm --filter gateway lint`
Expected: all tests pass, lint exits 0.

- [ ] **Step 16: Stage the files (do not commit — user commits manually)**

```bash
git add back-end/gateway/src/core/request-context/
```

---

## Task 2: Gateway — HTTP middleware wiring

**Files:**
- Create: `back-end/gateway/src/core/request-context/request-context.middleware.ts`
- Create: `back-end/gateway/src/core/request-context/request-context.module.ts`
- Modify: `back-end/gateway/src/app.module.ts`
- Test: `back-end/gateway/src/core/request-context/request-context.middleware.spec.ts`

**Interfaces:**
- Consumes: `resolveId` and `RequestContextService` from Task 1.
- Produces: `RequestContextMiddleware` (applied globally via `RequestContextModule`), which every later task (error handling, RMQ call sites) relies on having already seeded the context and set response headers for every HTTP request.

- [ ] **Step 1: Write the failing middleware tests**

`back-end/gateway/src/core/request-context/request-context.middleware.spec.ts`:
```ts
import type { NextFunction, Request, Response } from 'express';

import { RequestContextMiddleware } from './request-context.middleware';
import { RequestContextService } from './request-context.service';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('RequestContextMiddleware', () => {
  let middleware: RequestContextMiddleware;
  let requestContextService: RequestContextService;
  let response: { setHeader: ReturnType<typeof vi.fn> };
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    requestContextService = new RequestContextService();
    middleware = new RequestContextMiddleware(requestContextService);
    response = { setHeader: vi.fn() };
    next = vi.fn();
  });

  it('should generate a valid UUID v4 correlation id, when x-correlation-id is absent', () => {
    const request = { headers: {} } as unknown as Request;

    middleware.use(request, response as unknown as Response, next as unknown as NextFunction);

    expect(response.setHeader).toHaveBeenCalledWith('x-correlation-id', expect.stringMatching(UUID_V4_PATTERN));
  });

  it('should generate a valid UUID v4 request id, when x-request-id is absent', () => {
    const request = { headers: {} } as unknown as Request;

    middleware.use(request, response as unknown as Response, next as unknown as NextFunction);

    expect(response.setHeader).toHaveBeenCalledWith('x-request-id', expect.stringMatching(UUID_V4_PATTERN));
  });

  it('should reuse the incoming x-correlation-id header, when present', () => {
    const request = {
      headers: { 'x-correlation-id': '11111111-1111-4111-8111-111111111111' },
    } as unknown as Request;

    middleware.use(request, response as unknown as Response, next as unknown as NextFunction);

    expect(response.setHeader).toHaveBeenCalledWith('x-correlation-id', '11111111-1111-4111-8111-111111111111');
  });

  it('should reuse the incoming x-request-id header, when present', () => {
    const request = {
      headers: { 'x-request-id': '22222222-2222-4222-8222-222222222222' },
    } as unknown as Request;

    middleware.use(request, response as unknown as Response, next as unknown as NextFunction);

    expect(response.setHeader).toHaveBeenCalledWith('x-request-id', '22222222-2222-4222-8222-222222222222');
  });

  it('should set both response headers unconditionally', () => {
    const request = { headers: {} } as unknown as Request;

    middleware.use(request, response as unknown as Response, next as unknown as NextFunction);

    expect(response.setHeader).toHaveBeenCalledTimes(2);
  });

  it('should call next() inside the request context, making both ids readable via the service', () => {
    const request = {
      headers: {
        'x-correlation-id': '11111111-1111-4111-8111-111111111111',
        'x-request-id': '22222222-2222-4222-8222-222222222222',
      },
    } as unknown as Request;
    next = vi.fn(() => {
      expect(requestContextService.getCorrelationId()).toBe('11111111-1111-4111-8111-111111111111');
      expect(requestContextService.getRequestId()).toBe('22222222-2222-4222-8222-222222222222');
    });

    middleware.use(request, response as unknown as Response, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter gateway test -- request-context.middleware.spec.ts`
Expected: FAIL with a module-not-found error for `./request-context.middleware`.

- [ ] **Step 3: Implement `RequestContextMiddleware`**

`back-end/gateway/src/core/request-context/request-context.middleware.ts`:
```ts
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { resolveId } from './id-validation.util';
import { RequestContextService } from './request-context.service';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from './request-context.types';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  public constructor(private readonly requestContextService: RequestContextService) {}

  public use(request: Request, response: Response, next: NextFunction): void {
    const correlationId = resolveId(request.headers[CORRELATION_ID_HEADER]);
    const requestId = resolveId(request.headers[REQUEST_ID_HEADER]);

    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    response.setHeader(REQUEST_ID_HEADER, requestId);

    this.requestContextService.run({ correlationId, requestId }, next);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter gateway test -- request-context.middleware.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Create the module**

`back-end/gateway/src/core/request-context/request-context.module.ts`:
```ts
import { Global, type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';

import { RequestContextMiddleware } from './request-context.middleware';
import { RequestContextService } from './request-context.service';

@Global()
@Module({
  providers: [RequestContextService],
  exports: [RequestContextService],
})
export class RequestContextModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
```

- [ ] **Step 6: Wire the module into `AppModule`**

Modify `back-end/gateway/src/app.module.ts` (current content shown for context — replace it):
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import appConfig from './config/app.config';
import rabbitmqConfig from './config/rabbitmq.config';
import { ExceptionHandlingModule } from './core/exception-handling/exception-handling.module';
import { RequestContextModule } from './core/request-context/request-context.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [appConfig, rabbitmqConfig],
    }),
    RequestContextModule,
    ExceptionHandlingModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 7: Run the full gateway test suite and lint**

Run: `pnpm --filter gateway test && pnpm --filter gateway lint`
Expected: all tests pass, lint exits 0.

- [ ] **Step 8: Manually verify the header behavior end-to-end**

Run: `pnpm --filter gateway start:dev`, then in another terminal:
```bash
curl -i http://localhost:3000/health/service-a
```
Expected: response includes `x-correlation-id` and `x-request-id` headers with UUID v4 values (service-a/service-b don't need to be running for this smoke check — the request/response headers are set by the middleware before the RMQ call is even attempted; the health check itself may report 503 if RabbitMQ isn't up, which is fine for this check).

- [ ] **Step 9: Stage the files**

```bash
git add back-end/gateway/src/core/request-context/ back-end/gateway/src/app.module.ts
```

---

## Task 3: Gateway — propagate IDs on outbound RMQ calls

**Files:**
- Modify: `back-end/gateway/src/health/rabbitmq-ping.health-indicator.ts`
- Modify: `back-end/gateway/src/health/rabbitmq-ping.health-indicator.spec.ts`
- Modify: `back-end/gateway/src/health/health.module.ts`
- Modify: `back-end/gateway/src/health/health.controller.int.spec.ts`

**Interfaces:**
- Consumes: `RequestContextService.requireContext()`, `buildOutboundHeaders` from Task 1/2.
- Produces: every `client.send('health.check', ...)` call now carries `x-correlation-id`/`x-request-id` message headers, verified by Task 9's service-a-side assertions.

- [ ] **Step 1: Update the failing/changed tests first**

Replace `back-end/gateway/src/health/rabbitmq-ping.health-indicator.spec.ts` in full:
```ts
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { type HealthIndicatorService } from '@nestjs/terminus';
import { of, throwError } from 'rxjs';

import type rabbitmqConfig from '../config/rabbitmq.config';
import { RequestContextService } from '../core/request-context/request-context.service';

import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator';

describe('RabbitMqPingHealthIndicator', () => {
  let indicator: RabbitMqPingHealthIndicator;
  let requestContextService: RequestContextService;
  let upMock: ReturnType<typeof vi.fn>;
  let downMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    upMock = vi.fn();
    downMock = vi.fn();

    const healthIndicatorService = {
      check: vi.fn().mockReturnValue({ up: upMock, down: downMock }),
    } as unknown as HealthIndicatorService;

    requestContextService = new RequestContextService();

    indicator = new RabbitMqPingHealthIndicator(healthIndicatorService, requestContextService, {
      pingTimeoutMs: 3000,
    } as ConfigType<typeof rabbitmqConfig>);
  });

  const runWithinContext = <T>(callback: () => T): T =>
    requestContextService.run({ correlationId: 'c-123', requestId: 'r-inbound' }, callback);

  it('should report the indicator as up, when the target service replies to health.check', async () => {
    const expectedResult = { 'service-b': { status: 'up' } };
    upMock.mockReturnValue(expectedResult);

    const client = { send: vi.fn().mockReturnValue(of({ status: 'ok' })) } as unknown as ClientProxy;

    const result = await runWithinContext(() => indicator.isHealthy('service-b', client));

    expect(result).toEqual(expectedResult);
  });

  it('should report the indicator as down, when the target service errors', async () => {
    const expectedResult = {
      'service-b': { status: 'down', message: 'connection refused' },
    };
    downMock.mockReturnValue(expectedResult);

    const client = {
      send: vi.fn().mockReturnValue(throwError(() => new Error('connection refused'))),
    } as unknown as ClientProxy;

    const result = await runWithinContext(() => indicator.isHealthy('service-b', client));

    expect(result).toEqual(expectedResult);
  });

  it('should report the indicator as down with unknown error, when the target service throws a non-Error value', async () => {
    const expectedResult = {
      'service-a': { status: 'down', message: 'unknown error' },
    };
    downMock.mockReturnValue(expectedResult);

    const client = {
      send: vi.fn().mockReturnValue(throwError(() => 'timeout')),
    } as unknown as ClientProxy;

    const result = await runWithinContext(() => indicator.isHealthy('service-a', client));

    expect(result).toEqual(expectedResult);
  });

  it('should send a message record whose headers forward the active correlation id and a fresh request id', async () => {
    upMock.mockReturnValue({ 'service-b': { status: 'up' } });

    const send = vi.fn().mockReturnValue(of({ status: 'ok' }));
    const client = { send } as unknown as ClientProxy;

    await runWithinContext(() => indicator.isHealthy('service-b', client));

    expect(send).toHaveBeenCalledTimes(1);
    const [pattern, record] = send.mock.calls[0] as [string, { options: { headers: Record<string, string> } }];

    expect(pattern).toBe('health.check');
    expect(record.options.headers['x-correlation-id']).toBe('c-123');
    expect(record.options.headers['x-request-id']).not.toBe('r-inbound');
    expect(typeof record.options.headers['x-request-id']).toBe('string');
  });

  it('should throw MissingRequestContextError, when called outside of any request context', async () => {
    const client = { send: vi.fn().mockReturnValue(of({ status: 'ok' })) } as unknown as ClientProxy;

    await expect(indicator.isHealthy('service-b', client)).rejects.toThrow(
      'RequestContextService was accessed outside of an active request context',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter gateway test -- rabbitmq-ping.health-indicator.spec.ts`
Expected: FAIL — constructor now requires 3 arguments, `isHealthy` doesn't yet build a record or attach headers.

- [ ] **Step 3: Update the health indicator implementation**

Replace `back-end/gateway/src/health/rabbitmq-ping.health-indicator.ts` in full:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { firstValueFrom, timeout } from 'rxjs';

import rabbitmqConfig from '../config/rabbitmq.config';
import { buildOutboundHeaders } from '../core/request-context/propagation.util';
import { RequestContextService } from '../core/request-context/request-context.service';

@Injectable()
export class RabbitMqPingHealthIndicator {
  public constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly requestContextService: RequestContextService,
    @Inject(rabbitmqConfig.KEY) private readonly config: ConfigType<typeof rabbitmqConfig>,
  ) {}

  public async isHealthy(key: string, client: ClientProxy): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const headers = buildOutboundHeaders(this.requestContextService.requireContext());
    const record = new RmqRecordBuilder({}).setOptions({ headers }).build();

    try {
      await firstValueFrom(client.send('health.check', record).pipe(timeout(this.config.pingTimeoutMs)));

      return indicator.up();
    } catch (error) {
      return indicator.down({ message: error instanceof Error ? error.message : 'unknown error' });
    }
  }
}
```

The constructor argument order changed (new `requestContextService` inserted before the injected
config), so every call site that constructs this class directly (i.e. the spec file from Step 1)
must pass arguments in this new order — already done above.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter gateway test -- rabbitmq-ping.health-indicator.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: No changes needed to `health.module.ts` or `health.controller.ts`**

`RequestContextService` is provided globally by `RequestContextModule` (`@Global()`, Task 2), so
`HealthModule` picks it up automatically via Nest's DI without adding it to `HealthModule`'s own
`providers` array. Confirm `back-end/gateway/src/health/health.module.ts` is unchanged.

- [ ] **Step 6: Update `health.controller.int.spec.ts` to assert response headers**

Modify `back-end/gateway/src/health/health.controller.int.spec.ts` — add one `it` per existing
`describe` block (after the existing two `it`s in each), and update the `TestingModule` setup to
include `RequestContextModule` so the middleware actually runs:

```ts
import { type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { Test, type TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import request from 'supertest';
import type { App } from 'supertest/types';

import rabbitmqConfig from '../config/rabbitmq.config';
import { RequestContextModule } from '../core/request-context/request-context.module';

import { HealthModule } from './health.module';
import { SERVICE_A_RMQ_CLIENT, SERVICE_B_RMQ_CLIENT } from './rabbitmq-clients.tokens';

describe('HealthController (HTTP Integration)', () => {
  let app: INestApplication;
  let serviceBClient: { send: ReturnType<typeof vi.fn> };
  let serviceAClient: { send: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    serviceBClient = { send: vi.fn() };
    serviceAClient = { send: vi.fn() };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [rabbitmqConfig] }),
        RequestContextModule,
        HealthModule,
      ],
    })
      .overrideProvider(SERVICE_B_RMQ_CLIENT)
      .useValue(serviceBClient as unknown as ClientProxy)
      .overrideProvider(SERVICE_A_RMQ_CLIENT)
      .useValue(serviceAClient)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /health/service-b', () => {
    it('should return 200 and health check result, when service-b replies', async () => {
      serviceBClient.send.mockReturnValue(of({ status: 'ok' }));

      const response = await request(app.getHttpServer() as App).get('/health/service-b');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        info: { 'service-b': { status: 'up' } },
        error: {},
        details: { 'service-b': { status: 'up' } },
      });
    });

    it('should return 503 and health check result, when service-b does not reply', async () => {
      serviceBClient.send.mockReturnValue(throwError(() => new Error('connection refused')));

      const response = await request(app.getHttpServer() as App).get('/health/service-b');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: 'error',
        info: {},
        error: { 'service-b': { message: 'connection refused', status: 'down' } },
        details: { 'service-b': { message: 'connection refused', status: 'down' } },
      });
    });

    it('should echo the incoming x-correlation-id and generate an x-request-id, when service-b replies', async () => {
      serviceBClient.send.mockReturnValue(of({ status: 'ok' }));

      const response = await request(app.getHttpServer() as App)
        .get('/health/service-b')
        .set('x-correlation-id', '11111111-1111-4111-8111-111111111111');

      expect(response.headers['x-correlation-id']).toBe('11111111-1111-4111-8111-111111111111');
      expect(response.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe('GET /health/service-a', () => {
    it('should return 200 and health check result, when service-a replies', async () => {
      serviceAClient.send.mockReturnValue(of({ status: 'ok' }));

      const response = await request(app.getHttpServer() as App).get('/health/service-a');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        info: { 'service-a': { status: 'up' } },
        error: {},
        details: { 'service-a': { status: 'up' } },
      });
    });

    it('should return 503 and health check result, when service-a does not reply', async () => {
      serviceAClient.send.mockReturnValue(throwError(() => new Error('connection refused')));

      const response = await request(app.getHttpServer() as App).get('/health/service-a');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: 'error',
        info: {},
        error: { 'service-a': { message: 'connection refused', status: 'down' } },
        details: { 'service-a': { message: 'connection refused', status: 'down' } },
      });
    });

    it('should generate both response headers, when no tracing headers are sent by the client', async () => {
      serviceAClient.send.mockReturnValue(of({ status: 'ok' }));

      const response = await request(app.getHttpServer() as App).get('/health/service-a');

      expect(response.headers['x-correlation-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(response.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });
});
```

- [ ] **Step 7: Run the full gateway test suite and lint**

Run: `pnpm --filter gateway test && pnpm --filter gateway lint`
Expected: all tests pass, lint exits 0.

- [ ] **Step 8: Stage the files**

```bash
git add back-end/gateway/src/health/
```

---

## Task 4: Gateway — error handling sources IDs from context

**Files:**
- Modify: `back-end/gateway/src/core/exception-handling/global-exception.filter.ts`
- Modify: `back-end/gateway/src/core/exception-handling/error-response.types.ts`
- Create: `back-end/gateway/src/core/exception-handling/global-exception.filter.spec.ts`

**Interfaces:**
- Consumes: `RequestContextService.requireContext()` from Task 1/2.
- Produces: `IApiErrorResponse` now includes `requestId: string`; error responses set both `X-Correlation-ID` and `X-Request-ID` headers sourced from context (not re-derived from the raw request header).

- [ ] **Step 1: Update `IApiErrorResponse`**

Modify `back-end/gateway/src/core/exception-handling/error-response.types.ts` in full:
```ts
import { type IErrorDetail } from '../errors/base/error-detail.types';

export type IApiErrorDetail = IErrorDetail;

export interface IApiErrorBody {
  code: string;
  category?: string;
  message: string;
  details?: readonly IApiErrorDetail[];
}

export interface IApiErrorResponse {
  statusCode: number;
  error: IApiErrorBody;
  correlationId: string;
  requestId: string;
  timestamp: string;
  path: string;
}
```

- [ ] **Step 2: Write the failing filter test**

Create `back-end/gateway/src/core/exception-handling/global-exception.filter.spec.ts`:
```ts
import { HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { Request, Response } from 'express';

import { RequestContextService } from '../request-context/request-context.service';

import { ErrorFormatService } from './error-format.service';
import { GlobalExceptionFilter } from './global-exception.filter';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let requestContextService: RequestContextService;
  let errorFormatService: { format: ReturnType<typeof vi.fn> };
  let response: { setHeader: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  let request: Request;
  let host: ArgumentsHost;

  beforeEach(() => {
    requestContextService = new RequestContextService();
    errorFormatService = {
      format: vi.fn().mockReturnValue({
        statusCode: HttpStatus.BAD_REQUEST,
        error: { code: 'BAD_REQUEST', message: 'invalid' },
      }),
    };
    filter = new GlobalExceptionFilter(errorFormatService as unknown as ErrorFormatService, requestContextService);

    response = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    request = { method: 'GET', url: '/v1/example' } as Request;
    host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;
  });

  it('should set the x-correlation-id and x-request-id response headers from the active context', () => {
    requestContextService.run({ correlationId: 'c-1', requestId: 'r-1' }, () => {
      filter.catch(new Error('boom'), host);
    });

    expect(response.setHeader).toHaveBeenCalledWith('x-correlation-id', 'c-1');
    expect(response.setHeader).toHaveBeenCalledWith('x-request-id', 'r-1');
  });

  it('should include correlationId and requestId in the JSON error body', () => {
    requestContextService.run({ correlationId: 'c-1', requestId: 'r-1' }, () => {
      filter.catch(new Error('boom'), host);
    });

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'c-1', requestId: 'r-1' }),
    );
  });

  it('should throw MissingRequestContextError, when called outside of any request context', () => {
    expect(() => filter.catch(new Error('boom'), host)).toThrow(
      'RequestContextService was accessed outside of an active request context',
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter gateway test -- global-exception.filter.spec.ts`
Expected: FAIL — constructor currently takes only one argument.

- [ ] **Step 4: Update `GlobalExceptionFilter`**

Replace `back-end/gateway/src/core/exception-handling/global-exception.filter.ts` in full:
```ts
import { ArgumentsHost, Catch, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import { RequestContextService } from '../request-context/request-context.service';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from '../request-context/request-context.types';

import { ErrorFormatService } from './error-format.service';
import { IApiErrorResponse } from './error-response.types';

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  public constructor(
    private readonly errorFormatService: ErrorFormatService,
    private readonly requestContextService: RequestContextService,
  ) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();

    const { correlationId, requestId } = this.requestContextService.requireContext();
    const { statusCode, error } = this.errorFormatService.format(exception);

    if (statusCode >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error(
        `[${correlationId}] Unhandled error on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const body: IApiErrorResponse = {
      statusCode,
      error,
      correlationId,
      requestId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    response.setHeader(REQUEST_ID_HEADER, requestId);
    response.status(statusCode).json(body);
  }

  private readonly logger = new Logger(GlobalExceptionFilter.name);
}
```

Note: `ExceptionFilter` must stay imported as a type-only import alongside the value imports on
the first line — write it as:
```ts
import { ArgumentsHost, Catch, type ExceptionFilter, HttpStatus, Injectable, Logger } from '@nestjs/common';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter gateway test -- global-exception.filter.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full gateway test suite and lint**

Run: `pnpm --filter gateway test && pnpm --filter gateway lint`
Expected: all tests pass (including the Task 3 integration tests, which already exercise this
filter indirectly through the 503 cases), lint exits 0.

- [ ] **Step 7: Stage the files**

```bash
git add back-end/gateway/src/core/exception-handling/
```

---

## Task 5: service-a — request-context core (types, validation, propagation, service)

**Files:**
- Create: `back-end/service-a/src/core/request-context/request-context.types.ts`
- Create: `back-end/service-a/src/core/request-context/missing-request-context.error.ts`
- Create: `back-end/service-a/src/core/request-context/id-validation.util.ts`
- Create: `back-end/service-a/src/core/request-context/propagation.util.ts`
- Create: `back-end/service-a/src/core/request-context/request-context.service.ts`
- Test: `back-end/service-a/src/core/request-context/id-validation.util.spec.ts`
- Test: `back-end/service-a/src/core/request-context/propagation.util.spec.ts`
- Test: `back-end/service-a/src/core/request-context/request-context.service.spec.ts`

**Interfaces:**
- Produces: identical shape to Task 1's gateway module — `IRequestContext`, `CORRELATION_ID_HEADER`,
  `REQUEST_ID_HEADER`, `MAX_ID_LENGTH`, `resolveId`, `buildOutboundHeaders`, `RequestContextService`
  (`run`, `getCorrelationId`, `getRequestId`, `getAttributes`, `requireContext`).

This is a byte-for-byte duplicate of Task 1's five source files and three spec files (this repo's
established convention — see `core/errors`, `core/exception-handling`, both already duplicated
identically across all three services). service-a's `core/errors/error-category.enum.ts` and
`core/errors/internal/internal-error.ts` already exist with the same shape as gateway's (verified),
so the relative imports below resolve exactly as they do in Task 1.

- [ ] **Step 1: Create the types/constants file**

`back-end/service-a/src/core/request-context/request-context.types.ts`:
```ts
export interface IRequestContext {
  correlationId: string;
  requestId: string;
}

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const REQUEST_ID_HEADER = 'x-request-id';
export const MAX_ID_LENGTH = 200;
```

- [ ] **Step 2: Create the missing-context error**

`back-end/service-a/src/core/request-context/missing-request-context.error.ts`:
```ts
import { ErrorCategory } from '../errors/error-category.enum';
import { InternalError } from '../errors/internal/internal-error';

export class MissingRequestContextError extends InternalError {
  public constructor() {
    super(
      'RequestContextService was accessed outside of an active request context',
      MissingRequestContextError.buildOptions({
        code: 'MISSING_REQUEST_CONTEXT',
        category: ErrorCategory.INTERNAL,
      }),
    );
  }
}
```

- [ ] **Step 3: Write the failing tests for `resolveId`**

`back-end/service-a/src/core/request-context/id-validation.util.spec.ts`:
```ts
import { resolveId } from './id-validation.util';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('resolveId', () => {
  it('should return the trimmed value, when given a valid header value with surrounding whitespace', () => {
    const result = resolveId('  11111111-1111-4111-8111-111111111111  ');

    expect(result).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('should return a generated UUID v4, when the header is undefined', () => {
    const result = resolveId(undefined);

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should return a generated UUID v4, when the header is an empty string', () => {
    const result = resolveId('');

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should return a generated UUID v4, when the header is only whitespace', () => {
    const result = resolveId('   ');

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should return a generated UUID v4, when the header exceeds the max length', () => {
    const result = resolveId('a'.repeat(201));

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should accept a value at exactly the max length', () => {
    const value = 'a'.repeat(200);

    const result = resolveId(value);

    expect(result).toBe(value);
  });

  it('should return a generated UUID v4, when the header contains a control character', () => {
    const result = resolveId('bad\r\nvalue');

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should return a generated UUID v4, when the header contains a space', () => {
    const result = resolveId('has space');

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should use the first value, when the header arrives as an array (repeated header)', () => {
    const result = resolveId(['11111111-1111-4111-8111-111111111111', 'other-value']);

    expect(result).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('should return a generated UUID v4, when the header array is empty', () => {
    const result = resolveId([]);

    expect(result).toMatch(UUID_V4_PATTERN);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- id-validation.util.spec.ts`
Expected: FAIL with a module-not-found error for `./id-validation.util`.

- [ ] **Step 5: Implement `resolveId`**

`back-end/service-a/src/core/request-context/id-validation.util.ts`:
```ts
import { randomUUID } from 'node:crypto';

import { MAX_ID_LENGTH } from './request-context.types';

// Printable ASCII, no whitespace/control chars - blocks header/log injection
// via a spoofed id while still allowing non-UUID correlation ids from clients.
const SAFE_ID_PATTERN = /^[\x21-\x7E]+$/;

export function resolveId(raw: string | string[] | undefined): string {
  const candidate = Array.isArray(raw) ? raw[0] : raw;

  if (typeof candidate !== 'string') {
    return randomUUID();
  }

  const trimmed = candidate.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_ID_LENGTH || !SAFE_ID_PATTERN.test(trimmed)) {
    return randomUUID();
  }

  return trimmed;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- id-validation.util.spec.ts`
Expected: PASS (10 tests).

- [ ] **Step 7: Write the failing tests for `buildOutboundHeaders`**

`back-end/service-a/src/core/request-context/propagation.util.spec.ts`:
```ts
import { buildOutboundHeaders } from './propagation.util';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from './request-context.types';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('buildOutboundHeaders', () => {
  it('should forward the correlation id unchanged', () => {
    const headers = buildOutboundHeaders({ correlationId: 'c-123', requestId: 'r-456' });

    expect(headers[CORRELATION_ID_HEADER]).toBe('c-123');
  });

  it('should mint a fresh request id, distinct from the inbound request id', () => {
    const headers = buildOutboundHeaders({ correlationId: 'c-123', requestId: 'r-456' });

    expect(headers[REQUEST_ID_HEADER]).not.toBe('r-456');
    expect(headers[REQUEST_ID_HEADER]).toMatch(UUID_V4_PATTERN);
  });

  it('should mint a different request id on every call, given the same context', () => {
    const context = { correlationId: 'c-123', requestId: 'r-456' };

    const first = buildOutboundHeaders(context);
    const second = buildOutboundHeaders(context);

    expect(first[REQUEST_ID_HEADER]).not.toBe(second[REQUEST_ID_HEADER]);
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- propagation.util.spec.ts`
Expected: FAIL with a module-not-found error for `./propagation.util`.

- [ ] **Step 9: Implement `buildOutboundHeaders`**

`back-end/service-a/src/core/request-context/propagation.util.ts`:
```ts
import { randomUUID } from 'node:crypto';

import { CORRELATION_ID_HEADER, type IRequestContext, REQUEST_ID_HEADER } from './request-context.types';

export function buildOutboundHeaders(context: IRequestContext): Record<string, string> {
  return {
    [CORRELATION_ID_HEADER]: context.correlationId,
    [REQUEST_ID_HEADER]: randomUUID(),
  };
}
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- propagation.util.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 11: Write the failing tests for `RequestContextService`**

`back-end/service-a/src/core/request-context/request-context.service.spec.ts`:
```ts
import { MissingRequestContextError } from './missing-request-context.error';
import { RequestContextService } from './request-context.service';

describe('RequestContextService', () => {
  let service: RequestContextService;

  beforeEach(() => {
    service = new RequestContextService();
  });

  describe('run', () => {
    it('should make the context available inside the callback via getCorrelationId/getRequestId', () => {
      const result = service.run({ correlationId: 'c-1', requestId: 'r-1' }, () => ({
        correlationId: service.getCorrelationId(),
        requestId: service.getRequestId(),
      }));

      expect(result).toEqual({ correlationId: 'c-1', requestId: 'r-1' });
    });

    it('should isolate concurrent contexts from each other', async () => {
      const readBackAfterDelay = async (context: { correlationId: string; requestId: string }, delayMs: number) =>
        service.run(context, async () => {
          await new Promise((resolve) => setTimeout(resolve, delayMs));

          return service.getAttributes();
        });

      const [first, second] = await Promise.all([
        readBackAfterDelay({ correlationId: 'c-1', requestId: 'r-1' }, 10),
        readBackAfterDelay({ correlationId: 'c-2', requestId: 'r-2' }, 0),
      ]);

      expect(first).toEqual({ correlationId: 'c-1', requestId: 'r-1' });
      expect(second).toEqual({ correlationId: 'c-2', requestId: 'r-2' });
    });
  });

  describe('getCorrelationId', () => {
    it('should return undefined, when called outside of any context', () => {
      expect(service.getCorrelationId()).toBeUndefined();
    });
  });

  describe('getRequestId', () => {
    it('should return undefined, when called outside of any context', () => {
      expect(service.getRequestId()).toBeUndefined();
    });
  });

  describe('getAttributes', () => {
    it('should return an empty object, when called outside of any context', () => {
      expect(service.getAttributes()).toEqual({});
    });

    it('should return a copy of the active context, when called inside one', () => {
      const result = service.run({ correlationId: 'c-1', requestId: 'r-1' }, () => service.getAttributes());

      expect(result).toEqual({ correlationId: 'c-1', requestId: 'r-1' });
    });
  });

  describe('requireContext', () => {
    it('should return the active context, when called inside one', () => {
      const result = service.run({ correlationId: 'c-1', requestId: 'r-1' }, () => service.requireContext());

      expect(result).toEqual({ correlationId: 'c-1', requestId: 'r-1' });
    });

    it('should throw MissingRequestContextError, when called outside of any context', () => {
      expect(() => service.requireContext()).toThrow(MissingRequestContextError);
    });
  });
});
```

- [ ] **Step 12: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- request-context.service.spec.ts`
Expected: FAIL with a module-not-found error for `./request-context.service`.

- [ ] **Step 13: Implement `RequestContextService`**

`back-end/service-a/src/core/request-context/request-context.service.ts`:
```ts
import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';

import { MissingRequestContextError } from './missing-request-context.error';
import { type IRequestContext } from './request-context.types';

@Injectable()
export class RequestContextService {
  public run<T>(context: IRequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  public getCorrelationId(): string | undefined {
    return this.storage.getStore()?.correlationId;
  }

  public getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }

  public getAttributes(): Partial<IRequestContext> {
    const store = this.storage.getStore();

    return store === undefined ? {} : { ...store };
  }

  public requireContext(): IRequestContext {
    const store = this.storage.getStore();

    if (store === undefined) {
      throw new MissingRequestContextError();
    }

    return store;
  }

  private readonly storage = new AsyncLocalStorage<IRequestContext>();
}
```

- [ ] **Step 14: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- request-context.service.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 15: Run the full service-a test suite and lint**

Run: `pnpm --filter service-a test && pnpm --filter service-a lint`
Expected: all tests pass, lint exits 0.

- [ ] **Step 16: Stage the files**

```bash
git add back-end/service-a/src/core/request-context/
```

---

## Task 6: service-a — RMQ interceptor wiring

**Files:**
- Create: `back-end/service-a/src/core/request-context/rmq-context.interceptor.ts`
- Create: `back-end/service-a/src/core/request-context/request-context.module.ts`
- Modify: `back-end/service-a/src/app.module.ts`
- Test: `back-end/service-a/src/core/request-context/rmq-context.interceptor.spec.ts`

**Interfaces:**
- Consumes: `resolveId`, `RequestContextService` from Task 5.
- Produces: `RmqContextInterceptor`, bound globally via `APP_INTERCEPTOR` through
  `RequestContextModule`, seeding the context for every `@MessagePattern`/`@EventPattern` handler —
  relied on by Task 9's health handler.

- [ ] **Step 1: Write the failing interceptor tests**

`back-end/service-a/src/core/request-context/rmq-context.interceptor.spec.ts`:
```ts
import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { type RmqContext } from '@nestjs/microservices';
import { firstValueFrom, of } from 'rxjs';

import { RequestContextService } from './request-context.service';
import { RmqContextInterceptor } from './rmq-context.interceptor';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('RmqContextInterceptor', () => {
  let interceptor: RmqContextInterceptor;
  let requestContextService: RequestContextService;

  beforeEach(() => {
    requestContextService = new RequestContextService();
    interceptor = new RmqContextInterceptor(requestContextService);
  });

  const buildExecutionContext = (headers: Record<string, string>): ExecutionContext => {
    const rmqContext = { getMessage: () => ({ properties: { headers } }) } as unknown as RmqContext;

    return {
      switchToRpc: () => ({ getContext: <T>() => rmqContext as T }),
    } as unknown as ExecutionContext;
  };

  it('should extract and reuse valid correlation id and request id headers', async () => {
    const executionContext = buildExecutionContext({
      'x-correlation-id': '11111111-1111-4111-8111-111111111111',
      'x-request-id': '22222222-2222-4222-8222-222222222222',
    });
    let observedContext: Partial<{ correlationId: string; requestId: string }> = {};
    const callHandler: CallHandler = {
      handle: () => {
        observedContext = requestContextService.getAttributes();

        return of(null);
      },
    };

    await firstValueFrom(interceptor.intercept(executionContext, callHandler));

    expect(observedContext).toEqual({
      correlationId: '11111111-1111-4111-8111-111111111111',
      requestId: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('should generate valid UUID v4 ids, when headers are absent', async () => {
    const executionContext = buildExecutionContext({});
    let observedContext: Partial<{ correlationId: string; requestId: string }> = {};
    const callHandler: CallHandler = {
      handle: () => {
        observedContext = requestContextService.getAttributes();

        return of(null);
      },
    };

    await firstValueFrom(interceptor.intercept(executionContext, callHandler));

    expect(observedContext.correlationId).toMatch(UUID_V4_PATTERN);
    expect(observedContext.requestId).toMatch(UUID_V4_PATTERN);
  });

  it('should generate valid UUID v4 ids, when headers are invalid', async () => {
    const executionContext = buildExecutionContext({ 'x-correlation-id': '', 'x-request-id': '   ' });
    let observedContext: Partial<{ correlationId: string; requestId: string }> = {};
    const callHandler: CallHandler = {
      handle: () => {
        observedContext = requestContextService.getAttributes();

        return of(null);
      },
    };

    await firstValueFrom(interceptor.intercept(executionContext, callHandler));

    expect(observedContext.correlationId).toMatch(UUID_V4_PATTERN);
    expect(observedContext.requestId).toMatch(UUID_V4_PATTERN);
  });

  it('should emit the value produced by the handler', async () => {
    const executionContext = buildExecutionContext({});
    const callHandler: CallHandler = { handle: () => of({ status: 'ok' }) };

    const result = await firstValueFrom(interceptor.intercept(executionContext, callHandler));

    expect(result).toEqual({ status: 'ok' });
  });

  it('should propagate an error emitted by the handler', async () => {
    const executionContext = buildExecutionContext({});
    const callHandler: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          subscriber.error(new Error('handler failed'));
        }),
    };

    await expect(firstValueFrom(interceptor.intercept(executionContext, callHandler))).rejects.toThrow(
      'handler failed',
    );
  });
});
```

Note: the last test uses `Observable` directly — add it to the rxjs import:
`import { firstValueFrom, Observable, of } from 'rxjs';`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- rmq-context.interceptor.spec.ts`
Expected: FAIL with a module-not-found error for `./rmq-context.interceptor`.

- [ ] **Step 3: Implement `RmqContextInterceptor`**

`back-end/service-a/src/core/request-context/rmq-context.interceptor.ts`:
```ts
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { type RmqContext } from '@nestjs/microservices';
import { Observable, type Subscription } from 'rxjs';

import { resolveId } from './id-validation.util';
import { RequestContextService } from './request-context.service';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from './request-context.types';

@Injectable()
export class RmqContextInterceptor implements NestInterceptor {
  public constructor(private readonly requestContextService: RequestContextService) {}

  public intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    const rmqContext = executionContext.switchToRpc().getContext<RmqContext>();
    const headers = (rmqContext.getMessage().properties.headers ?? {}) as Record<
      string,
      string | string[] | undefined
    >;
    const correlationId = resolveId(headers[CORRELATION_ID_HEADER]);
    const requestId = resolveId(headers[REQUEST_ID_HEADER]);

    return new Observable((subscriber) => {
      let subscription: Subscription | undefined;

      this.requestContextService.run({ correlationId, requestId }, () => {
        subscription = next.handle().subscribe(subscriber);
      });

      return () => subscription?.unsubscribe();
    });
  }
}
```

This must run `next.handle()` (which triggers the actual `@MessagePattern` handler invocation)
*inside* `requestContextService.run(...)`'s synchronous callback — not merely wrap the resulting
Observable — because `AsyncLocalStorage` only propagates context to code that runs (synchronously,
or via a promise/timer chain started) while `run()`'s callback is executing. Subscribing to
`next.handle()` from inside that callback is what makes the handler body, and everything it awaits,
see the seeded context.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- rmq-context.interceptor.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Create the module**

`back-end/service-a/src/core/request-context/request-context.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { RequestContextService } from './request-context.service';
import { RmqContextInterceptor } from './rmq-context.interceptor';

@Global()
@Module({
  providers: [RequestContextService, { provide: APP_INTERCEPTOR, useClass: RmqContextInterceptor }],
  exports: [RequestContextService],
})
export class RequestContextModule {}
```

- [ ] **Step 6: Wire the module into `AppModule`**

Replace `back-end/service-a/src/app.module.ts` in full:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import rabbitmqConfig from './config/rabbitmq.config';
import { ExceptionHandlingModule } from './core/exception-handling/exception-handling.module';
import { RequestContextModule } from './core/request-context/request-context.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [rabbitmqConfig] }),
    RequestContextModule,
    ExceptionHandlingModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 7: Run the full service-a test suite and lint**

Run: `pnpm --filter service-a test && pnpm --filter service-a lint`
Expected: all tests pass, lint exits 0.

- [ ] **Step 8: Stage the files**

```bash
git add back-end/service-a/src/core/request-context/ back-end/service-a/src/app.module.ts
```

---

## Task 7: service-b — request-context core (types, validation, propagation, service)

**Files:**
- Create: `back-end/service-b/src/core/request-context/request-context.types.ts`
- Create: `back-end/service-b/src/core/request-context/missing-request-context.error.ts`
- Create: `back-end/service-b/src/core/request-context/id-validation.util.ts`
- Create: `back-end/service-b/src/core/request-context/propagation.util.ts`
- Create: `back-end/service-b/src/core/request-context/request-context.service.ts`
- Test: `back-end/service-b/src/core/request-context/id-validation.util.spec.ts`
- Test: `back-end/service-b/src/core/request-context/propagation.util.spec.ts`
- Test: `back-end/service-b/src/core/request-context/request-context.service.spec.ts`

**Interfaces:**
- Produces: identical shape to Task 1/5 — `IRequestContext`, `CORRELATION_ID_HEADER`,
  `REQUEST_ID_HEADER`, `MAX_ID_LENGTH`, `resolveId`, `buildOutboundHeaders`, `RequestContextService`
  (`run`, `getCorrelationId`, `getRequestId`, `getAttributes`, `requireContext`).

- [ ] **Step 1: Create the types/constants file**

`back-end/service-b/src/core/request-context/request-context.types.ts`:
```ts
export interface IRequestContext {
  correlationId: string;
  requestId: string;
}

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const REQUEST_ID_HEADER = 'x-request-id';
export const MAX_ID_LENGTH = 200;
```

- [ ] **Step 2: Create the missing-context error**

`back-end/service-b/src/core/request-context/missing-request-context.error.ts`:
```ts
import { ErrorCategory } from '../errors/error-category.enum';
import { InternalError } from '../errors/internal/internal-error';

export class MissingRequestContextError extends InternalError {
  public constructor() {
    super(
      'RequestContextService was accessed outside of an active request context',
      MissingRequestContextError.buildOptions({
        code: 'MISSING_REQUEST_CONTEXT',
        category: ErrorCategory.INTERNAL,
      }),
    );
  }
}
```

- [ ] **Step 3: Write the failing tests for `resolveId`**

`back-end/service-b/src/core/request-context/id-validation.util.spec.ts`:
```ts
import { resolveId } from './id-validation.util';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('resolveId', () => {
  it('should return the trimmed value, when given a valid header value with surrounding whitespace', () => {
    const result = resolveId('  11111111-1111-4111-8111-111111111111  ');

    expect(result).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('should return a generated UUID v4, when the header is undefined', () => {
    const result = resolveId(undefined);

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should return a generated UUID v4, when the header is an empty string', () => {
    const result = resolveId('');

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should return a generated UUID v4, when the header is only whitespace', () => {
    const result = resolveId('   ');

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should return a generated UUID v4, when the header exceeds the max length', () => {
    const result = resolveId('a'.repeat(201));

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should accept a value at exactly the max length', () => {
    const value = 'a'.repeat(200);

    const result = resolveId(value);

    expect(result).toBe(value);
  });

  it('should return a generated UUID v4, when the header contains a control character', () => {
    const result = resolveId('bad\r\nvalue');

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should return a generated UUID v4, when the header contains a space', () => {
    const result = resolveId('has space');

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should use the first value, when the header arrives as an array (repeated header)', () => {
    const result = resolveId(['11111111-1111-4111-8111-111111111111', 'other-value']);

    expect(result).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('should return a generated UUID v4, when the header array is empty', () => {
    const result = resolveId([]);

    expect(result).toMatch(UUID_V4_PATTERN);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- id-validation.util.spec.ts`
Expected: FAIL with a module-not-found error for `./id-validation.util`.

- [ ] **Step 5: Implement `resolveId`**

`back-end/service-b/src/core/request-context/id-validation.util.ts`:
```ts
import { randomUUID } from 'node:crypto';

import { MAX_ID_LENGTH } from './request-context.types';

// Printable ASCII, no whitespace/control chars - blocks header/log injection
// via a spoofed id while still allowing non-UUID correlation ids from clients.
const SAFE_ID_PATTERN = /^[\x21-\x7E]+$/;

export function resolveId(raw: string | string[] | undefined): string {
  const candidate = Array.isArray(raw) ? raw[0] : raw;

  if (typeof candidate !== 'string') {
    return randomUUID();
  }

  const trimmed = candidate.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_ID_LENGTH || !SAFE_ID_PATTERN.test(trimmed)) {
    return randomUUID();
  }

  return trimmed;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- id-validation.util.spec.ts`
Expected: PASS (10 tests).

- [ ] **Step 7: Write the failing tests for `buildOutboundHeaders`**

`back-end/service-b/src/core/request-context/propagation.util.spec.ts`:
```ts
import { buildOutboundHeaders } from './propagation.util';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from './request-context.types';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('buildOutboundHeaders', () => {
  it('should forward the correlation id unchanged', () => {
    const headers = buildOutboundHeaders({ correlationId: 'c-123', requestId: 'r-456' });

    expect(headers[CORRELATION_ID_HEADER]).toBe('c-123');
  });

  it('should mint a fresh request id, distinct from the inbound request id', () => {
    const headers = buildOutboundHeaders({ correlationId: 'c-123', requestId: 'r-456' });

    expect(headers[REQUEST_ID_HEADER]).not.toBe('r-456');
    expect(headers[REQUEST_ID_HEADER]).toMatch(UUID_V4_PATTERN);
  });

  it('should mint a different request id on every call, given the same context', () => {
    const context = { correlationId: 'c-123', requestId: 'r-456' };

    const first = buildOutboundHeaders(context);
    const second = buildOutboundHeaders(context);

    expect(first[REQUEST_ID_HEADER]).not.toBe(second[REQUEST_ID_HEADER]);
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- propagation.util.spec.ts`
Expected: FAIL with a module-not-found error for `./propagation.util`.

- [ ] **Step 9: Implement `buildOutboundHeaders`**

`back-end/service-b/src/core/request-context/propagation.util.ts`:
```ts
import { randomUUID } from 'node:crypto';

import { CORRELATION_ID_HEADER, type IRequestContext, REQUEST_ID_HEADER } from './request-context.types';

export function buildOutboundHeaders(context: IRequestContext): Record<string, string> {
  return {
    [CORRELATION_ID_HEADER]: context.correlationId,
    [REQUEST_ID_HEADER]: randomUUID(),
  };
}
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- propagation.util.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 11: Write the failing tests for `RequestContextService`**

`back-end/service-b/src/core/request-context/request-context.service.spec.ts`:
```ts
import { MissingRequestContextError } from './missing-request-context.error';
import { RequestContextService } from './request-context.service';

describe('RequestContextService', () => {
  let service: RequestContextService;

  beforeEach(() => {
    service = new RequestContextService();
  });

  describe('run', () => {
    it('should make the context available inside the callback via getCorrelationId/getRequestId', () => {
      const result = service.run({ correlationId: 'c-1', requestId: 'r-1' }, () => ({
        correlationId: service.getCorrelationId(),
        requestId: service.getRequestId(),
      }));

      expect(result).toEqual({ correlationId: 'c-1', requestId: 'r-1' });
    });

    it('should isolate concurrent contexts from each other', async () => {
      const readBackAfterDelay = async (context: { correlationId: string; requestId: string }, delayMs: number) =>
        service.run(context, async () => {
          await new Promise((resolve) => setTimeout(resolve, delayMs));

          return service.getAttributes();
        });

      const [first, second] = await Promise.all([
        readBackAfterDelay({ correlationId: 'c-1', requestId: 'r-1' }, 10),
        readBackAfterDelay({ correlationId: 'c-2', requestId: 'r-2' }, 0),
      ]);

      expect(first).toEqual({ correlationId: 'c-1', requestId: 'r-1' });
      expect(second).toEqual({ correlationId: 'c-2', requestId: 'r-2' });
    });
  });

  describe('getCorrelationId', () => {
    it('should return undefined, when called outside of any context', () => {
      expect(service.getCorrelationId()).toBeUndefined();
    });
  });

  describe('getRequestId', () => {
    it('should return undefined, when called outside of any context', () => {
      expect(service.getRequestId()).toBeUndefined();
    });
  });

  describe('getAttributes', () => {
    it('should return an empty object, when called outside of any context', () => {
      expect(service.getAttributes()).toEqual({});
    });

    it('should return a copy of the active context, when called inside one', () => {
      const result = service.run({ correlationId: 'c-1', requestId: 'r-1' }, () => service.getAttributes());

      expect(result).toEqual({ correlationId: 'c-1', requestId: 'r-1' });
    });
  });

  describe('requireContext', () => {
    it('should return the active context, when called inside one', () => {
      const result = service.run({ correlationId: 'c-1', requestId: 'r-1' }, () => service.requireContext());

      expect(result).toEqual({ correlationId: 'c-1', requestId: 'r-1' });
    });

    it('should throw MissingRequestContextError, when called outside of any context', () => {
      expect(() => service.requireContext()).toThrow(MissingRequestContextError);
    });
  });
});
```

- [ ] **Step 12: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- request-context.service.spec.ts`
Expected: FAIL with a module-not-found error for `./request-context.service`.

- [ ] **Step 13: Implement `RequestContextService`**

`back-end/service-b/src/core/request-context/request-context.service.ts`:
```ts
import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';

import { MissingRequestContextError } from './missing-request-context.error';
import { type IRequestContext } from './request-context.types';

@Injectable()
export class RequestContextService {
  public run<T>(context: IRequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  public getCorrelationId(): string | undefined {
    return this.storage.getStore()?.correlationId;
  }

  public getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }

  public getAttributes(): Partial<IRequestContext> {
    const store = this.storage.getStore();

    return store === undefined ? {} : { ...store };
  }

  public requireContext(): IRequestContext {
    const store = this.storage.getStore();

    if (store === undefined) {
      throw new MissingRequestContextError();
    }

    return store;
  }

  private readonly storage = new AsyncLocalStorage<IRequestContext>();
}
```

- [ ] **Step 14: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- request-context.service.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 15: Run the full service-b test suite and lint**

Run: `pnpm --filter service-b test && pnpm --filter service-b lint`
Expected: all tests pass, lint exits 0.

- [ ] **Step 16: Stage the files**

```bash
git add back-end/service-b/src/core/request-context/
```

---

## Task 8: service-b — RMQ interceptor wiring

**Files:**
- Create: `back-end/service-b/src/core/request-context/rmq-context.interceptor.ts`
- Create: `back-end/service-b/src/core/request-context/request-context.module.ts`
- Modify: `back-end/service-b/src/app.module.ts`
- Test: `back-end/service-b/src/core/request-context/rmq-context.interceptor.spec.ts`

**Interfaces:**
- Consumes: `resolveId`, `RequestContextService` from Task 7.
- Produces: `RmqContextInterceptor`, bound globally via `APP_INTERCEPTOR` through
  `RequestContextModule`, seeding the context for every `@MessagePattern`/`@EventPattern` handler.

- [ ] **Step 1: Write the failing interceptor tests**

`back-end/service-b/src/core/request-context/rmq-context.interceptor.spec.ts`:
```ts
import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { type RmqContext } from '@nestjs/microservices';
import { firstValueFrom, Observable, of } from 'rxjs';

import { RequestContextService } from './request-context.service';
import { RmqContextInterceptor } from './rmq-context.interceptor';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('RmqContextInterceptor', () => {
  let interceptor: RmqContextInterceptor;
  let requestContextService: RequestContextService;

  beforeEach(() => {
    requestContextService = new RequestContextService();
    interceptor = new RmqContextInterceptor(requestContextService);
  });

  const buildExecutionContext = (headers: Record<string, string>): ExecutionContext => {
    const rmqContext = { getMessage: () => ({ properties: { headers } }) } as unknown as RmqContext;

    return {
      switchToRpc: () => ({ getContext: <T>() => rmqContext as T }),
    } as unknown as ExecutionContext;
  };

  it('should extract and reuse valid correlation id and request id headers', async () => {
    const executionContext = buildExecutionContext({
      'x-correlation-id': '11111111-1111-4111-8111-111111111111',
      'x-request-id': '22222222-2222-4222-8222-222222222222',
    });
    let observedContext: Partial<{ correlationId: string; requestId: string }> = {};
    const callHandler: CallHandler = {
      handle: () => {
        observedContext = requestContextService.getAttributes();

        return of(null);
      },
    };

    await firstValueFrom(interceptor.intercept(executionContext, callHandler));

    expect(observedContext).toEqual({
      correlationId: '11111111-1111-4111-8111-111111111111',
      requestId: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('should generate valid UUID v4 ids, when headers are absent', async () => {
    const executionContext = buildExecutionContext({});
    let observedContext: Partial<{ correlationId: string; requestId: string }> = {};
    const callHandler: CallHandler = {
      handle: () => {
        observedContext = requestContextService.getAttributes();

        return of(null);
      },
    };

    await firstValueFrom(interceptor.intercept(executionContext, callHandler));

    expect(observedContext.correlationId).toMatch(UUID_V4_PATTERN);
    expect(observedContext.requestId).toMatch(UUID_V4_PATTERN);
  });

  it('should generate valid UUID v4 ids, when headers are invalid', async () => {
    const executionContext = buildExecutionContext({ 'x-correlation-id': '', 'x-request-id': '   ' });
    let observedContext: Partial<{ correlationId: string; requestId: string }> = {};
    const callHandler: CallHandler = {
      handle: () => {
        observedContext = requestContextService.getAttributes();

        return of(null);
      },
    };

    await firstValueFrom(interceptor.intercept(executionContext, callHandler));

    expect(observedContext.correlationId).toMatch(UUID_V4_PATTERN);
    expect(observedContext.requestId).toMatch(UUID_V4_PATTERN);
  });

  it('should emit the value produced by the handler', async () => {
    const executionContext = buildExecutionContext({});
    const callHandler: CallHandler = { handle: () => of({ status: 'ok' }) };

    const result = await firstValueFrom(interceptor.intercept(executionContext, callHandler));

    expect(result).toEqual({ status: 'ok' });
  });

  it('should propagate an error emitted by the handler', async () => {
    const executionContext = buildExecutionContext({});
    const callHandler: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          subscriber.error(new Error('handler failed'));
        }),
    };

    await expect(firstValueFrom(interceptor.intercept(executionContext, callHandler))).rejects.toThrow(
      'handler failed',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- rmq-context.interceptor.spec.ts`
Expected: FAIL with a module-not-found error for `./rmq-context.interceptor`.

- [ ] **Step 3: Implement `RmqContextInterceptor`**

`back-end/service-b/src/core/request-context/rmq-context.interceptor.ts`:
```ts
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { type RmqContext } from '@nestjs/microservices';
import { Observable, type Subscription } from 'rxjs';

import { resolveId } from './id-validation.util';
import { RequestContextService } from './request-context.service';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from './request-context.types';

@Injectable()
export class RmqContextInterceptor implements NestInterceptor {
  public constructor(private readonly requestContextService: RequestContextService) {}

  public intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    const rmqContext = executionContext.switchToRpc().getContext<RmqContext>();
    const headers = (rmqContext.getMessage().properties.headers ?? {}) as Record<
      string,
      string | string[] | undefined
    >;
    const correlationId = resolveId(headers[CORRELATION_ID_HEADER]);
    const requestId = resolveId(headers[REQUEST_ID_HEADER]);

    return new Observable((subscriber) => {
      let subscription: Subscription | undefined;

      this.requestContextService.run({ correlationId, requestId }, () => {
        subscription = next.handle().subscribe(subscriber);
      });

      return () => subscription?.unsubscribe();
    });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- rmq-context.interceptor.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Create the module**

`back-end/service-b/src/core/request-context/request-context.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { RequestContextService } from './request-context.service';
import { RmqContextInterceptor } from './rmq-context.interceptor';

@Global()
@Module({
  providers: [RequestContextService, { provide: APP_INTERCEPTOR, useClass: RmqContextInterceptor }],
  exports: [RequestContextService],
})
export class RequestContextModule {}
```

- [ ] **Step 6: Wire the module into `AppModule`**

Replace `back-end/service-b/src/app.module.ts` in full:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import rabbitmqConfig from './config/rabbitmq.config';
import { ExceptionHandlingModule } from './core/exception-handling/exception-handling.module';
import { RequestContextModule } from './core/request-context/request-context.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [rabbitmqConfig] }),
    RequestContextModule,
    ExceptionHandlingModule,
    HealthModule,
  ],
})
export class AppModule {}
```
- [ ] **Step 7:** Run `pnpm --filter service-b test && pnpm --filter service-b lint` — expect all pass, lint exits 0.
- [ ] **Step 8:** Stage: `git add back-end/service-b/src/core/request-context/ back-end/service-b/src/app.module.ts`

---

## Task 9: service-a calls service-b — the real 3-hop chain

**Files:**
- Modify: `back-end/service-a/src/config/rabbitmq.config.ts`
- Modify: `back-end/service-a/src/config/rabbitmq.config.spec.ts`
- Create: `back-end/service-a/src/health/rabbitmq-clients.tokens.ts`
- Create: `back-end/service-a/src/health/rabbitmq-ping.health-indicator.ts`
- Create: `back-end/service-a/src/health/rabbitmq-ping.health-indicator.spec.ts`
- Modify: `back-end/service-a/src/health/health.module.ts`
- Modify: `back-end/service-a/src/health/health.controller.ts`
- Modify: `back-end/service-a/src/health/health.controller.spec.ts`
- Modify: `back-end/service-a/.env.example`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: `RequestContextService`, `buildOutboundHeaders` from Task 5/6.
- Produces: `GET /health/service-a` on the gateway now exercises gateway→service-a→service-b with
  one `correlationId` and three distinct `requestId`s — the scenario requirement 9 of the ticket
  asks to verify. Relied on by Task 14's workspace-wide check and the README (Task 13).

- [ ] **Step 1: Update the failing config test**

Replace `back-end/service-a/src/config/rabbitmq.config.spec.ts` in full:
```ts
import rabbitmqConfig from './rabbitmq.config';

describe('rabbitmqConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return documented defaults, when no environment variables are set', () => {
      delete process.env.RABBITMQ_URL;
      delete process.env.RABBITMQ_QUEUE;
      delete process.env.RABBITMQ_SERVICE_B_QUEUE;
      delete process.env.RABBITMQ_PING_TIMEOUT_MS;

      expect(rabbitmqConfig()).toEqual({
        url: 'amqp://guest:guest@localhost:5672',
        queue: 'service_a_queue',
        serviceBQueue: 'service_b_queue',
        pingTimeoutMs: 3000,
      });
    });
  });

  describe('environment overrides', () => {
    it('should parse values from environment variables, when all variables are set', () => {
      process.env.RABBITMQ_URL = 'amqp://user:pass@rabbit-host:5672';
      process.env.RABBITMQ_QUEUE = 'custom_service_a_queue';
      process.env.RABBITMQ_SERVICE_B_QUEUE = 'custom_service_b_queue';
      process.env.RABBITMQ_PING_TIMEOUT_MS = '5000';

      expect(rabbitmqConfig()).toEqual({
        url: 'amqp://user:pass@rabbit-host:5672',
        queue: 'custom_service_a_queue',
        serviceBQueue: 'custom_service_b_queue',
        pingTimeoutMs: 5000,
      });
    });
  });

  describe('validation', () => {
    it('should throw, when RABBITMQ_URL is not a valid url', () => {
      process.env.RABBITMQ_URL = 'not-a-valid-url';

      expect(() => rabbitmqConfig()).toThrow();
    });

    it('should throw, when RABBITMQ_QUEUE is an empty string', () => {
      process.env.RABBITMQ_QUEUE = '';

      expect(() => rabbitmqConfig()).toThrow();
    });

    it('should throw, when RABBITMQ_SERVICE_B_QUEUE is an empty string', () => {
      process.env.RABBITMQ_SERVICE_B_QUEUE = '';

      expect(() => rabbitmqConfig()).toThrow();
    });

    it('should throw, when RABBITMQ_PING_TIMEOUT_MS is not a positive number', () => {
      process.env.RABBITMQ_PING_TIMEOUT_MS = '-1';

      expect(() => rabbitmqConfig()).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- rabbitmq.config.spec.ts`
Expected: FAIL — `serviceBQueue`/`pingTimeoutMs` not yet in the schema.

- [ ] **Step 3: Update the config schema**

Replace `back-end/service-a/src/config/rabbitmq.config.ts` in full:
```ts
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const rabbitmqConfigSchema = z.object({
  url: z.url().default('amqp://guest:guest@localhost:5672'),
  queue: z.string().min(1).default('service_a_queue'),
  serviceBQueue: z.string().min(1).default('service_b_queue'),
  pingTimeoutMs: z.coerce.number().int().positive().default(3000),
});

export type RabbitmqConfiguration = z.infer<typeof rabbitmqConfigSchema>;

export default registerAs('rabbitmq', (): RabbitmqConfiguration =>
  rabbitmqConfigSchema.parse({
    url: process.env.RABBITMQ_URL,
    queue: process.env.RABBITMQ_QUEUE,
    serviceBQueue: process.env.RABBITMQ_SERVICE_B_QUEUE,
    pingTimeoutMs: process.env.RABBITMQ_PING_TIMEOUT_MS,
  }),
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- rabbitmq.config.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Create the client token**

`back-end/service-a/src/health/rabbitmq-clients.tokens.ts`:
```ts
export const SERVICE_B_RMQ_CLIENT = 'SERVICE_B_RMQ_CLIENT';
```

- [ ] **Step 6: Write the failing health-indicator test**

`back-end/service-a/src/health/rabbitmq-ping.health-indicator.spec.ts`:
```ts
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { type HealthIndicatorService } from '@nestjs/terminus';
import { of, throwError } from 'rxjs';

import type rabbitmqConfig from '../config/rabbitmq.config';
import { RequestContextService } from '../core/request-context/request-context.service';

import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator';

describe('RabbitMqPingHealthIndicator', () => {
  let indicator: RabbitMqPingHealthIndicator;
  let requestContextService: RequestContextService;
  let upMock: ReturnType<typeof vi.fn>;
  let downMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    upMock = vi.fn();
    downMock = vi.fn();

    const healthIndicatorService = {
      check: vi.fn().mockReturnValue({ up: upMock, down: downMock }),
    } as unknown as HealthIndicatorService;

    requestContextService = new RequestContextService();

    indicator = new RabbitMqPingHealthIndicator(healthIndicatorService, requestContextService, {
      pingTimeoutMs: 3000,
    } as ConfigType<typeof rabbitmqConfig>);
  });

  const runWithinContext = <T>(callback: () => T): T =>
    requestContextService.run({ correlationId: 'c-123', requestId: 'r-inbound' }, callback);

  it('should report the indicator as up, when service-b replies to health.check', async () => {
    const expectedResult = { 'service-b': { status: 'up' } };
    upMock.mockReturnValue(expectedResult);

    const client = { send: vi.fn().mockReturnValue(of({ status: 'ok' })) } as unknown as ClientProxy;

    const result = await runWithinContext(() => indicator.isHealthy('service-b', client));

    expect(result).toEqual(expectedResult);
  });

  it('should report the indicator as down, when service-b errors', async () => {
    const expectedResult = { 'service-b': { status: 'down', message: 'connection refused' } };
    downMock.mockReturnValue(expectedResult);

    const client = {
      send: vi.fn().mockReturnValue(throwError(() => new Error('connection refused'))),
    } as unknown as ClientProxy;

    const result = await runWithinContext(() => indicator.isHealthy('service-b', client));

    expect(result).toEqual(expectedResult);
  });

  it('should send a message record whose headers forward the active correlation id and a fresh request id', async () => {
    upMock.mockReturnValue({ 'service-b': { status: 'up' } });

    const send = vi.fn().mockReturnValue(of({ status: 'ok' }));
    const client = { send } as unknown as ClientProxy;

    await runWithinContext(() => indicator.isHealthy('service-b', client));

    const [pattern, record] = send.mock.calls[0] as [string, { options: { headers: Record<string, string> } }];

    expect(pattern).toBe('health.check');
    expect(record.options.headers['x-correlation-id']).toBe('c-123');
    expect(record.options.headers['x-request-id']).not.toBe('r-inbound');
  });

  it('should throw MissingRequestContextError, when called outside of any request context', async () => {
    const client = { send: vi.fn().mockReturnValue(of({ status: 'ok' })) } as unknown as ClientProxy;

    await expect(indicator.isHealthy('service-b', client)).rejects.toThrow(
      'RequestContextService was accessed outside of an active request context',
    );
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- rabbitmq-ping.health-indicator.spec.ts`
Expected: FAIL with a module-not-found error for `./rabbitmq-ping.health-indicator`.

- [ ] **Step 8: Implement the health indicator**

`back-end/service-a/src/health/rabbitmq-ping.health-indicator.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { firstValueFrom, timeout } from 'rxjs';

import rabbitmqConfig from '../config/rabbitmq.config';
import { buildOutboundHeaders } from '../core/request-context/propagation.util';
import { RequestContextService } from '../core/request-context/request-context.service';

@Injectable()
export class RabbitMqPingHealthIndicator {
  public constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly requestContextService: RequestContextService,
    @Inject(rabbitmqConfig.KEY) private readonly config: ConfigType<typeof rabbitmqConfig>,
  ) {}

  public async isHealthy(key: string, client: ClientProxy): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const headers = buildOutboundHeaders(this.requestContextService.requireContext());
    const record = new RmqRecordBuilder({}).setOptions({ headers }).build();

    try {
      await firstValueFrom(client.send('health.check', record).pipe(timeout(this.config.pingTimeoutMs)));

      return indicator.up();
    } catch (error) {
      return indicator.down({ message: error instanceof Error ? error.message : 'unknown error' });
    }
  }
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- rabbitmq-ping.health-indicator.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 10: Wire the client and indicator into `HealthModule`**

Replace `back-end/service-a/src/health/health.module.ts` in full:
```ts
import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { TerminusModule } from '@nestjs/terminus';

import rabbitmqConfig from '../config/rabbitmq.config';

import { HealthController } from './health.controller';
import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-clients.tokens';
import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator';

@Module({
  imports: [
    TerminusModule,
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
    ]),
  ],
  controllers: [HealthController],
  providers: [RabbitMqPingHealthIndicator],
})
export class HealthModule {}
```

- [ ] **Step 11: Write the failing controller test**

Replace `back-end/service-a/src/health/health.controller.spec.ts` in full:
```ts
import { TerminusModule } from '@nestjs/terminus';
import { Test, type TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';

import rabbitmqConfig from '../config/rabbitmq.config';
import { RequestContextService } from '../core/request-context/request-context.service';

import { HealthController } from './health.controller';
import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-clients.tokens';
import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator';

describe('HealthController', () => {
  let controller: HealthController;
  let requestContextService: RequestContextService;
  let serviceBClient: { send: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    serviceBClient = { send: vi.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        RabbitMqPingHealthIndicator,
        RequestContextService,
        { provide: SERVICE_B_RMQ_CLIENT, useValue: serviceBClient },
        { provide: rabbitmqConfig.KEY, useValue: { pingTimeoutMs: 3000 } },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
    requestContextService = moduleRef.get(RequestContextService);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('check', () => {
    it('should return ok health check result, when service-b replies to health.check', async () => {
      serviceBClient.send.mockReturnValue(of({ status: 'ok' }));

      const result = await requestContextService.run({ correlationId: 'c-1', requestId: 'r-1' }, () =>
        controller.check(),
      );

      expect(result).toEqual({
        status: 'ok',
        info: { 'service-b': { status: 'up' } },
        error: {},
        details: { 'service-b': { status: 'up' } },
      });
    });

    it('should reject, when service-b does not reply', async () => {
      serviceBClient.send.mockReturnValue(throwError(() => new Error('connection refused')));

      await expect(
        requestContextService.run({ correlationId: 'c-1', requestId: 'r-1' }, () => controller.check()),
      ).rejects.toThrow();
    });

    it('should forward the active correlation id and a fresh request id to service-b', async () => {
      serviceBClient.send.mockReturnValue(of({ status: 'ok' }));

      await requestContextService.run({ correlationId: 'c-1', requestId: 'r-inbound' }, () => controller.check());

      const [pattern, record] = serviceBClient.send.mock.calls[0] as [
        string,
        { options: { headers: Record<string, string> } },
      ];

      expect(pattern).toBe('health.check');
      expect(record.options.headers['x-correlation-id']).toBe('c-1');
      expect(record.options.headers['x-request-id']).not.toBe('r-inbound');
    });
  });
});
```

- [ ] **Step 12: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- health.controller.spec.ts`
Expected: FAIL — `HealthController`'s constructor doesn't yet take the new dependencies.

- [ ] **Step 13: Update the controller**

Replace `back-end/service-a/src/health/health.controller.ts` in full:
```ts
import { Controller, Inject } from '@nestjs/common';
import { ClientProxy, MessagePattern } from '@nestjs/microservices';
import { HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';

import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-clients.tokens';
import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator';

@Controller()
export class HealthController {
  public constructor(
    private readonly health: HealthCheckService,
    private readonly rabbitMqPing: RabbitMqPingHealthIndicator,
    @Inject(SERVICE_B_RMQ_CLIENT) private readonly serviceBClient: ClientProxy,
  ) {}

  @MessagePattern('health.check')
  public check(): Promise<HealthCheckResult> {
    return this.health.check([() => this.rabbitMqPing.isHealthy('service-b', this.serviceBClient)]);
  }
}
```

- [ ] **Step 14: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- health.controller.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 15: Update `.env.example`**

Replace `back-end/service-a/.env.example` in full:
```
RABBITMQ_URL=amqp://guest:guest@localhost:5672
RABBITMQ_QUEUE=service_a_queue
RABBITMQ_SERVICE_B_QUEUE=service_b_queue
RABBITMQ_PING_TIMEOUT_MS=3000
```

- [ ] **Step 16: Update `docker-compose.yml`**

Modify the `service-a` service's `environment` block in `docker-compose.yml` (repo root) — add
`RABBITMQ_SERVICE_B_QUEUE`:
```yaml
  service-a:
    container_name: task1-service-a
    build:
      context: .
      dockerfile: back-end/service-a/Dockerfile
      target: runtime
    restart: unless-stopped
    environment:
      <<: *rabbitmq_url
      RABBITMQ_QUEUE: service_a_queue
      RABBITMQ_SERVICE_B_QUEUE: service_b_queue
    depends_on:
      rabbitmq:
        condition: service_healthy
```

- [ ] **Step 17: Run the full service-a test suite and lint**

Run: `pnpm --filter service-a test && pnpm --filter service-a lint`
Expected: all tests pass, lint exits 0.

- [ ] **Step 18: Manually verify the full 3-hop chain**

Run: `pnpm docker:up` (or `docker compose up -d`) to start RabbitMQ, service-a, service-b, then:
```bash
pnpm --filter gateway start:dev
```
In another terminal:
```bash
curl -i http://localhost:3000/health/service-a \
  -H "X-Correlation-ID: 11111111-1111-4111-8111-111111111111"
```
Expected: `200 OK`, `x-correlation-id: 11111111-1111-4111-8111-111111111111` echoed back,
`x-request-id` present as a fresh UUID, body `{"status":"ok","info":{"service-a":{"status":"up"}},...}`.
Stop `service-b` (`docker compose stop service-b`) and repeat the same request — expected: `503`,
same `x-correlation-id` echoed back, error body's `error.details` shows `service-b` down.

- [ ] **Step 19: Stage the files**

```bash
git add back-end/service-a/src/config/ back-end/service-a/src/health/ back-end/service-a/.env.example docker-compose.yml
```

---

## Task 10: Gateway — pino/nestjs-pino logging, auto-including correlation/request IDs

**Files:**
- Create: `back-end/gateway/src/config/environment.helper.ts`
- Create: `back-end/gateway/src/config/environment.helper.spec.ts`
- Create: `back-end/gateway/src/config/logger.config.ts`
- Create: `back-end/gateway/src/config/logger.config.spec.ts`
- Create: `back-end/gateway/src/core/logger/types.ts`
- Create: `back-end/gateway/src/core/logger/pino-config.factory.ts`
- Create: `back-end/gateway/src/core/logger/pino-config.factory.spec.ts`
- Create: `back-end/gateway/src/core/logger/app-logger.ts`
- Create: `back-end/gateway/src/core/logger/app-logger.spec.ts`
- Create: `back-end/gateway/src/core/logger/logger.service.ts`
- Create: `back-end/gateway/src/core/logger/logger.service.spec.ts`
- Create: `back-end/gateway/src/core/logger/nest-logger.bridge.ts`
- Create: `back-end/gateway/src/core/logger/nest-logger.bridge.spec.ts`
- Create: `back-end/gateway/src/core/logger/logger.module.ts`
- Modify: `back-end/gateway/src/app.module.ts`
- Modify: `back-end/gateway/src/main.ts`
- Modify: `back-end/gateway/.env.example`
- Modify: `back-end/gateway/package.json`

**Interfaces:**
- Consumes: `RequestContextService.getAttributes()` from Task 1, `RequestContextModule` from Task 2.
- Produces: `LoggerService.getLogger(source, channel?): AppLogger` (with `trace/debug/info/warn/error(fields, message)`), `NestLoggerBridge` (Nest's internal `LoggerService` interface). Every log line automatically carries `{ correlationId, requestId }` when emitted inside a request. Relied on by Task 13 (README) for the "how it appears in logs" section.

- [ ] **Step 1: Install dependencies**

Run: `pnpm --filter gateway add nestjs-pino pino pino-http pino-pretty`
Expected: `back-end/gateway/package.json` gains all four under `dependencies` (not `devDependencies` —
pino resolves transport targets like `pino-pretty` by module name at runtime, so it must be
resolvable in production too).

- [ ] **Step 2: Write the failing environment-helper tests**

`back-end/gateway/src/config/environment.helper.spec.ts`:
```ts
import { getNodeEnv, isProduction } from './environment.helper';

describe('environment.helper', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('isProduction', () => {
    it('should return true, when NODE_ENV is "production"', () => {
      process.env.NODE_ENV = 'production';

      expect(isProduction()).toBe(true);
    });

    it('should return false, when NODE_ENV is not "production"', () => {
      process.env.NODE_ENV = 'development';

      expect(isProduction()).toBe(false);
    });
  });

  describe('getNodeEnv', () => {
    it('should return the value of NODE_ENV, when set', () => {
      process.env.NODE_ENV = 'staging';

      expect(getNodeEnv()).toBe('staging');
    });

    it('should default to "development", when NODE_ENV is not set', () => {
      delete process.env.NODE_ENV;

      expect(getNodeEnv()).toBe('development');
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter gateway test -- environment.helper.spec.ts`
Expected: FAIL with a module-not-found error for `./environment.helper`.

- [ ] **Step 4: Implement `environment.helper.ts`**

`back-end/gateway/src/config/environment.helper.ts`:
```ts
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function getNodeEnv(): string {
  return process.env.NODE_ENV ?? 'development';
}
```

Both functions read `process.env.NODE_ENV` live on every call (not cached at module-load time) —
this is what makes them, and everything built on top of them, deterministically testable by
mutating `process.env` per test case.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter gateway test -- environment.helper.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the failing logger-config tests**

`back-end/gateway/src/config/logger.config.spec.ts`:
```ts
import loggerConfig from './logger.config';

describe('loggerConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should default to "trace" level, when LOG_LEVEL is unset and NODE_ENV is not "production"', () => {
      delete process.env.LOG_LEVEL;
      process.env.NODE_ENV = 'development';

      expect(loggerConfig().level).toBe('trace');
    });

    it('should default to "info" level, when LOG_LEVEL is unset and NODE_ENV is "production"', () => {
      delete process.env.LOG_LEVEL;
      process.env.NODE_ENV = 'production';

      expect(loggerConfig().level).toBe('info');
    });

    it('should default to the "json" transport, when APP_LOG_TRANSPORT is unset', () => {
      delete process.env.APP_LOG_TRANSPORT;

      expect(loggerConfig().transport).toBe('json');
    });
  });

  describe('environment overrides', () => {
    it('should use an explicit LOG_LEVEL, even in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.LOG_LEVEL = 'warn';

      expect(loggerConfig().level).toBe('warn');
    });

    it('should select the pretty transport, when APP_LOG_TRANSPORT is "pretty"', () => {
      process.env.APP_LOG_TRANSPORT = 'pretty';

      expect(loggerConfig().transport).toBe('pretty');
    });

    it('should select the json transport, when APP_LOG_TRANSPORT is any other value', () => {
      process.env.APP_LOG_TRANSPORT = 'anything-else';

      expect(loggerConfig().transport).toBe('json');
    });
  });

  describe('validation', () => {
    it('should throw, when LOG_LEVEL is not one of the documented levels', () => {
      process.env.LOG_LEVEL = 'verbose';

      expect(() => loggerConfig()).toThrow();
    });
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm --filter gateway test -- logger.config.spec.ts`
Expected: FAIL with a module-not-found error for `./logger.config`.

- [ ] **Step 8: Implement `logger.config.ts`**

`back-end/gateway/src/config/logger.config.ts`:
```ts
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

import { isProduction } from './environment.helper';

const loggerConfigSchema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  transport: z.enum(['json', 'pretty']).default('json'),
});

export interface LoggerConfiguration {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  transport: 'json' | 'pretty';
}

export default registerAs('logger', (): LoggerConfiguration => {
  const parsed = loggerConfigSchema.parse({
    level: process.env.LOG_LEVEL,
    transport: process.env.APP_LOG_TRANSPORT === 'pretty' ? 'pretty' : undefined,
  });

  return {
    level: parsed.level ?? (isProduction() ? 'info' : 'trace'),
    transport: parsed.transport,
  };
});
```

Note: `LoggerConfiguration` is a hand-written interface here (not `z.infer<...>`) because the
production-dependent default for `level` is computed *after* parsing, not by Zod's own
`.default()` — that keeps `isProduction()` evaluated fresh on every call to `loggerConfig()`
instead of being baked into the schema once at module-import time.

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter gateway test -- logger.config.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 10: Create the logger types**

`back-end/gateway/src/core/logger/types.ts`:
```ts
export type LogChannel = 'http' | 'bootstrap';

export type LogFields = Record<string, unknown>;
```

- [ ] **Step 11: Write the failing `AppLogger` tests**

`back-end/gateway/src/core/logger/app-logger.spec.ts`:
```ts
import { type PinoLogger } from 'nestjs-pino';

import { AppLogger } from './app-logger';

describe('AppLogger', () => {
  let pinoLogger: {
    trace: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let logger: AppLogger;

  beforeEach(() => {
    pinoLogger = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    logger = new AppLogger(pinoLogger as unknown as PinoLogger, 'HealthController', 'http');
  });

  it('should forward info() to the underlying pino logger with source and channel bound', () => {
    logger.info({ statusCode: 200 }, 'request handled');

    expect(pinoLogger.info).toHaveBeenCalledWith(
      { statusCode: 200, source: 'HealthController', channel: 'http' },
      'request handled',
    );
  });

  it('should forward trace()', () => {
    logger.trace({}, 'trace message');

    expect(pinoLogger.trace).toHaveBeenCalledWith({ source: 'HealthController', channel: 'http' }, 'trace message');
  });

  it('should forward debug()', () => {
    logger.debug({}, 'debug message');

    expect(pinoLogger.debug).toHaveBeenCalledWith({ source: 'HealthController', channel: 'http' }, 'debug message');
  });

  it('should forward warn()', () => {
    logger.warn({}, 'warn message');

    expect(pinoLogger.warn).toHaveBeenCalledWith({ source: 'HealthController', channel: 'http' }, 'warn message');
  });

  it('should forward error()', () => {
    logger.error({}, 'error message');

    expect(pinoLogger.error).toHaveBeenCalledWith({ source: 'HealthController', channel: 'http' }, 'error message');
  });
});
```

- [ ] **Step 12: Run the test to verify it fails**

Run: `pnpm --filter gateway test -- app-logger.spec.ts`
Expected: FAIL with a module-not-found error for `./app-logger`.

- [ ] **Step 13: Implement `AppLogger`**

`back-end/gateway/src/core/logger/app-logger.ts`:
```ts
import { type PinoLogger } from 'nestjs-pino';

import { type LogChannel, type LogFields } from './types';

export class AppLogger {
  public constructor(
    private readonly pinoLogger: PinoLogger,
    private readonly source: string,
    private readonly channel: LogChannel,
  ) {}

  public trace(fields: LogFields, message: string): void {
    this.pinoLogger.trace({ ...fields, source: this.source, channel: this.channel }, message);
  }

  public debug(fields: LogFields, message: string): void {
    this.pinoLogger.debug({ ...fields, source: this.source, channel: this.channel }, message);
  }

  public info(fields: LogFields, message: string): void {
    this.pinoLogger.info({ ...fields, source: this.source, channel: this.channel }, message);
  }

  public warn(fields: LogFields, message: string): void {
    this.pinoLogger.warn({ ...fields, source: this.source, channel: this.channel }, message);
  }

  public error(fields: LogFields, message: string): void {
    this.pinoLogger.error({ ...fields, source: this.source, channel: this.channel }, message);
  }
}
```

- [ ] **Step 14: Run the test to verify it passes**

Run: `pnpm --filter gateway test -- app-logger.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 15: Write the failing `LoggerService` tests**

`back-end/gateway/src/core/logger/logger.service.spec.ts`:
```ts
import { type PinoLogger } from 'nestjs-pino';

import { AppLogger } from './app-logger';
import { LoggerService } from './logger.service';

describe('LoggerService', () => {
  it('should return an AppLogger bound to the given source and default "http" channel', () => {
    const pinoLogger = {} as PinoLogger;
    const service = new LoggerService(pinoLogger);

    const logger = service.getLogger('HealthController');

    expect(logger).toBeInstanceOf(AppLogger);
  });

  it('should bind the given channel, when explicitly provided', () => {
    const pinoLogger = { info: vi.fn() } as unknown as PinoLogger;
    const service = new LoggerService(pinoLogger);

    const logger = service.getLogger('Nest', 'bootstrap');
    logger.info({}, 'starting up');

    expect(pinoLogger.info).toHaveBeenCalledWith({ source: 'Nest', channel: 'bootstrap' }, 'starting up');
  });
});
```

- [ ] **Step 16: Run the test to verify it fails**

Run: `pnpm --filter gateway test -- logger.service.spec.ts`
Expected: FAIL with a module-not-found error for `./logger.service`.

- [ ] **Step 17: Implement `LoggerService`**

`back-end/gateway/src/core/logger/logger.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { AppLogger } from './app-logger';
import { type LogChannel } from './types';

@Injectable()
export class LoggerService {
  public constructor(private readonly pinoLogger: PinoLogger) {}

  public getLogger(source: string, channel: LogChannel = 'http'): AppLogger {
    return new AppLogger(this.pinoLogger, source, channel);
  }
}
```

- [ ] **Step 18: Run the test to verify it passes**

Run: `pnpm --filter gateway test -- logger.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 19: Write the failing `pinoConfigFactory` tests**

`back-end/gateway/src/core/logger/pino-config.factory.spec.ts`:
```ts
import { RequestContextService } from '../request-context/request-context.service';

import { pinoConfigFactory } from './pino-config.factory';

describe('pinoConfigFactory', () => {
  let requestContextService: RequestContextService;

  beforeEach(() => {
    requestContextService = new RequestContextService();
  });

  it('should set the level from config', () => {
    const params = pinoConfigFactory({ level: 'warn', transport: 'json' }, requestContextService);

    expect(params.pinoHttp).toMatchObject({ level: 'warn' });
  });

  it('should omit the transport option, when config.transport is "json"', () => {
    const params = pinoConfigFactory({ level: 'info', transport: 'json' }, requestContextService);

    expect(params.pinoHttp).toMatchObject({ transport: undefined });
  });

  it('should configure pino-pretty, when config.transport is "pretty"', () => {
    const params = pinoConfigFactory({ level: 'info', transport: 'pretty' }, requestContextService);

    expect(params.pinoHttp).toMatchObject({
      transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } },
    });
  });

  it('should mix in the active request context attributes into every log line', () => {
    const params = pinoConfigFactory({ level: 'info', transport: 'json' }, requestContextService);
    const mixin = (params.pinoHttp as { mixin: () => unknown }).mixin;

    const result = requestContextService.run({ correlationId: 'c-1', requestId: 'r-1' }, () => mixin());

    expect(result).toEqual({ correlationId: 'c-1', requestId: 'r-1' });
  });

  it('should ignore the two health-check routes from auto-logging', () => {
    const params = pinoConfigFactory({ level: 'info', transport: 'json' }, requestContextService);
    const ignore = (
      params.pinoHttp as { autoLogging: { ignore: (request: { url?: string }) => boolean } }
    ).autoLogging.ignore;

    expect(ignore({ url: '/health/service-a' })).toBe(true);
    expect(ignore({ url: '/health/service-b' })).toBe(true);
    expect(ignore({ url: '/v1/example' })).toBe(false);
  });
});
```

- [ ] **Step 20: Run the test to verify it fails**

Run: `pnpm --filter gateway test -- pino-config.factory.spec.ts`
Expected: FAIL with a module-not-found error for `./pino-config.factory`.

- [ ] **Step 21: Implement `pinoConfigFactory`**

`back-end/gateway/src/core/logger/pino-config.factory.ts`:
```ts
import { type Params } from 'nestjs-pino';

import { type LoggerConfiguration } from '../../config/logger.config';
import { type RequestContextService } from '../request-context/request-context.service';

function isHealthCheckRequest(request: { url?: string }): boolean {
  return request.url === '/health/service-a' || request.url === '/health/service-b';
}

export function pinoConfigFactory(config: LoggerConfiguration, requestContextService: RequestContextService): Params {
  return {
    pinoHttp: {
      level: config.level,
      mixin: () => requestContextService.getAttributes(),
      autoLogging: { ignore: isHealthCheckRequest },
      transport:
        config.transport === 'pretty'
          ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
          : undefined,
    },
  };
}
```

- [ ] **Step 22: Run the test to verify it passes**

Run: `pnpm --filter gateway test -- pino-config.factory.spec.ts`
Expected: PASS (5 tests). If the installed `nestjs-pino` version's `Params`/`pinoHttp` typing
rejects the `transport`/`autoLogging` shape above, adjust the object shape to match the installed
version's types — the behavior (level, mixin, health-check exclusion, conditional pretty
transport) is the contract to preserve, not the exact literal shape.

- [ ] **Step 23: Write the failing `NestLoggerBridge` tests**

`back-end/gateway/src/core/logger/nest-logger.bridge.spec.ts`:
```ts
import { type AppLogger } from './app-logger';
import { NestLoggerBridge } from './nest-logger.bridge';

describe('NestLoggerBridge', () => {
  let appLogger: {
    trace: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
  let bridge: NestLoggerBridge;

  beforeEach(() => {
    appLogger = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    bridge = new NestLoggerBridge(appLogger as unknown as AppLogger);
  });

  it('should route log() to AppLogger.info()', () => {
    bridge.log('Nest application started', 'NestFactory');

    expect(appLogger.info).toHaveBeenCalledWith({ context: 'NestFactory' }, 'Nest application started');
  });

  it('should route error() to AppLogger.error(), with the stack trace and context', () => {
    bridge.error('boom', 'stack trace here', 'SomeContext');

    expect(appLogger.error).toHaveBeenCalledWith({ context: 'SomeContext', trace: 'stack trace here' }, 'boom');
  });

  it('should route warn() to AppLogger.warn()', () => {
    bridge.warn('careful', 'SomeContext');

    expect(appLogger.warn).toHaveBeenCalledWith({ context: 'SomeContext' }, 'careful');
  });

  it('should route debug() to AppLogger.debug()', () => {
    bridge.debug('debugging', 'SomeContext');

    expect(appLogger.debug).toHaveBeenCalledWith({ context: 'SomeContext' }, 'debugging');
  });

  it('should route verbose() to AppLogger.trace()', () => {
    bridge.verbose('verbose message', 'SomeContext');

    expect(appLogger.trace).toHaveBeenCalledWith({ context: 'SomeContext' }, 'verbose message');
  });

  it('should route fatal() to AppLogger.error(), with fatal: true', () => {
    bridge.fatal('fatal message', 'SomeContext');

    expect(appLogger.error).toHaveBeenCalledWith({ context: 'SomeContext', fatal: true }, 'fatal message');
  });

  it('should not throw, when setLogLevels() is called', () => {
    expect(() => bridge.setLogLevels(['log', 'error'])).not.toThrow();
  });
});
```

- [ ] **Step 24: Run the test to verify it fails**

Run: `pnpm --filter gateway test -- nest-logger.bridge.spec.ts`
Expected: FAIL with a module-not-found error for `./nest-logger.bridge`.

- [ ] **Step 25: Implement `NestLoggerBridge`**

`back-end/gateway/src/core/logger/nest-logger.bridge.ts`:
```ts
import { type LoggerService, type LogLevel } from '@nestjs/common';

import { type AppLogger } from './app-logger';

export class NestLoggerBridge implements LoggerService {
  public constructor(private readonly logger: AppLogger) {}

  public log(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.info({ context: optionalParams[0] }, String(message));
  }

  public error(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.error({ context: optionalParams[1], trace: optionalParams[0] }, String(message));
  }

  public warn(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.warn({ context: optionalParams[0] }, String(message));
  }

  public debug(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.debug({ context: optionalParams[0] }, String(message));
  }

  public verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.trace({ context: optionalParams[0] }, String(message));
  }

  public fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.error({ context: optionalParams[0], fatal: true }, String(message));
  }

  public setLogLevels(_levels: LogLevel[]): void {}
}
```

- [ ] **Step 26: Run the test to verify it passes**

Run: `pnpm --filter gateway test -- nest-logger.bridge.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 27: Create the logger module**

`back-end/gateway/src/core/logger/logger.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

import loggerConfig from '../../config/logger.config';
import { RequestContextModule } from '../request-context/request-context.module';
import { RequestContextService } from '../request-context/request-context.service';

import { LoggerService } from './logger.service';
import { pinoConfigFactory } from './pino-config.factory';

@Module({
  imports: [
    RequestContextModule,
    PinoLoggerModule.forRootAsync({
      inject: [loggerConfig.KEY, RequestContextService],
      useFactory: (config: ConfigType<typeof loggerConfig>, requestContextService: RequestContextService) =>
        pinoConfigFactory(config, requestContextService),
    }),
  ],
  providers: [LoggerService],
  exports: [LoggerService],
})
export class LoggerModule {}
```

- [ ] **Step 28: Wire `loggerConfig` and `LoggerModule` into `AppModule`**

Replace `back-end/gateway/src/app.module.ts` in full:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import appConfig from './config/app.config';
import loggerConfig from './config/logger.config';
import rabbitmqConfig from './config/rabbitmq.config';
import { ExceptionHandlingModule } from './core/exception-handling/exception-handling.module';
import { LoggerModule } from './core/logger/logger.module';
import { RequestContextModule } from './core/request-context/request-context.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [appConfig, loggerConfig, rabbitmqConfig],
    }),
    RequestContextModule,
    LoggerModule,
    ExceptionHandlingModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 29: Wire the bridge into `main.ts`**

Replace `back-end/gateway/src/main.ts` in full:
```ts
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import appConfig from './config/app.config';
import { LoggerService } from './core/logger/logger.service';
import { NestLoggerBridge } from './core/logger/nest-logger.bridge';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const loggerService = app.get(LoggerService);
  app.useLogger(new NestLoggerBridge(loggerService.getLogger('Nest', 'bootstrap')));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const { port } = appConfig();
  await app.listen(port);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

`bufferLogs: true` holds all Nest framework log calls in memory until `app.useLogger(...)` runs
immediately after, so no bootstrap log line is lost or printed through the default logger before
the bridge takes over. The top-level `bootstrap().catch(console.error)` stays as-is — it is the
last-resort handler for failures that happen before or during app creation, when no DI-backed
logger is guaranteed to exist yet.

- [ ] **Step 30: Update `.env.example`**

Replace `back-end/gateway/.env.example` in full:
```
PORT=3000

RABBITMQ_URL=amqp://guest:guest@localhost:5672
RABBITMQ_SERVICE_B_QUEUE=service_b_queue
RABBITMQ_SERVICE_A_QUEUE=service_a_queue

LOG_LEVEL=trace
APP_LOG_TRANSPORT=pretty
```

- [ ] **Step 31: Run the full gateway test suite, lint, and build**

Run: `pnpm --filter gateway test && pnpm --filter gateway lint && pnpm --filter gateway build`
Expected: all tests pass, lint exits 0, build exits 0 (this is the step that will surface any
`nestjs-pino` type mismatch flagged in Step 22 — fix any such mismatch here before proceeding).

- [ ] **Step 32: Manually verify structured logging**

Run: `pnpm --filter gateway start:dev`, then in another terminal:
```bash
curl -s http://localhost:3000/health/service-a -H "X-Correlation-ID: 11111111-1111-4111-8111-111111111111" > /dev/null
```
Expected: the gateway's terminal prints a pretty-printed (dev default) log line for the request
that includes `correlationId: "11111111-1111-4111-8111-111111111111"` and a `requestId` field.

- [ ] **Step 33: Stage the files**

```bash
git add back-end/gateway/src/config/ back-end/gateway/src/core/logger/ back-end/gateway/src/app.module.ts back-end/gateway/src/main.ts back-end/gateway/.env.example back-end/gateway/package.json
```

---

## Task 11: service-a — bare-pino logging (RMQ-only, no HTTP adapter)

**Files:**
- Create: `back-end/service-a/src/config/environment.helper.ts`
- Create: `back-end/service-a/src/config/environment.helper.spec.ts`
- Create: `back-end/service-a/src/config/logger.config.ts`
- Create: `back-end/service-a/src/config/logger.config.spec.ts`
- Create: `back-end/service-a/src/core/logger/types.ts`
- Create: `back-end/service-a/src/core/logger/pino-instance.token.ts`
- Create: `back-end/service-a/src/core/logger/pino-config.factory.ts`
- Create: `back-end/service-a/src/core/logger/pino-config.factory.spec.ts`
- Create: `back-end/service-a/src/core/logger/app-logger.ts`
- Create: `back-end/service-a/src/core/logger/app-logger.spec.ts`
- Create: `back-end/service-a/src/core/logger/logger.service.ts`
- Create: `back-end/service-a/src/core/logger/logger.service.spec.ts`
- Create: `back-end/service-a/src/core/logger/nest-logger.bridge.ts`
- Create: `back-end/service-a/src/core/logger/nest-logger.bridge.spec.ts`
- Create: `back-end/service-a/src/core/logger/logger.module.ts`
- Modify: `back-end/service-a/src/app.module.ts`
- Modify: `back-end/service-a/src/main.ts`
- Modify: `back-end/service-a/.env.example`
- Modify: `back-end/service-a/package.json`

**Interfaces:**
- Consumes: `RequestContextService.getAttributes()`, `RequestContextModule` from Task 5/6.
- Produces: the exact same `LoggerService.getLogger(source, channel?): AppLogger` /
  `NestLoggerBridge` shape as Task 10's gateway version, so call sites and later documentation read
  identically across all three services — only the construction differs (no HTTP adapter here for
  `nestjs-pino`'s `pino-http` middleware to attach to, so a bare `pino()` instance is built
  directly instead).

`environment.helper.ts`, `logger.config.ts` and their specs, and `nest-logger.bridge.ts` and its
spec are **byte-for-byte identical** to gateway's Task 10 (Steps 2–9 and 23–26) — they don't
reference any pino-specific type, only `LogChannel`/`AppLogger`. Everything else below differs
because there is no `nestjs-pino`/`pino-http` here.

- [ ] **Step 1: Install dependencies**

Run: `pnpm --filter service-a add pino pino-pretty`
Expected: both land under `dependencies` in `back-end/service-a/package.json` — no `nestjs-pino`,
no `pino-http` (there is no HTTP adapter in this service for either to attach to).

- [ ] **Step 2: Create `environment.helper.ts` and its test**

`back-end/service-a/src/config/environment.helper.spec.ts`:
```ts
import { getNodeEnv, isProduction } from './environment.helper';

describe('environment.helper', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('isProduction', () => {
    it('should return true, when NODE_ENV is "production"', () => {
      process.env.NODE_ENV = 'production';

      expect(isProduction()).toBe(true);
    });

    it('should return false, when NODE_ENV is not "production"', () => {
      process.env.NODE_ENV = 'development';

      expect(isProduction()).toBe(false);
    });
  });

  describe('getNodeEnv', () => {
    it('should return the value of NODE_ENV, when set', () => {
      process.env.NODE_ENV = 'staging';

      expect(getNodeEnv()).toBe('staging');
    });

    it('should default to "development", when NODE_ENV is not set', () => {
      delete process.env.NODE_ENV;

      expect(getNodeEnv()).toBe('development');
    });
  });
});
```

Run: `pnpm --filter service-a test -- environment.helper.spec.ts` — expect FAIL (module not found).

`back-end/service-a/src/config/environment.helper.ts`:
```ts
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function getNodeEnv(): string {
  return process.env.NODE_ENV ?? 'development';
}
```

Run: `pnpm --filter service-a test -- environment.helper.spec.ts` — expect PASS (4 tests).

- [ ] **Step 3: Create `logger.config.ts` and its test**

`back-end/service-a/src/config/logger.config.spec.ts`:
```ts
import loggerConfig from './logger.config';

describe('loggerConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should default to "trace" level, when LOG_LEVEL is unset and NODE_ENV is not "production"', () => {
      delete process.env.LOG_LEVEL;
      process.env.NODE_ENV = 'development';

      expect(loggerConfig().level).toBe('trace');
    });

    it('should default to "info" level, when LOG_LEVEL is unset and NODE_ENV is "production"', () => {
      delete process.env.LOG_LEVEL;
      process.env.NODE_ENV = 'production';

      expect(loggerConfig().level).toBe('info');
    });

    it('should default to the "json" transport, when APP_LOG_TRANSPORT is unset', () => {
      delete process.env.APP_LOG_TRANSPORT;

      expect(loggerConfig().transport).toBe('json');
    });
  });

  describe('environment overrides', () => {
    it('should use an explicit LOG_LEVEL, even in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.LOG_LEVEL = 'warn';

      expect(loggerConfig().level).toBe('warn');
    });

    it('should select the pretty transport, when APP_LOG_TRANSPORT is "pretty"', () => {
      process.env.APP_LOG_TRANSPORT = 'pretty';

      expect(loggerConfig().transport).toBe('pretty');
    });

    it('should select the json transport, when APP_LOG_TRANSPORT is any other value', () => {
      process.env.APP_LOG_TRANSPORT = 'anything-else';

      expect(loggerConfig().transport).toBe('json');
    });
  });

  describe('validation', () => {
    it('should throw, when LOG_LEVEL is not one of the documented levels', () => {
      process.env.LOG_LEVEL = 'verbose';

      expect(() => loggerConfig()).toThrow();
    });
  });
});
```

Run: `pnpm --filter service-a test -- logger.config.spec.ts` — expect FAIL (module not found).

`back-end/service-a/src/config/logger.config.ts`:
```ts
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

import { isProduction } from './environment.helper';

const loggerConfigSchema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  transport: z.enum(['json', 'pretty']).default('json'),
});

export interface LoggerConfiguration {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  transport: 'json' | 'pretty';
}

export default registerAs('logger', (): LoggerConfiguration => {
  const parsed = loggerConfigSchema.parse({
    level: process.env.LOG_LEVEL,
    transport: process.env.APP_LOG_TRANSPORT === 'pretty' ? 'pretty' : undefined,
  });

  return {
    level: parsed.level ?? (isProduction() ? 'info' : 'trace'),
    transport: parsed.transport,
  };
});
```

Run: `pnpm --filter service-a test -- logger.config.spec.ts` — expect PASS (7 tests).

- [ ] **Step 4: Create the logger types**

`back-end/service-a/src/core/logger/types.ts`:
```ts
export type LogChannel = 'rmq' | 'bootstrap';

export type LogFields = Record<string, unknown>;
```

- [ ] **Step 5: Create the pino DI token**

`back-end/service-a/src/core/logger/pino-instance.token.ts`:
```ts
export const PINO_LOGGER = Symbol('PINO_LOGGER');
```

- [ ] **Step 6: Write the failing `AppLogger` tests**

`back-end/service-a/src/core/logger/app-logger.spec.ts`:
```ts
import { type Logger } from 'pino';

import { AppLogger } from './app-logger';

describe('AppLogger', () => {
  let pinoLogger: {
    trace: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let logger: AppLogger;

  beforeEach(() => {
    pinoLogger = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    logger = new AppLogger(pinoLogger as unknown as Logger, 'HealthController', 'rmq');
  });

  it('should forward info() to the underlying pino logger with source and channel bound', () => {
    logger.info({ pattern: 'health.check' }, 'message handled');

    expect(pinoLogger.info).toHaveBeenCalledWith(
      { pattern: 'health.check', source: 'HealthController', channel: 'rmq' },
      'message handled',
    );
  });

  it('should forward trace()', () => {
    logger.trace({}, 'trace message');

    expect(pinoLogger.trace).toHaveBeenCalledWith({ source: 'HealthController', channel: 'rmq' }, 'trace message');
  });

  it('should forward debug()', () => {
    logger.debug({}, 'debug message');

    expect(pinoLogger.debug).toHaveBeenCalledWith({ source: 'HealthController', channel: 'rmq' }, 'debug message');
  });

  it('should forward warn()', () => {
    logger.warn({}, 'warn message');

    expect(pinoLogger.warn).toHaveBeenCalledWith({ source: 'HealthController', channel: 'rmq' }, 'warn message');
  });

  it('should forward error()', () => {
    logger.error({}, 'error message');

    expect(pinoLogger.error).toHaveBeenCalledWith({ source: 'HealthController', channel: 'rmq' }, 'error message');
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- app-logger.spec.ts`
Expected: FAIL with a module-not-found error for `./app-logger`.

- [ ] **Step 8: Implement `AppLogger`**

`back-end/service-a/src/core/logger/app-logger.ts`:
```ts
import { type Logger } from 'pino';

import { type LogChannel, type LogFields } from './types';

export class AppLogger {
  public constructor(
    private readonly pinoLogger: Logger,
    private readonly source: string,
    private readonly channel: LogChannel,
  ) {}

  public trace(fields: LogFields, message: string): void {
    this.pinoLogger.trace({ ...fields, source: this.source, channel: this.channel }, message);
  }

  public debug(fields: LogFields, message: string): void {
    this.pinoLogger.debug({ ...fields, source: this.source, channel: this.channel }, message);
  }

  public info(fields: LogFields, message: string): void {
    this.pinoLogger.info({ ...fields, source: this.source, channel: this.channel }, message);
  }

  public warn(fields: LogFields, message: string): void {
    this.pinoLogger.warn({ ...fields, source: this.source, channel: this.channel }, message);
  }

  public error(fields: LogFields, message: string): void {
    this.pinoLogger.error({ ...fields, source: this.source, channel: this.channel }, message);
  }
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- app-logger.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 10: Write the failing `pinoConfigFactory` tests**

`back-end/service-a/src/core/logger/pino-config.factory.spec.ts`:
```ts
import { RequestContextService } from '../request-context/request-context.service';

import { pinoConfigFactory } from './pino-config.factory';

describe('pinoConfigFactory', () => {
  let requestContextService: RequestContextService;

  beforeEach(() => {
    requestContextService = new RequestContextService();
  });

  it('should set the level from config', () => {
    const options = pinoConfigFactory({ level: 'warn', transport: 'json' }, requestContextService);

    expect(options.level).toBe('warn');
  });

  it('should omit the transport option, when config.transport is "json"', () => {
    const options = pinoConfigFactory({ level: 'info', transport: 'json' }, requestContextService);

    expect(options.transport).toBeUndefined();
  });

  it('should configure pino-pretty, when config.transport is "pretty"', () => {
    const options = pinoConfigFactory({ level: 'info', transport: 'pretty' }, requestContextService);

    expect(options.transport).toEqual({ target: 'pino-pretty', options: { colorize: true, singleLine: true } });
  });

  it('should mix in the active request context attributes into every log line', () => {
    const options = pinoConfigFactory({ level: 'info', transport: 'json' }, requestContextService);
    const mixin = options.mixin as () => unknown;

    const result = requestContextService.run({ correlationId: 'c-1', requestId: 'r-1' }, () => mixin());

    expect(result).toEqual({ correlationId: 'c-1', requestId: 'r-1' });
  });
});
```

- [ ] **Step 11: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- pino-config.factory.spec.ts`
Expected: FAIL with a module-not-found error for `./pino-config.factory`.

- [ ] **Step 12: Implement `pinoConfigFactory`**

`back-end/service-a/src/core/logger/pino-config.factory.ts`:
```ts
import { type LoggerOptions } from 'pino';

import { type LoggerConfiguration } from '../../config/logger.config';
import { type RequestContextService } from '../request-context/request-context.service';

export function pinoConfigFactory(
  config: LoggerConfiguration,
  requestContextService: RequestContextService,
): LoggerOptions {
  return {
    level: config.level,
    mixin: () => requestContextService.getAttributes(),
    transport:
      config.transport === 'pretty'
        ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
        : undefined,
  };
}
```

There is no `autoLogging`/health-check exclusion here (unlike gateway's Task 10) because there is
no `pino-http` auto-request-logging in play — every log line in this service comes from an
explicit `AppLogger` call, so there is nothing to auto-log or exclude.

- [ ] **Step 13: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- pino-config.factory.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 14: Create `nest-logger.bridge.ts` and its test**

`back-end/service-a/src/core/logger/nest-logger.bridge.spec.ts`:
```ts
import { type AppLogger } from './app-logger';
import { NestLoggerBridge } from './nest-logger.bridge';

describe('NestLoggerBridge', () => {
  let appLogger: {
    trace: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
  let bridge: NestLoggerBridge;

  beforeEach(() => {
    appLogger = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    bridge = new NestLoggerBridge(appLogger as unknown as AppLogger);
  });

  it('should route log() to AppLogger.info()', () => {
    bridge.log('Nest application started', 'NestFactory');

    expect(appLogger.info).toHaveBeenCalledWith({ context: 'NestFactory' }, 'Nest application started');
  });

  it('should route error() to AppLogger.error(), with the stack trace and context', () => {
    bridge.error('boom', 'stack trace here', 'SomeContext');

    expect(appLogger.error).toHaveBeenCalledWith({ context: 'SomeContext', trace: 'stack trace here' }, 'boom');
  });

  it('should route warn() to AppLogger.warn()', () => {
    bridge.warn('careful', 'SomeContext');

    expect(appLogger.warn).toHaveBeenCalledWith({ context: 'SomeContext' }, 'careful');
  });

  it('should route debug() to AppLogger.debug()', () => {
    bridge.debug('debugging', 'SomeContext');

    expect(appLogger.debug).toHaveBeenCalledWith({ context: 'SomeContext' }, 'debugging');
  });

  it('should route verbose() to AppLogger.trace()', () => {
    bridge.verbose('verbose message', 'SomeContext');

    expect(appLogger.trace).toHaveBeenCalledWith({ context: 'SomeContext' }, 'verbose message');
  });

  it('should route fatal() to AppLogger.error(), with fatal: true', () => {
    bridge.fatal('fatal message', 'SomeContext');

    expect(appLogger.error).toHaveBeenCalledWith({ context: 'SomeContext', fatal: true }, 'fatal message');
  });

  it('should not throw, when setLogLevels() is called', () => {
    expect(() => bridge.setLogLevels(['log', 'error'])).not.toThrow();
  });
});
```

Run: `pnpm --filter service-a test -- nest-logger.bridge.spec.ts` — expect FAIL (module not found).

`back-end/service-a/src/core/logger/nest-logger.bridge.ts`:
```ts
import { type LoggerService, type LogLevel } from '@nestjs/common';

import { type AppLogger } from './app-logger';

export class NestLoggerBridge implements LoggerService {
  public constructor(private readonly logger: AppLogger) {}

  public log(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.info({ context: optionalParams[0] }, String(message));
  }

  public error(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.error({ context: optionalParams[1], trace: optionalParams[0] }, String(message));
  }

  public warn(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.warn({ context: optionalParams[0] }, String(message));
  }

  public debug(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.debug({ context: optionalParams[0] }, String(message));
  }

  public verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.trace({ context: optionalParams[0] }, String(message));
  }

  public fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.error({ context: optionalParams[0], fatal: true }, String(message));
  }

  public setLogLevels(_levels: LogLevel[]): void {}
}
```

Run: `pnpm --filter service-a test -- nest-logger.bridge.spec.ts` — expect PASS (7 tests).

- [ ] **Step 15: Write the failing `LoggerService` tests**

`back-end/service-a/src/core/logger/logger.service.spec.ts`:
```ts
import { type Logger } from 'pino';

import { AppLogger } from './app-logger';
import { LoggerService } from './logger.service';

describe('LoggerService', () => {
  it('should return an AppLogger bound to the given source and default "rmq" channel', () => {
    const pinoLogger = {} as Logger;
    const service = new LoggerService(pinoLogger);

    const logger = service.getLogger('HealthController');

    expect(logger).toBeInstanceOf(AppLogger);
  });

  it('should bind the given channel, when explicitly provided', () => {
    const pinoLogger = { info: vi.fn() } as unknown as Logger;
    const service = new LoggerService(pinoLogger);

    const logger = service.getLogger('Nest', 'bootstrap');
    logger.info({}, 'starting up');

    expect(pinoLogger.info).toHaveBeenCalledWith({ source: 'Nest', channel: 'bootstrap' }, 'starting up');
  });
});
```

- [ ] **Step 16: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- logger.service.spec.ts`
Expected: FAIL with a module-not-found error for `./logger.service`.

- [ ] **Step 17: Implement `LoggerService`**

`back-end/service-a/src/core/logger/logger.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { type Logger } from 'pino';

import { AppLogger } from './app-logger';
import { PINO_LOGGER } from './pino-instance.token';
import { type LogChannel } from './types';

@Injectable()
export class LoggerService {
  public constructor(@Inject(PINO_LOGGER) private readonly pinoLogger: Logger) {}

  public getLogger(source: string, channel: LogChannel = 'rmq'): AppLogger {
    return new AppLogger(this.pinoLogger, source, channel);
  }
}
```

- [ ] **Step 18: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- logger.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 19: Create the logger module**

`back-end/service-a/src/core/logger/logger.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import pino from 'pino';

import loggerConfig from '../../config/logger.config';
import { RequestContextModule } from '../request-context/request-context.module';
import { RequestContextService } from '../request-context/request-context.service';

import { LoggerService } from './logger.service';
import { pinoConfigFactory } from './pino-config.factory';
import { PINO_LOGGER } from './pino-instance.token';

@Module({
  imports: [RequestContextModule],
  providers: [
    {
      provide: PINO_LOGGER,
      inject: [loggerConfig.KEY, RequestContextService],
      useFactory: (config: ConfigType<typeof loggerConfig>, requestContextService: RequestContextService) =>
        pino(pinoConfigFactory(config, requestContextService)),
    },
    LoggerService,
  ],
  exports: [LoggerService],
})
export class LoggerModule {}
```

- [ ] **Step 20: Wire `loggerConfig` and `LoggerModule` into `AppModule`**

Replace `back-end/service-a/src/app.module.ts` in full:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import loggerConfig from './config/logger.config';
import rabbitmqConfig from './config/rabbitmq.config';
import { ExceptionHandlingModule } from './core/exception-handling/exception-handling.module';
import { LoggerModule } from './core/logger/logger.module';
import { RequestContextModule } from './core/request-context/request-context.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [loggerConfig, rabbitmqConfig] }),
    RequestContextModule,
    LoggerModule,
    ExceptionHandlingModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 21: Wire the bridge into `main.ts`**

Replace `back-end/service-a/src/main.ts` in full:
```ts
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';

import { AppModule } from './app.module';
import rabbitmqConfig from './config/rabbitmq.config';
import { LoggerService } from './core/logger/logger.service';
import { NestLoggerBridge } from './core/logger/nest-logger.bridge';

async function bootstrap(): Promise<void> {
  const { url, queue } = rabbitmqConfig();

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.RMQ,
    options: {
      urls: [url],
      queue,
      queueOptions: { durable: true },
    },
    bufferLogs: true,
  });

  const loggerService = app.get(LoggerService);
  app.useLogger(new NestLoggerBridge(loggerService.getLogger('Nest', 'bootstrap')));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen();
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 22: Update `.env.example`**

Replace `back-end/service-a/.env.example` in full:
```
RABBITMQ_URL=amqp://guest:guest@localhost:5672
RABBITMQ_QUEUE=service_a_queue
RABBITMQ_SERVICE_B_QUEUE=service_b_queue
RABBITMQ_PING_TIMEOUT_MS=3000

LOG_LEVEL=trace
APP_LOG_TRANSPORT=pretty
```

- [ ] **Step 23: Run the full service-a test suite, lint, and build**

Run: `pnpm --filter service-a test && pnpm --filter service-a lint && pnpm --filter service-a build`
Expected: all tests pass, lint exits 0, build exits 0.

- [ ] **Step 24: Stage the files**

```bash
git add back-end/service-a/src/config/ back-end/service-a/src/core/logger/ back-end/service-a/src/app.module.ts back-end/service-a/src/main.ts back-end/service-a/.env.example back-end/service-a/package.json
```

---

## Task 12: service-b — bare-pino logging (RMQ-only, no HTTP adapter)

**Files:**
- Create: `back-end/service-b/src/config/environment.helper.ts`
- Create: `back-end/service-b/src/config/environment.helper.spec.ts`
- Create: `back-end/service-b/src/config/logger.config.ts`
- Create: `back-end/service-b/src/config/logger.config.spec.ts`
- Create: `back-end/service-b/src/core/logger/types.ts`
- Create: `back-end/service-b/src/core/logger/pino-instance.token.ts`
- Create: `back-end/service-b/src/core/logger/pino-config.factory.ts`
- Create: `back-end/service-b/src/core/logger/pino-config.factory.spec.ts`
- Create: `back-end/service-b/src/core/logger/app-logger.ts`
- Create: `back-end/service-b/src/core/logger/app-logger.spec.ts`
- Create: `back-end/service-b/src/core/logger/logger.service.ts`
- Create: `back-end/service-b/src/core/logger/logger.service.spec.ts`
- Create: `back-end/service-b/src/core/logger/nest-logger.bridge.ts`
- Create: `back-end/service-b/src/core/logger/nest-logger.bridge.spec.ts`
- Create: `back-end/service-b/src/core/logger/logger.module.ts`
- Modify: `back-end/service-b/src/app.module.ts`
- Modify: `back-end/service-b/src/main.ts`
- Modify: `back-end/service-b/.env.example`
- Modify: `back-end/service-b/package.json`

**Interfaces:**
- Consumes: `RequestContextService.getAttributes()`, `RequestContextModule` from Task 7/8.
- Produces: the same `LoggerService.getLogger(source, channel?): AppLogger` / `NestLoggerBridge`
  shape as Task 10 (gateway) and Task 11 (service-a).

- [ ] **Step 1: Install dependencies**

Run: `pnpm --filter service-b add pino pino-pretty`
Expected: both land under `dependencies` in `back-end/service-b/package.json`.

- [ ] **Step 2: Create `environment.helper.ts` and its test**

`back-end/service-b/src/config/environment.helper.spec.ts`:
```ts
import { getNodeEnv, isProduction } from './environment.helper';

describe('environment.helper', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('isProduction', () => {
    it('should return true, when NODE_ENV is "production"', () => {
      process.env.NODE_ENV = 'production';

      expect(isProduction()).toBe(true);
    });

    it('should return false, when NODE_ENV is not "production"', () => {
      process.env.NODE_ENV = 'development';

      expect(isProduction()).toBe(false);
    });
  });

  describe('getNodeEnv', () => {
    it('should return the value of NODE_ENV, when set', () => {
      process.env.NODE_ENV = 'staging';

      expect(getNodeEnv()).toBe('staging');
    });

    it('should default to "development", when NODE_ENV is not set', () => {
      delete process.env.NODE_ENV;

      expect(getNodeEnv()).toBe('development');
    });
  });
});
```

Run: `pnpm --filter service-b test -- environment.helper.spec.ts` — expect FAIL (module not found).

`back-end/service-b/src/config/environment.helper.ts`:
```ts
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function getNodeEnv(): string {
  return process.env.NODE_ENV ?? 'development';
}
```

Run: `pnpm --filter service-b test -- environment.helper.spec.ts` — expect PASS (4 tests).

- [ ] **Step 3: Create `logger.config.ts` and its test**

`back-end/service-b/src/config/logger.config.spec.ts`:
```ts
import loggerConfig from './logger.config';

describe('loggerConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should default to "trace" level, when LOG_LEVEL is unset and NODE_ENV is not "production"', () => {
      delete process.env.LOG_LEVEL;
      process.env.NODE_ENV = 'development';

      expect(loggerConfig().level).toBe('trace');
    });

    it('should default to "info" level, when LOG_LEVEL is unset and NODE_ENV is "production"', () => {
      delete process.env.LOG_LEVEL;
      process.env.NODE_ENV = 'production';

      expect(loggerConfig().level).toBe('info');
    });

    it('should default to the "json" transport, when APP_LOG_TRANSPORT is unset', () => {
      delete process.env.APP_LOG_TRANSPORT;

      expect(loggerConfig().transport).toBe('json');
    });
  });

  describe('environment overrides', () => {
    it('should use an explicit LOG_LEVEL, even in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.LOG_LEVEL = 'warn';

      expect(loggerConfig().level).toBe('warn');
    });

    it('should select the pretty transport, when APP_LOG_TRANSPORT is "pretty"', () => {
      process.env.APP_LOG_TRANSPORT = 'pretty';

      expect(loggerConfig().transport).toBe('pretty');
    });

    it('should select the json transport, when APP_LOG_TRANSPORT is any other value', () => {
      process.env.APP_LOG_TRANSPORT = 'anything-else';

      expect(loggerConfig().transport).toBe('json');
    });
  });

  describe('validation', () => {
    it('should throw, when LOG_LEVEL is not one of the documented levels', () => {
      process.env.LOG_LEVEL = 'verbose';

      expect(() => loggerConfig()).toThrow();
    });
  });
});
```

Run: `pnpm --filter service-b test -- logger.config.spec.ts` — expect FAIL (module not found).

`back-end/service-b/src/config/logger.config.ts`:
```ts
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

import { isProduction } from './environment.helper';

const loggerConfigSchema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  transport: z.enum(['json', 'pretty']).default('json'),
});

export interface LoggerConfiguration {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  transport: 'json' | 'pretty';
}

export default registerAs('logger', (): LoggerConfiguration => {
  const parsed = loggerConfigSchema.parse({
    level: process.env.LOG_LEVEL,
    transport: process.env.APP_LOG_TRANSPORT === 'pretty' ? 'pretty' : undefined,
  });

  return {
    level: parsed.level ?? (isProduction() ? 'info' : 'trace'),
    transport: parsed.transport,
  };
});
```

Run: `pnpm --filter service-b test -- logger.config.spec.ts` — expect PASS (7 tests).

- [ ] **Step 4: Create the logger types**

`back-end/service-b/src/core/logger/types.ts`:
```ts
export type LogChannel = 'rmq' | 'bootstrap';

export type LogFields = Record<string, unknown>;
```

- [ ] **Step 5: Create the pino DI token**

`back-end/service-b/src/core/logger/pino-instance.token.ts`:
```ts
export const PINO_LOGGER = Symbol('PINO_LOGGER');
```

- [ ] **Step 6: Write the failing `AppLogger` tests**

`back-end/service-b/src/core/logger/app-logger.spec.ts`:
```ts
import { type Logger } from 'pino';

import { AppLogger } from './app-logger';

describe('AppLogger', () => {
  let pinoLogger: {
    trace: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let logger: AppLogger;

  beforeEach(() => {
    pinoLogger = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    logger = new AppLogger(pinoLogger as unknown as Logger, 'HealthController', 'rmq');
  });

  it('should forward info() to the underlying pino logger with source and channel bound', () => {
    logger.info({ pattern: 'health.check' }, 'message handled');

    expect(pinoLogger.info).toHaveBeenCalledWith(
      { pattern: 'health.check', source: 'HealthController', channel: 'rmq' },
      'message handled',
    );
  });

  it('should forward trace()', () => {
    logger.trace({}, 'trace message');

    expect(pinoLogger.trace).toHaveBeenCalledWith({ source: 'HealthController', channel: 'rmq' }, 'trace message');
  });

  it('should forward debug()', () => {
    logger.debug({}, 'debug message');

    expect(pinoLogger.debug).toHaveBeenCalledWith({ source: 'HealthController', channel: 'rmq' }, 'debug message');
  });

  it('should forward warn()', () => {
    logger.warn({}, 'warn message');

    expect(pinoLogger.warn).toHaveBeenCalledWith({ source: 'HealthController', channel: 'rmq' }, 'warn message');
  });

  it('should forward error()', () => {
    logger.error({}, 'error message');

    expect(pinoLogger.error).toHaveBeenCalledWith({ source: 'HealthController', channel: 'rmq' }, 'error message');
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- app-logger.spec.ts`
Expected: FAIL with a module-not-found error for `./app-logger`.

- [ ] **Step 8: Implement `AppLogger`**

`back-end/service-b/src/core/logger/app-logger.ts`:
```ts
import { type Logger } from 'pino';

import { type LogChannel, type LogFields } from './types';

export class AppLogger {
  public constructor(
    private readonly pinoLogger: Logger,
    private readonly source: string,
    private readonly channel: LogChannel,
  ) {}

  public trace(fields: LogFields, message: string): void {
    this.pinoLogger.trace({ ...fields, source: this.source, channel: this.channel }, message);
  }

  public debug(fields: LogFields, message: string): void {
    this.pinoLogger.debug({ ...fields, source: this.source, channel: this.channel }, message);
  }

  public info(fields: LogFields, message: string): void {
    this.pinoLogger.info({ ...fields, source: this.source, channel: this.channel }, message);
  }

  public warn(fields: LogFields, message: string): void {
    this.pinoLogger.warn({ ...fields, source: this.source, channel: this.channel }, message);
  }

  public error(fields: LogFields, message: string): void {
    this.pinoLogger.error({ ...fields, source: this.source, channel: this.channel }, message);
  }
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- app-logger.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 10: Write the failing `pinoConfigFactory` tests**

`back-end/service-b/src/core/logger/pino-config.factory.spec.ts`:
```ts
import { RequestContextService } from '../request-context/request-context.service';

import { pinoConfigFactory } from './pino-config.factory';

describe('pinoConfigFactory', () => {
  let requestContextService: RequestContextService;

  beforeEach(() => {
    requestContextService = new RequestContextService();
  });

  it('should set the level from config', () => {
    const options = pinoConfigFactory({ level: 'warn', transport: 'json' }, requestContextService);

    expect(options.level).toBe('warn');
  });

  it('should omit the transport option, when config.transport is "json"', () => {
    const options = pinoConfigFactory({ level: 'info', transport: 'json' }, requestContextService);

    expect(options.transport).toBeUndefined();
  });

  it('should configure pino-pretty, when config.transport is "pretty"', () => {
    const options = pinoConfigFactory({ level: 'info', transport: 'pretty' }, requestContextService);

    expect(options.transport).toEqual({ target: 'pino-pretty', options: { colorize: true, singleLine: true } });
  });

  it('should mix in the active request context attributes into every log line', () => {
    const options = pinoConfigFactory({ level: 'info', transport: 'json' }, requestContextService);
    const mixin = options.mixin as () => unknown;

    const result = requestContextService.run({ correlationId: 'c-1', requestId: 'r-1' }, () => mixin());

    expect(result).toEqual({ correlationId: 'c-1', requestId: 'r-1' });
  });
});
```

- [ ] **Step 11: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- pino-config.factory.spec.ts`
Expected: FAIL with a module-not-found error for `./pino-config.factory`.

- [ ] **Step 12: Implement `pinoConfigFactory`**

`back-end/service-b/src/core/logger/pino-config.factory.ts`:
```ts
import { type LoggerOptions } from 'pino';

import { type LoggerConfiguration } from '../../config/logger.config';
import { type RequestContextService } from '../request-context/request-context.service';

export function pinoConfigFactory(
  config: LoggerConfiguration,
  requestContextService: RequestContextService,
): LoggerOptions {
  return {
    level: config.level,
    mixin: () => requestContextService.getAttributes(),
    transport:
      config.transport === 'pretty'
        ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
        : undefined,
  };
}
```

- [ ] **Step 13: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- pino-config.factory.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 14: Write the failing `NestLoggerBridge` tests**

`back-end/service-b/src/core/logger/nest-logger.bridge.spec.ts`:
```ts
import { type AppLogger } from './app-logger';
import { NestLoggerBridge } from './nest-logger.bridge';

describe('NestLoggerBridge', () => {
  let appLogger: {
    trace: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
  let bridge: NestLoggerBridge;

  beforeEach(() => {
    appLogger = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    bridge = new NestLoggerBridge(appLogger as unknown as AppLogger);
  });

  it('should route log() to AppLogger.info()', () => {
    bridge.log('Nest application started', 'NestFactory');

    expect(appLogger.info).toHaveBeenCalledWith({ context: 'NestFactory' }, 'Nest application started');
  });

  it('should route error() to AppLogger.error(), with the stack trace and context', () => {
    bridge.error('boom', 'stack trace here', 'SomeContext');

    expect(appLogger.error).toHaveBeenCalledWith({ context: 'SomeContext', trace: 'stack trace here' }, 'boom');
  });

  it('should route warn() to AppLogger.warn()', () => {
    bridge.warn('careful', 'SomeContext');

    expect(appLogger.warn).toHaveBeenCalledWith({ context: 'SomeContext' }, 'careful');
  });

  it('should route debug() to AppLogger.debug()', () => {
    bridge.debug('debugging', 'SomeContext');

    expect(appLogger.debug).toHaveBeenCalledWith({ context: 'SomeContext' }, 'debugging');
  });

  it('should route verbose() to AppLogger.trace()', () => {
    bridge.verbose('verbose message', 'SomeContext');

    expect(appLogger.trace).toHaveBeenCalledWith({ context: 'SomeContext' }, 'verbose message');
  });

  it('should route fatal() to AppLogger.error(), with fatal: true', () => {
    bridge.fatal('fatal message', 'SomeContext');

    expect(appLogger.error).toHaveBeenCalledWith({ context: 'SomeContext', fatal: true }, 'fatal message');
  });

  it('should not throw, when setLogLevels() is called', () => {
    expect(() => bridge.setLogLevels(['log', 'error'])).not.toThrow();
  });
});
```

- [ ] **Step 15: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- nest-logger.bridge.spec.ts`
Expected: FAIL with a module-not-found error for `./nest-logger.bridge`.

- [ ] **Step 16: Implement `NestLoggerBridge`**

`back-end/service-b/src/core/logger/nest-logger.bridge.ts`:
```ts
import { type LoggerService, type LogLevel } from '@nestjs/common';

import { type AppLogger } from './app-logger';

export class NestLoggerBridge implements LoggerService {
  public constructor(private readonly logger: AppLogger) {}

  public log(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.info({ context: optionalParams[0] }, String(message));
  }

  public error(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.error({ context: optionalParams[1], trace: optionalParams[0] }, String(message));
  }

  public warn(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.warn({ context: optionalParams[0] }, String(message));
  }

  public debug(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.debug({ context: optionalParams[0] }, String(message));
  }

  public verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.trace({ context: optionalParams[0] }, String(message));
  }

  public fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.error({ context: optionalParams[0], fatal: true }, String(message));
  }

  public setLogLevels(_levels: LogLevel[]): void {}
}
```

- [ ] **Step 17: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- nest-logger.bridge.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 18: Write the failing `LoggerService` tests**

`back-end/service-b/src/core/logger/logger.service.spec.ts`:
```ts
import { type Logger } from 'pino';

import { AppLogger } from './app-logger';
import { LoggerService } from './logger.service';

describe('LoggerService', () => {
  it('should return an AppLogger bound to the given source and default "rmq" channel', () => {
    const pinoLogger = {} as Logger;
    const service = new LoggerService(pinoLogger);

    const logger = service.getLogger('HealthController');

    expect(logger).toBeInstanceOf(AppLogger);
  });

  it('should bind the given channel, when explicitly provided', () => {
    const pinoLogger = { info: vi.fn() } as unknown as Logger;
    const service = new LoggerService(pinoLogger);

    const logger = service.getLogger('Nest', 'bootstrap');
    logger.info({}, 'starting up');

    expect(pinoLogger.info).toHaveBeenCalledWith({ source: 'Nest', channel: 'bootstrap' }, 'starting up');
  });
});
```

- [ ] **Step 19: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- logger.service.spec.ts`
Expected: FAIL with a module-not-found error for `./logger.service`.

- [ ] **Step 20: Implement `LoggerService`**

`back-end/service-b/src/core/logger/logger.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { type Logger } from 'pino';

import { AppLogger } from './app-logger';
import { PINO_LOGGER } from './pino-instance.token';
import { type LogChannel } from './types';

@Injectable()
export class LoggerService {
  public constructor(@Inject(PINO_LOGGER) private readonly pinoLogger: Logger) {}

  public getLogger(source: string, channel: LogChannel = 'rmq'): AppLogger {
    return new AppLogger(this.pinoLogger, source, channel);
  }
}
```

- [ ] **Step 21: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- logger.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 22: Create the logger module**

`back-end/service-b/src/core/logger/logger.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import pino from 'pino';

import loggerConfig from '../../config/logger.config';
import { RequestContextModule } from '../request-context/request-context.module';
import { RequestContextService } from '../request-context/request-context.service';

import { LoggerService } from './logger.service';
import { pinoConfigFactory } from './pino-config.factory';
import { PINO_LOGGER } from './pino-instance.token';

@Module({
  imports: [RequestContextModule],
  providers: [
    {
      provide: PINO_LOGGER,
      inject: [loggerConfig.KEY, RequestContextService],
      useFactory: (config: ConfigType<typeof loggerConfig>, requestContextService: RequestContextService) =>
        pino(pinoConfigFactory(config, requestContextService)),
    },
    LoggerService,
  ],
  exports: [LoggerService],
})
export class LoggerModule {}
```

- [ ] **Step 23: Wire `loggerConfig` and `LoggerModule` into `AppModule`**

Replace `back-end/service-b/src/app.module.ts` in full:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import loggerConfig from './config/logger.config';
import rabbitmqConfig from './config/rabbitmq.config';
import { ExceptionHandlingModule } from './core/exception-handling/exception-handling.module';
import { LoggerModule } from './core/logger/logger.module';
import { RequestContextModule } from './core/request-context/request-context.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [loggerConfig, rabbitmqConfig] }),
    RequestContextModule,
    LoggerModule,
    ExceptionHandlingModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 24: Wire the bridge into `main.ts`**

Replace `back-end/service-b/src/main.ts` in full:
```ts
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';

import { AppModule } from './app.module';
import rabbitmqConfig from './config/rabbitmq.config';
import { LoggerService } from './core/logger/logger.service';
import { NestLoggerBridge } from './core/logger/nest-logger.bridge';

async function bootstrap(): Promise<void> {
  const { url, queue } = rabbitmqConfig();

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.RMQ,
    options: {
      urls: [url],
      queue,
      queueOptions: { durable: true },
    },
    bufferLogs: true,
  });

  const loggerService = app.get(LoggerService);
  app.useLogger(new NestLoggerBridge(loggerService.getLogger('Nest', 'bootstrap')));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen();
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 25: Update `.env.example`**

Replace `back-end/service-b/.env.example` in full:
```
RABBITMQ_URL=amqp://guest:guest@localhost:5672
RABBITMQ_QUEUE=service_b_queue

LOG_LEVEL=trace
APP_LOG_TRANSPORT=pretty
```

- [ ] **Step 26: Run the full service-b test suite, lint, and build**

Run: `pnpm --filter service-b test && pnpm --filter service-b lint && pnpm --filter service-b build`
Expected: all tests pass, lint exits 0, build exits 0.

- [ ] **Step 27: Stage the files**

```bash
git add back-end/service-b/src/config/ back-end/service-b/src/core/logger/ back-end/service-b/src/app.module.ts back-end/service-b/src/main.ts back-end/service-b/.env.example back-end/service-b/package.json
```

---

## Task 13: Documentation — README

**Files:**
- Modify: `README.md` (repo root)

**Interfaces:** none (documentation only).

The root `README.md` currently describes a stale architecture (TCP transport, Prisma +
PostgreSQL, `service-b` as a "Users domain microservice", a `pnpm docker:up` comment that only
mentions starting PostgreSQL) that predates the RabbitMQ/health-check rewrite already in the
codebase (`docker-compose.yml`, `back-end/*/src/main.ts` — verified: RMQ transport, no Prisma
anywhere, `docker:up` runs `docker compose up -d` which starts the whole stack). Adding a
correlation-ID section on top of that stale description would be incoherent, so this task corrects
the architecture section to match what's actually in the repository *before* adding the new
section — this is fixing already-wrong documentation, not unrelated refactoring.

- [ ] **Step 1: Replace `README.md` in full**

```markdown
# task1

pnpm workspace monorepo: an Angular front-end and NestJS microservices back-end.

```
task1/
├── front-end/              Angular app (talks only to the gateway's REST API)
└── back-end/
    ├── gateway/             Public HTTP entrypoint - REST API, forwards to microservices over RabbitMQ
    ├── service-a/           Internal microservice (RabbitMQ transport only, no HTTP)
    └── service-b/           Internal microservice (RabbitMQ transport only, no HTTP)
```

## Architecture

The gateway is the only HTTP surface. It receives REST requests, validates them, and forwards to
the internal microservices over NestJS's RabbitMQ transport using `ClientProxy` /
`@MessagePattern`. `service-a` and `service-b` expose no HTTP at all — they're reachable only as
RabbitMQ consumers.

```
Angular (front-end)
      │  HTTP (REST)
      ▼
   gateway  ──RabbitMQ RPC──▶  service-a  ──RabbitMQ RPC──▶  service-b
```

Every request through this chain carries a `correlationId` (stable for the whole flow) and a
`requestId` (fresh per hop) — see "Correlation ID & Request ID" below.

## Getting started

```bash
pnpm install

# start RabbitMQ + service-a + service-b + gateway + front-end
pnpm docker:up

# or run services individually against a local RabbitMQ:
cp back-end/gateway/.env.example back-end/gateway/.env
cp back-end/service-a/.env.example back-end/service-a/.env
cp back-end/service-b/.env.example back-end/service-b/.env

pnpm dev:service-b
pnpm dev:service-a
pnpm dev:gateway
pnpm dev:front-end
```

- Front-end: http://localhost:4200
- Gateway REST API: http://localhost:3000 (health checks at `/health/service-a`, `/health/service-b`)
- RabbitMQ management UI: http://localhost:15672 (guest/guest)
- `service-a`/`service-b`: internal only, reachable over RabbitMQ (not exposed to the browser)

## Common tasks

| Command | What it does |
| --- | --- |
| `pnpm build` | Build every workspace package |
| `pnpm test` | Run every package's tests (Vitest for all three back-end services) |
| `pnpm lint` | Lint the back-end services (ESLint) |
| `pnpm format` / `pnpm format:check` | Prettier across the whole workspace |
| `pnpm check` | `lint` + `test` - also runs automatically on `git push` (Husky) |
| `pnpm docker:up` / `pnpm docker:down` | Start/stop RabbitMQ and all three back-end services + front-end |

## Tooling notes

- **Package manager**: pnpm workspaces (`pnpm-workspace.yaml`: `front-end`, `back-end/*`).
- **Testing**: Vitest for all three NestJS services (`*.spec.ts` unit tests, `*.int.spec.ts`
  HTTP-integration tests for the gateway via `supertest`).
- **Prettier**: one shared config at the repo root (`.prettierrc.mjs`), applies to every package.
- **ESLint**: `back-end/gateway`, `back-end/service-a`, and `back-end/service-b` each have their
  own `eslint.config.mjs` (typescript-eslint + import ordering + security/sonarjs/unicorn rules),
  pointed at each app's own `tsconfig.json`. `front-end` doesn't use this config - it's
  Node/NestJS-specific tooling; add `@angular-eslint` separately if you want linting there.
- **Git hooks**: Husky runs `pnpm check` (lint + test) on `git push`, not on every commit -
  `.husky/pre-push`. Hooks install automatically the first time you run `pnpm install` (the root
  `prepare` script).
- **No persistence layer yet** - all three back-end services are stateless; a database will be
  added back once a concrete need is decided (see `CLAUDE.md`).

## Correlation ID & Request ID

Every request that flows through `gateway → service-a → service-b` carries two identifiers:

- **`correlationId`** identifies the entire logical request/business flow. It is generated once,
  at the point the flow enters the system (the gateway's HTTP layer), and stays **identical**
  across every service that participates in handling that request.
- **`requestId`** identifies one specific hop — one service-to-service call. Every outbound call
  (gateway→service-a, service-a→service-b) mints a **fresh** `requestId`, so a single
  `correlationId` is associated with several different `requestId`s, one per hop.

```
                         correlationId = C1
                                |
                                v
Client ────────> Gateway ─────> service-a ─────> service-b
  X-Correlation-ID: C1
  X-Request-ID: R1          R1              R2                R3
                             |               |                 |
                             +---------------+-----------------+
                                    same correlationId, C1
                            each hop mints its own fresh requestId
```

**Generation.** If the client sends `X-Correlation-ID` / `X-Request-ID` HTTP headers to the
gateway, their values are reused (after validation — see below); otherwise the gateway generates a
UUID v4 for each via Node's built-in `crypto.randomUUID()`. Every outbound RabbitMQ call generates
a brand-new `requestId` the same way, regardless of what the current service's own `requestId` is.

**Validation.** Any incoming ID (HTTP header or RabbitMQ message header) is trimmed, and rejected
(silently replaced with a freshly generated UUID v4) if it's empty, over 200 characters, or
contains anything other than printable ASCII — this blocks header/log injection via a spoofed ID
without requiring every caller's correlation ID to itself be a UUID.

**Propagation.** IDs travel only as transport-level metadata, never inside a business
payload/DTO: HTTP request/response headers (`X-Correlation-ID`, `X-Request-ID`) between the client
and the gateway, and RabbitMQ message headers (via `RmqRecordBuilder`) between the gateway,
service-a, and service-b. Each service reads the incoming IDs (via HTTP middleware in the gateway,
via a global RabbitMQ interceptor in service-a/service-b), stores them in an `AsyncLocalStorage`-based
request context (`core/request-context/` in each service — see the design doc referenced below),
and makes them available to every controller, service, and log line for the duration of that
request with no manual parameter threading.

**In logs.** Every service logs through a small `LoggerService`/`AppLogger` wrapper over
`pino` (`core/logger/` in each service). Both `correlationId` and `requestId` are merged into
every log line automatically via pino's `mixin` option, which reads the active request context —
nothing needs to explicitly pass either ID to a log call. A single request produces log lines like:

```
INFO [Gateway] Request started correlationId=c1 requestId=r1
INFO [ServiceA] Processing request correlationId=c1 requestId=r2
INFO [ServiceB] Processing request correlationId=c1 requestId=r3
```

— the shared `correlationId` lets you reconstruct the whole flow across all three services' logs,
while each service's own `requestId` identifies exactly which hop each log line belongs to.

**Errors.** If any service in the chain fails, the error still carries the same IDs: the gateway's
HTTP error response includes both `X-Correlation-ID`/`X-Request-ID` response headers and a JSON
body with `correlationId`/`requestId` fields, sourced from the same request context - not
re-derived - so they always match what was logged for that request.

### Testing it locally

```bash
pnpm docker:up
```

Send a request with explicit IDs and see them echoed back:

```bash
curl -i http://localhost:3000/health/service-a \
  -H "X-Correlation-ID: 11111111-1111-4111-8111-111111111111" \
  -H "X-Request-ID: 22222222-2222-4222-8222-222222222222"
```

The response includes `x-correlation-id: 11111111-1111-4111-8111-111111111111` (echoed back
unchanged) and a fresh `x-request-id` (the gateway's own hop ID is not the same as what it sends
downstream — see "Generation" above). Watch the terminal logs (or `docker compose logs -f gateway
service-a service-b`) to see the same `correlationId` appear in all three services' log lines,
each with a different `requestId`.

To see the error path preserve the same IDs, stop `service-b` and repeat the request:

```bash
docker compose stop service-b
curl -i http://localhost:3000/health/service-a \
  -H "X-Correlation-ID: 11111111-1111-4111-8111-111111111111"
```

Expected: `503`, with the same `x-correlation-id` you sent still present on the error response.

See `docs/superpowers/specs/2026-08-12-correlation-request-id-design.md` for the full design.
```

- [ ] **Step 2: Stage the file**

```bash
git add README.md
```

---

## Task 14: Workspace-wide verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run every service's full check (lint + test)**

Run: `pnpm check`
Expected: exits 0 — this runs `pnpm lint` then `pnpm test` across `gateway`, `service-a`, and
`service-b` (per each service's own `package.json` scripts, invoked via `pnpm -r`).

- [ ] **Step 2: Run every service's build**

Run: `pnpm build`
Expected: exits 0 for all workspace packages, including `gateway`, `service-a`, `service-b`
(confirms the `nestjs-pino`/`pino` typing from Tasks 10–12 compiles cleanly, not just passes tests
under `swc`/Vitest's looser transpilation).

- [ ] **Step 3: Confirm no tracing metadata leaked into business payloads**

Run (from repo root):
```bash
grep -rn "correlationId\|requestId" back-end/*/src --include="*.ts" | grep -v ".spec.ts" | grep -iE "dto|payload"
```
Expected: no output — no DTO or payload type references either ID (they only appear in
`core/request-context/`, `core/logger/`, `core/exception-handling/`, and `health/` call sites).

- [ ] **Step 4: Confirm coverage thresholds still hold**

Run: `pnpm --filter gateway test:cov && pnpm --filter service-a test:cov && pnpm --filter service-b test:cov`
Expected: all three exit 0, meeting the existing 90% lines / 90% branches thresholds
(`vitest.config.mts`) — if any new file falls short, add the missing branch-coverage test case(s)
identified by the coverage report rather than lowering the threshold.

- [ ] **Step 5: Confirm `docker compose config` still validates**

Run: `docker compose config --quiet`
Expected: exits 0 — confirms the `docker-compose.yml` edits from Task 9 (the added
`RABBITMQ_SERVICE_B_QUEUE` env var on `service-a`) didn't break YAML/anchor resolution.

- [ ] **Step 6: Final manual smoke test of the full chain**

Run: `pnpm docker:up`, wait for all containers to report healthy (`docker compose ps`), then:
```bash
curl -i http://localhost:3000/health/service-a
curl -i http://localhost:3000/health/service-b
```
Expected: both return `200` with `x-correlation-id`/`x-request-id` response headers present and
valid UUID v4 values (since no request headers were sent, both are gateway-generated).

- [ ] **Step 7: Update `.superpowers/sdd/progress.md`, if this plan is executed via subagent-driven-development**

If using `superpowers:subagent-driven-development` to run this plan, that skill maintains its own
progress log — no separate action needed here beyond what that skill already does.

No further staging step here — Tasks 1–13 already staged their own files; this task only verifies
the combined result.
