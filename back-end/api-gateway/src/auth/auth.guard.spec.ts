import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type ExecutionContext } from '@nestjs/common';
import { type Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AuthGuard } from './auth.guard.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { UnauthenticatedError } from './errors/unauthenticated.error.js';

function buildContext(request: Partial<Request> = {}): ExecutionContext {
  return {
    getHandler: () => (): void => {},
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => request as Request,
    }),
  } as unknown as ExecutionContext;
}

function buildGuard(isPublic: boolean): { guard: AuthGuard; reflector: { getAllAndOverride: ReturnType<typeof vi.fn> } } {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(isPublic) };

  return { guard: new AuthGuard(reflector as unknown as Reflector), reflector };
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

      vi.spyOn(guard as unknown as { isAuthenticated: () => boolean }, 'isAuthenticated').mockReturnValue(
        false,
      );

      expect(() => guard.canActivate(buildContext())).toThrow(UnauthenticatedError);
    });

    it('should return true, when the route is not public and isAuthenticated returns true', () => {
      const { guard } = buildGuard(false);

      vi.spyOn(guard as unknown as { isAuthenticated: () => boolean }, 'isAuthenticated').mockReturnValue(
        true,
      );

      expect(guard.canActivate(buildContext())).toBe(true);
    });

    it('should throw UnauthenticatedError by default, when the route is not public (current unimplemented stub)', () => {
      const { guard } = buildGuard(false);

      expect(() => guard.canActivate(buildContext())).toThrow(UnauthenticatedError);
    });
  });

  it('should not import any concrete authentication provider package', () => {
    const path = fileURLToPath(new URL('./auth.guard.ts', import.meta.url));
    const source = readFileSync(path, 'utf-8');
    const importLines = source
      .split('\n')
      .filter((line) => line.trim().startsWith('import'));

    expect(importLines.join('\n')).not.toMatch(/passport|jsonwebtoken|@nestjs\/jwt|auth0|oidc|oauth/i);
  });
});
