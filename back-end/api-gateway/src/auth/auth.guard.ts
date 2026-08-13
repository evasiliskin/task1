import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { type IRequestWithUser } from './authenticated-user.interface.js';
import { UnauthenticatedError } from './errors/unauthenticated.error.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

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

    const request = context.switchToHttp().getRequest<IRequestWithUser>();

    if (this.isAuthenticated(request)) {
      return true;
    }

    throw new UnauthenticatedError();
  }

  private isAuthenticated(_request: IRequestWithUser): boolean {
    // TODO Authentication has to be implemented in the future using Auth0, Passport.js,
    // JWT/OIDC, or another approved authentication provider.
    // This is the single seam responsible for verifying the request's
    // credentials and, once verified, populating `request.user` with the
    // authenticated principal (see authenticated-user.interface.ts).
    //
    // Temporarily allows every request through until a real provider is
    // implemented here. Replace this with real credential verification.
    return true;
  }
}
