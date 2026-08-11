import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';

import { CreateUserDto } from './dto/create-user.dto';
import { FindOneDto } from './dto/find-one.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { USERS_PATTERNS } from './users.patterns';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  public constructor(private readonly usersService: UsersService) {}

  @MessagePattern(USERS_PATTERNS.CREATE)
  public create(@Payload() dto: CreateUserDto): Promise<UserResponseDto> {
    return this.usersService.create(dto);
  }

  @MessagePattern(USERS_PATTERNS.FIND_ALL)
  public findAll(): Promise<UserResponseDto[]> {
    return this.usersService.findAll();
  }

  @MessagePattern(USERS_PATTERNS.FIND_ONE)
  public findOne(@Payload() dto: FindOneDto): Promise<UserResponseDto> {
    return this.usersService.findOne(dto.id);
  }

  @MessagePattern(USERS_PATTERNS.UPDATE)
  public update(@Payload() dto: UpdateUserDto): Promise<UserResponseDto> {
    return this.usersService.update(dto);
  }
}
