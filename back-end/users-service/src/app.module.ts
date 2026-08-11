import { Module } from '@nestjs/common';

import { ExceptionHandlingModule } from './core/exception-handling/exception-handling.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [ExceptionHandlingModule, PrismaModule, UsersModule],
})
export class AppModule {}
