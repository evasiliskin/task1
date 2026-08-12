import { type ErrorCategory } from '../error-category.enum.js';

import { type IErrorDetail } from './error-detail.types.js';

export interface IAppErrorOptions {
  code: string;
  category: ErrorCategory;
  path?: readonly string[];
  params?: Record<string, unknown>;
  cause?: Error;
}

type OptionalErrorOptions = Pick<IAppErrorOptions, 'cause' | 'path' | 'params'>;

export abstract class AppError extends Error {
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
    super(message, options.cause !== undefined ? { cause: options.cause } : {});
    this.name = new.target.name;
    this.code = options.code;
    this.category = options.category;

    if (options.path !== undefined) {
      this.path = options.path;
    }

    if (options.params !== undefined) {
      this.params = options.params;
    }

    Object.setPrototypeOf(this, new.target.prototype);
  }

  protected static buildOptions(
    base: Pick<IAppErrorOptions, 'code' | 'category'> & Partial<OptionalErrorOptions>,
    optional?: Partial<OptionalErrorOptions>,
  ): IAppErrorOptions {
    const result: IAppErrorOptions = { ...base };

    if (optional !== undefined) {
      if (optional.cause !== undefined) {
        result.cause = optional.cause;
      }

      if (optional.path !== undefined) {
        result.path = optional.path;
      }

      if (optional.params !== undefined) {
        result.params = optional.params;
      }
    }

    return result;
  }
}
