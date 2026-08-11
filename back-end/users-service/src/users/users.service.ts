import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AlreadyExistsError, EntityNotFoundError, VersionMismatchError } from '../core/errors';
import { PrismaService } from '../prisma/prisma.service';

import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { toUserResponse } from './users.mapper';

@Injectable()
export class UsersService {
  public constructor(private readonly prisma: PrismaService) {}

  public async create(dto: CreateUserDto): Promise<UserResponseDto> {
    const user = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: dto.email } });

      if (existing) {
        throw new AlreadyExistsError({ entityName: 'User', field: 'email', value: dto.email });
      }

      return tx.user.create({
        data: {
          email: dto.email,
          name: dto.name,
        },
      });
    });

    return toUserResponse(user);
  }

  public async findAll(): Promise<UserResponseDto[]> {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });

    return users.map(toUserResponse);
  }

  public async findOne(id: string): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new EntityNotFoundError({ entityName: 'User', criteria: `id=${id}` });
    }

    return toUserResponse(user);
  }

  public async update(dto: UpdateUserDto): Promise<UserResponseDto> {
    const user = await this.prisma.$transaction(async (tx) => {
      try {
        return await tx.user.update({
          where: {
            id: dto.id,
            version: dto.version,
          },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            version: { increment: 1 },
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          const current = await tx.user.findUnique({ where: { id: dto.id } });

          if (!current) {
            throw new EntityNotFoundError({ entityName: 'User', criteria: `id=${dto.id}` });
          }
          throw new VersionMismatchError({
            entityName: 'User',
            entityId: dto.id,
            expectedVersion: dto.version,
            currentVersion: current.version,
          });
        }
        throw error;
      }
    });

    return toUserResponse(user);
  }
}
