import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type ExecutionContext } from '@nestjs/common';
import { type Reflector } from '@nestjs/core';

import { AuthGuard } from './auth.guard.js';
import { type IRequestWithUser } from './authenticated-user.interface.js';
import { UnauthenticatedError } from './errors/unauthenticated.error.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

const AUTH_GUARD_SOURCE_PATH = fileURLToPath(new URL('./auth.guard.ts', import.meta.url));

const routeHandler = (): boolean => true;

function buildContext(request: Partial<IRequestWithUser> = {}): ExecutionContext {
  return {
    getHandler: () => routeHandler,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => request as IRequestWithUser,
    }),
  } as unknown as ExecutionContext;
}

function buildGuard(isPublic: boolean): {
  guard: AuthGuard;
  reflector: { getAllAndOverride: ReturnType<typeof vi.fn> };
} {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(isPublic) };

  return { guard: new AuthGuard(reflector as unknown as Reflector), reflector };
}

function stubIsAuthenticated(guard: AuthGuard, value: boolean): void {
  vi.spyOn(
    guard as unknown as { isAuthenticated: () => boolean },
    'isAuthenticated',
  ).mockReturnValue(value);
}

describe('AuthGuard', () => {
  describe('canActivate', () => {
    it('should return true, when the route is marked @Public()', () => {
      const { guard, reflector } = buildGuard(true);

      const result = guard.canActivate(buildContext());

      expect(result).toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, expect.any(Array));
    });

    it('should throw UnauthenticatedError, when the route is not public and isAuthenticated returns false', () => {
      const { guard } = buildGuard(false);

      stubIsAuthenticated(guard, false);

      expect(() => guard.canActivate(buildContext())).toThrow(UnauthenticatedError);
    });

    it('should return true, when the route is not public and isAuthenticated returns true', () => {
      const { guard } = buildGuard(false);

      stubIsAuthenticated(guard, true);

      expect(guard.canActivate(buildContext())).toBe(true);
    });

    it('should return true by default, when the route is not public (current unimplemented stub allows all)', () => {
      const { guard } = buildGuard(false);

      expect(guard.canActivate(buildContext())).toBe(true);
    });
  });

  it('should not import any concrete authentication provider package, when the guard is still the placeholder stub', () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed, test-local path derived from import.meta.url, not external input.
    const source = readFileSync(AUTH_GUARD_SOURCE_PATH, 'utf-8');
    const importLines = source.split('\n').filter((line) => line.trim().startsWith('import'));

    expect(importLines.join('\n')).not.toMatch(
      /passport|jsonwebtoken|@nestjs\/jwt|auth0|oidc|oauth/i,
    );
  });
});
