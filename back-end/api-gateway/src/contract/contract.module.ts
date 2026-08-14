import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';

import { ContractValidationInterceptor } from './interceptors/contract-validation.interceptor.js';
import { ContractScanner } from './validators/contract-scanner.js';

@Module({
  imports: [DiscoveryModule],
  providers: [
    ContractScanner,
    { provide: APP_INTERCEPTOR, useClass: ContractValidationInterceptor },
  ],
})
export class ContractModule {}
