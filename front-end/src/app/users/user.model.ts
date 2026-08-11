export interface User {
  id: string;
  email: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserRequest {
  email: string;
  name: string;
}
