import { type INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { applySwagger } from './swagger.setup.js';

describe('applySwagger', () => {
  const originalEnvironment = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnvironment };
    vi.restoreAllMocks();
  });

  function buildApp(): { app: never; use: ReturnType<typeof vi.fn> } {
    const use = vi.fn();

    return { app: { use, getHttpAdapter: () => ({ get: vi.fn() }) } as never, use };
  }

  it('should mount the documentation outside production', async () => {
    process.env.NODE_ENV = 'development';

    // A plain fake app cannot stand in here: SwaggerModule.createDocument (real, unmocked,
    // unlike the production-path tests below) calls app.getHttpAdapter().getType() and walks the
    // DI container, so this needs an actual Nest application instance.
    const moduleRef = await Test.createTestingModule({}).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();

    try {
      expect(applySwagger(app)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('should not mount the documentation in production', () => {
    process.env.NODE_ENV = 'production';

    const { app } = buildApp();

    expect(applySwagger(app)).toBe(false);
  });

  it('should not build the OpenAPI document at all in production', () => {
    process.env.NODE_ENV = 'production';

    const createDocument = vi.spyOn(SwaggerModule, 'createDocument');

    applySwagger(buildApp().app);

    expect(createDocument).not.toHaveBeenCalled();
  });
});
