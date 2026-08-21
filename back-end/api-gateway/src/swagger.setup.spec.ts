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

  it('should mount the documentation, when not running in production', async () => {
    delete process.env.SWAGGER_ENABLED;
    process.env.NODE_ENV = 'development';

    const moduleRef = await Test.createTestingModule({}).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();

    try {
      expect(applySwagger(app)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('should not mount the documentation, when running in production', () => {
    delete process.env.SWAGGER_ENABLED;
    process.env.NODE_ENV = 'production';

    const { app } = buildApp();

    expect(applySwagger(app)).toBe(false);
  });

  it('should not build the OpenAPI document, when running in production', () => {
    delete process.env.SWAGGER_ENABLED;
    process.env.NODE_ENV = 'production';

    const createDocument = vi.spyOn(SwaggerModule, 'createDocument');

    applySwagger(buildApp().app);

    expect(createDocument).not.toHaveBeenCalled();
  });

  it('should mount the documentation in production, when SWAGGER_ENABLED is "true"', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SWAGGER_ENABLED = 'true';

    const moduleRef = await Test.createTestingModule({}).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();

    try {
      expect(applySwagger(app)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('should not mount the documentation outside production, when SWAGGER_ENABLED is "false"', () => {
    process.env.NODE_ENV = 'development';
    process.env.SWAGGER_ENABLED = 'false';

    const { app } = buildApp();

    expect(applySwagger(app)).toBe(false);
  });
});
