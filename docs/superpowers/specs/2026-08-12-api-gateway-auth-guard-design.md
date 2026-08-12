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
- No hard-coded user/token, no dev bypass (`return true`).
- No changes to `service-a`/`service-b`.

`isAuthenticated()` fails closed: it returns `false` until a real provider
replaces it, so every non-`@Public()` route rejects with
`UnauthenticatedError` (401) today. (Mid-implementation this was briefly
flipped to `return true` and back — see git history/conversation for that
detour; the final, shipped behavior is fail-closed.)

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
    // Fails closed until a real provider is implemented here: every
    // non-public request is rejected with UnauthenticatedError. Replace
    // this with real credential verification.
    return false;
  }
}
```

`isAuthenticated` is `private` and isolated on purpose: it is the one seam a
future provider implementation replaces, and the one seam tests stub to
exercise the "authenticated request proceeds" path without a real provider.

### `public.decorator.ts`

```ts
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);
```

### `authenticated-user.interface.ts`

Minimal, provider-agnostic shape, plus a typed request extension so
downstream code has a place to read from once a real provider exists.
Deliberately not a global `declare module 'express-serve-static-core'`
augmentation of `Request` — that would need an eslint-disable to satisfy the
project's `interface` naming convention (`I`-prefix) for no real benefit;
extending `Request` locally is equally usable and stays clean:

```ts
export interface IAuthenticatedUser {
  id: string;
}

export interface IRequestWithUser extends Request {
  user?: IAuthenticatedUser;
}
```

`AuthGuard` reads the request via `getRequest<IRequestWithUser>()`.

### `errors/unauthenticated.error.ts`

```ts
export class UnauthenticatedError extends AuthError {
  public constructor() {
    super('Authentication is required to access this resource.', {
      code: 'AUTH_REQUIRED',
      category: ErrorCategory.AUTH,
    });
  }
}
```

`AuthError` is a new abstract base (`back-end/libs/shared/src/errors/auth/auth-error.ts`,
`export abstract class AuthError extends AppError {}`) added to `libs/shared`
alongside the existing `AppError`/`InternalError` hierarchy, mirroring a
per-category error-class pattern (each HTTP-relevant category gets an
abstract base; concrete errors extend it; the exception-handling layer
switches on `instanceof`, most-specific first) already used elsewhere.
`UnauthenticatedError` is the first (and, for this task, only) concrete
`AuthError`. No internal details (headers, provider errors) are exposed in
the message.

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
- should throw UnauthenticatedError, when isAuthenticated returns false
  (both the current default stub and an explicit stub prove the rejection
  branch)
- should return true, when the guard's isolated `isAuthenticated` seam is
  stubbed to return true (proves the "authenticated request proceeds" path
  without a real provider)
- should not import any concrete auth provider package (a structural
  assertion over the file's import lines — e.g. no passport/jwt/auth0)

## Shared-lib changes (small, targeted)

`back-end/libs/shared/src/exception-handling/status-from-app-error.utility.ts`
originally ignored its argument and always returned
`HttpStatus.INTERNAL_SERVER_ERROR` for *every* `AppError`, regardless of
category. Left as-is, `UnauthenticatedError` would format as `500`, not
`401`, breaking requirement 6.

Fix: map by `instanceof AuthError` (not by comparing the `category` string),
consistent with the per-category-base-class + `instanceof` pattern above.
Every other category keeps returning `INTERNAL_SERVER_ERROR` unchanged —
that gap is pre-existing and out of scope for this task.

```ts
export function statusFromAppError(error: AppError): number {
  if (error instanceof AuthError) {
    return HttpStatus.UNAUTHORIZED;
  }

  return HttpStatus.INTERNAL_SERVER_ERROR;
}
```

Its spec gained cases for: an `AuthError` → 401, a plain `AppError` with
`category: AUTH` but *not* an `AuthError` instance → 500 (proving the check
is type-based, not string-based), and `category: INTERNAL` → 500.

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
  verification. It currently returns `false` (fail closed), so every
  non-public request is rejected until a provider is implemented.
- Population of `request.user` — the interface and the augmentation exist,
  but nothing writes to it yet.
- Any provider configuration (no `AUTH0_*`, `JWT_*`, `OAUTH_*` env vars are
  added).
