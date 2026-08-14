import { Inject, Injectable } from '@nestjs/common';

import { IErrorFormatStrategy, IFormattedError } from './error-format.strategy.interface.js';
import { ERROR_FORMAT_STRATEGIES } from './error-format.tokens.js';

@Injectable()
export class ErrorFormatService {
  public constructor(
    @Inject(ERROR_FORMAT_STRATEGIES) private readonly strategies: readonly IErrorFormatStrategy[],
  ) {}

  public format(exception: unknown): IFormattedError {
    const strategy = this.strategies.find((candidate) => candidate.canHandle(exception));

    return (strategy ?? this.strategies[this.strategies.length - 1]).format(exception);
  }
}
