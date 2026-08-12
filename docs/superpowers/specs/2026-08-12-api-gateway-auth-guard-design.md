# API Gateway Authentication Guard — Design

Date: 2026-08-12

## Goal

Introduce a provider-agnostic authentication boundary at the `api-gateway` so
that:

- every endpoint requires authentication by default;
- endpoints can opt out explicitly via `@Public()`;
- the actual identity-verification logic is left as an isolated `TODO`, to be
  implemented later against Auth0, Passport.js, JWT/OIDC, or another approved
  provider;
- `service-a` and `service-b` remain untouched — authentication stays at the
  gateway boundary, ahead of RabbitMQ.

## Non-goals

- No real authentication logic (token validation, session lookup, provider
  SDKs).
- No new dependencies (no `passport`, `@nestjs/jwt`, `auth0`, OAuth/OIDC
  libraries).
- No hard-coded user/token.
- No changes to `service-a`/`service-b`.

**Exception, by explicit decision:** the `isAuthenticated()` stub currently
returns `true` unconditionally (see `auth.guard.ts` below), rather than
`false`. This was flagged as a direct conflict with the "no `return true;`
bypass" language in the original request and confirmed anyway — it means no
request is actually rejected until a real provider is implemented. The
guard's structure, rejection branch, and tests are otherwise built as if the
stub returned `false` (fail-closed), so flipping this one line back to
`false` (or implementing real verification) is the only change needed to
make the guard enforce authentication for real.

## New files — `back-end/api-gateway/src/auth/`

### `auth.guard.ts`

```ts
@Injectable()
export class AuthGuard implements CanActivate {
  public constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    if (!this.isAuthenticated(request)) {
      throw new UnauthenticatedError();
    }

    return true;
  }

  private isAuthenticated(request: Request): boolean {
    // TODO: Implement authentication using Auth0, Passport.js,
    // JWT/OIDC, or another approved authentication provider.
    // This is the single seam responsible for verifying the request's
    // credentials and, once verified, populating `request.user` with the
    // authenticated principal (see authenticated-user.interface.ts).
    //
    // WARNING: intentionally returns true for every request until a real
    // provider is implemented here — by explicit decision, so that no
    // endpoint is blocked while authentication is unimplemented. This means
    // the guard currently does not reject any request. The rejection branch
    // below is real and exercised in auth.guard.spec.ts by stubbing this
    // method; it takes effect the moment this method is replaced with a
    // real check.
    return true;
  }
}
```

`isAuthenticated` is `private` and isolated on purpose: it is the one seam a
future provider implementation replaces. By explicit decision it currently
returns `true` unconditionally (see the WARNING above) rather than `false` —
this is a deliberate, documented exception to the "no bypass" constraint in
the original task, made after that conflict was raised and confirmed. The
guard's rejection branch (`throw new UnauthenticatedError()`) is untouched
and is still verified in tests by stubbing this seam to return `false`.

### `public.decorator.ts`

```ts
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);
```

### `authenticated-user.interface.ts`

Minimal, provider-agnostic shape plus an Express `Request` augmentation so
downstream code has a typed place to read from once a real provider exists:

```ts
export interface IAuthenticatedUser {
  id: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: IAuthenticatedUser;
  }
}
```

### `errors/unauthenticated.error.ts`

```ts
export class UnauthenticatedError extends AppError {
  public constructor() {
    super('Authentication is required to access this resource.', {
      code: 'AUTH_REQUIRED',
      category: ErrorCategory.AUTH,
    });
  }
}
```

Uses the existing `AppError` base and the existing (previously unused)
`ErrorCategory.AUTH`. No internal details (headers, provider errors) are
exposed in the message.

### `auth.module.ts`

```ts
@Module({
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AuthModule {}
```

Registering via `APP_GUARD` makes the guard global — every current and future
endpoint is protected unless explicitly marked `@Public()`.

### `auth.guard.spec.ts`

Unit tests, colocated, following the project's existing style (direct class
instantiation, `vi.fn()` mocks, `Mocked<T>`, `should <behavior>, when
<condition>` naming, AAA structure). Covers:

- should return true, when the route is marked @Public()
- should throw UnauthenticatedError, when the request is not authenticated
  (achieved by stubbing the guard's isolated `isAuthenticated` seam to
  return `false` — this proves the rejection branch works correctly even
  though the current default stub returns `true`)
- should return true, when the request is authenticated (the current
  default behavior of the unmodified stub, and also verified by stubbing
  `isAuthenticated` to return `true` explicitly)
- should not import or reference any concrete auth provider (a structural
  assertion — e.g. no passport/jwt/auth0 imports in the guard module)

## Shared-lib change (small, targeted)

`back-end/libs/shared/src/exception-handling/status-from-app-error.utility.ts`
currently ignores its argument and always returns
`HttpStatus.INTERNAL_SERVER_ERROR` for *every* `AppError`, regardless of
category. Left as-is, `UnauthenticatedError` would format as `500`, not
`401`, breaking requirement 6.

Fix: add a mapping for `ErrorCategory.AUTH → HttpStatus.UNAUTHORIZED`, keep
the existing fallback (`INTERNAL_SERVER_ERROR`) for every other category
unchanged — that gap is pre-existing and out of scope for this task.

```ts
export function statusFromAppError(error: AppError): number {
  if (error.category === ErrorCategory.AUTH) {
    return HttpStatus.UNAUTHORIZED;
  }

  return HttpStatus.INTERNAL_SERVER_ERROR;
}
```

Its existing spec file (if any) gets a case added for this mapping; no other
behavior changes.

## Wiring changes

- `back-end/api-gateway/src/app.module.ts` imports `AuthModule`.
- `back-end/api-gateway/src/health/health.controller.ts` — add `@Public()`
  to all three routes (`health`, `live`, `ready`), since these are
  liveness/readiness probes that must stay reachable without auth.

## Request flow (unchanged shape, guard now sits at the gateway)

```text
Client
   |
   v
API Gateway
   |
   | AuthGuard (global, @Public() opt-out)
   v
RabbitMQ
   |
   +----> Service A
   |
   +----> Service B
```

## Error contract

`UnauthenticatedError` flows through the existing
`GlobalExceptionFilter` → `AppErrorFormatStrategy` → (after the fix)
`statusFromAppError`, producing the same consistent `IApiErrorResponse`
shape (`statusCode: 401, error: { code: 'AUTH_REQUIRED', category: 'AUTH',
message, details }, correlationId, requestId`) already used by every other
error in the app. No new response contract is introduced.

## What remains intentionally unimplemented

- The body of `AuthGuard.isAuthenticated()` — real credential extraction and
  verification. It currently returns `true` unconditionally (by explicit
  decision — see Non-goals), so no request is actually rejected yet.
- Population of `request.user` — the interface and the augmentation exist,
  but nothing writes to it yet.
- Any provider configuration (no `AUTH0_*`, `JWT_*`, `OAUTH_*` env vars are
  added).
