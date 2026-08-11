import { AlreadyExistsError, EntityNotFoundError } from '../core/errors';
import { type PrismaService } from '../prisma/prisma.service';

import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prismaMock: {
    $transaction: ReturnType<typeof vi.fn>;
    user: {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

  const fixture = {
    userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',

    user: (overrides: Partial<Record<string, unknown>> = {}) => ({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      email: 'john@example.com',
      name: 'John Doe',
      version: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    }),
  };

  beforeEach(() => {
    prismaMock = {
      $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback(prismaMock)),
      user: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    };

    service = new UsersService(prismaMock as unknown as PrismaService);
  });

  describe('create', () => {
    it('should return the created user, when email is not taken', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue(fixture.user());

      const result = await service.create({ email: 'john@example.com', name: 'John Doe' });

      expect(result).toEqual({
        id: fixture.userId,
        email: 'john@example.com',
        name: 'John Doe',
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    });

    it('should throw AlreadyExistsError, when email is already taken', async () => {
      prismaMock.user.findUnique.mockResolvedValue(fixture.user());

      await expect(service.create({ email: 'john@example.com', name: 'John Doe' })).rejects.toThrow(
        AlreadyExistsError,
      );
    });
  });

  describe('findOne', () => {
    it('should return the user, when the user exists', async () => {
      prismaMock.user.findUnique.mockResolvedValue(fixture.user());

      const result = await service.findOne(fixture.userId);

      expect(result.id).toBe(fixture.userId);
    });

    it('should throw EntityNotFoundError, when the user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(service.findOne(fixture.userId)).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('findAll', () => {
    it('should return an empty array, when no users exist', async () => {
      prismaMock.user.findMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });
});
