import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MissingContractError, ResponseContractViolationError } from '@task1/shared/errors/index';
import { type Observable, map, throwError } from 'rxjs';
import { z } from 'zod';

import type { IEndpointContract } from '../contracts/endpoint-contract.js';
import { CONTRACT_METADATA } from '../decorators/contract.decorator.js';

@Injectable()
export class ContractValidationInterceptor implements NestInterceptor {
  public constructor(private readonly reflector: Reflector) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const handler = context.getHandler();
    const controllerName = context.getClass().name;
    const methodName = handler.name;
    const contract = this.reflector.get<IEndpointContract | undefined>(CONTRACT_METADATA, handler);

    if (contract === undefined) {
      return throwError(() => new MissingContractError({ controllerName, methodName }));
    }

    return next.handle().pipe(
      map((data: unknown) => {
        const parsed = contract.response.safeParse(data);

        if (!parsed.success) {
          throw new ResponseContractViolationError({
            controllerName,
            methodName,
            errors: z.treeifyError(parsed.error),
          });
        }

        return parsed.data;
      }),
    );
  }
}
