import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { applySwagger } from './swagger.setup.js';

type App = Parameters<typeof request>[0];

@Controller('probe')
class ProbeController {
  @Get()
  public read(): { ok: boolean } {
    return { ok: true };
  }
}

describe('applySwagger (HTTP Integration)', () => {
  const originalEnvironment = { ...process.env };
  let app: INestApplication | undefined;

  async function bootGateway(): Promise<App> {
    const moduleReference = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();

    app = moduleReference.createNestApplication();
    applySwagger(app);
    await app.init();

    return app.getHttpServer() as App;
  }

  afterEach(async () => {
    await app?.close();
    app = undefined;
    process.env = { ...originalEnvironment };
  });

  it('should return 200 for /api-docs, when SWAGGER_ENABLED is "true"', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SWAGGER_ENABLED = 'true';

    const response = await request(await bootGateway()).get('/api-docs');

    expect(response.status).toBe(200);
    expect(response.text).toContain('swagger');
  });

  it('should return 200 for /api-docs-json with a valid OpenAPI document, when enabled', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SWAGGER_ENABLED = 'true';

    const response = await request(await bootGateway()).get('/api-docs-json');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      openapi: expect.stringMatching(/^3\./) as string,
      info: { title: 'Gateway API', version: '1.0' },
      paths: { '/probe': expect.any(Object) as object },
    });
  });

  it('should return 404 for /api-docs, when SWAGGER_ENABLED is unset in production', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SWAGGER_ENABLED;

    const response = await request(await bootGateway()).get('/api-docs');

    expect(response.status).toBe(404);
  });

  it('should return 404 for /api-docs, when SWAGGER_ENABLED is "false" outside production', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SWAGGER_ENABLED = 'false';

    const response = await request(await bootGateway()).get('/api-docs');

    expect(response.status).toBe(404);
  });
});
