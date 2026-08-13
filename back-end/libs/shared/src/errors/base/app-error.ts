import { type ErrorCategory } from '../error-category.enum.js';

import { type IErrorDetail } from './error-detail.types.js';

export interface IAppErrorOptions {
  code: string;
  category: ErrorCategory;
  path?: readonly string[];
  params?: Record<string, unknown>;
  cause?: unknown;
}

export abstract class AppError extends Error {
  public override readonly cause?: Error;
  public readonly code: string;
  public readonly category: string;
  public readonly path?: readonly string[];
  public readonly params?: Record<string, unknown>;

  public toDetail(): IErrorDetail {
    return {
      code: this.code,
      category: this.category,
      ...(this.path !== undefined && this.path.length > 0 && { path: [...this.path] }),
      ...(this.params !== undefined &&
        Object.keys(this.params).length > 0 && { params: { ...this.params } }),
      message: this.message,
    };
  }

  protected constructor(message: string, options: IAppErrorOptions) {
    const cause = options.cause !== undefined ? AppError.toError(options.cause) : undefined;

    super(message, cause !== undefined ? { cause } : {});
    this.name = new.target.name;
    this.code = options.code;
    this.category = options.category;

    if (cause !== undefined) {
      this.cause = cause;
    }

    if (options.path !== undefined) {
      this.path = options.path;
    }

    if (options.params !== undefined) {
      this.params = options.params;
    }

    Object.setPrototypeOf(this, new.target.prototype);
  }

  protected static toError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
  }
}
