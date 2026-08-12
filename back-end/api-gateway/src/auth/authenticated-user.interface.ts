import type { Request } from 'express';

export interface IAuthenticatedUser {
  id: string;
}

export interface IRequestWithUser extends Request {
  user?: IAuthenticatedUser;
}
