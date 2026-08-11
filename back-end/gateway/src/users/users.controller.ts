import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { USERS_PATTERNS } from './users.patterns';

@Controller('v1/users')
export class UsersController {
  public constructor(@Inject('USERS_SERVICE') private readonly usersClient: ClientProxy) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  public async create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return await firstValueFrom(this.usersClient.send(USERS_PATTERNS.CREATE, dto));
  }

  @Get()
  public async findAll(): Promise<UserResponseDto[]> {
    return await firstValueFrom(this.usersClient.send(USERS_PATTERNS.FIND_ALL, {}));
  }

  @Get(':id')
  public async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return await firstValueFrom(this.usersClient.send(USERS_PATTERNS.FIND_ONE, { id }));
  }

  @Patch(':id')
  public async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    return await firstValueFrom(this.usersClient.send(USERS_PATTERNS.UPDATE, { id, ...dto }));
  }
}
