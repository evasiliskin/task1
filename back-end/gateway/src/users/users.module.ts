import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { UsersController } from './users.controller';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'USERS_SERVICE',
        useFactory: () => ({
          transport: Transport.TCP,
          options: {
            host: process.env.USERS_SERVICE_HOST ?? 'localhost',
            port: Number(process.env.USERS_SERVICE_PORT ?? 3001),
          },
        }),
      },
    ]),
  ],
  controllers: [UsersController],
})
export class UsersModule {}
