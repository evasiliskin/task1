import { type INestApplication } from '@nestjs/common';
import { type ClientProxy } from '@nestjs/microservices';
import { Test, type TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import request from 'supertest';
import type { App } from 'supertest/types';

import { HealthModule } from './health.module';
import { PRODUCTS_SERVICE_RMQ_CLIENT, USERS_SERVICE_RMQ_CLIENT } from './rabbitmq-clients.tokens';

describe('HealthController (HTTP Integration)', () => {
  let app: INestApplication;
  let usersServiceClient: { send: ReturnType<typeof vi.fn> };
  let productsServiceClient: { send: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    usersServiceClient = { send: vi.fn() };
    productsServiceClient = { send: vi.fn() };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [HealthModule],
    })
      .overrideProvider(USERS_SERVICE_RMQ_CLIENT)
      .useValue(usersServiceClient as unknown as ClientProxy)
      .overrideProvider(PRODUCTS_SERVICE_RMQ_CLIENT)
      .useValue(productsServiceClient)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 200 and status ok, when GET /health/users-service is called and users-service replies', async () => {
    usersServiceClient.send.mockReturnValue(of({ status: 'ok' }));

    const response = await request(app.getHttpServer() as App).get('/health/users-service');

    expect(response.status).toBe(200);
    expect((response.body as { status: string }).status).toBe('ok');
  });

  it('should return 503, when GET /health/products-service is called and products-service does not reply', async () => {
    productsServiceClient.send.mockReturnValue(throwError(() => new Error('connection refused')));

    const response = await request(app.getHttpServer() as App).get('/health/products-service');

    expect(response.status).toBe(503);
  });
});
