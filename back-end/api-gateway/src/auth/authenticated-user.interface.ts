export interface IAuthenticatedUser {
  id: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: IAuthenticatedUser;
  }
}
