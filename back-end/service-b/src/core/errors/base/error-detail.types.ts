export interface IErrorDetail {
  code: string;
  category: string;
  path?: readonly string[];
  params?: Record<string, unknown>;
  message: string;
}
