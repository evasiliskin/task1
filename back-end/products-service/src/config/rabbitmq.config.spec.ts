import rabbitmqConfig from './rabbitmq.config';

describe('rabbitmqConfig', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns the documented defaults when no env vars are set', () => {
    delete process.env.RABBITMQ_URL;
    delete process.env.RABBITMQ_QUEUE;

    expect(rabbitmqConfig()).toEqual({
      url: 'amqp://guest:guest@localhost:5672',
      queue: 'products_service_queue',
    });
  });

  it('parses values from environment variables', () => {
    process.env.RABBITMQ_URL = 'amqp://user:pass@rabbit-host:5672';
    process.env.RABBITMQ_QUEUE = 'custom_queue';

    expect(rabbitmqConfig()).toEqual({
      url: 'amqp://user:pass@rabbit-host:5672',
      queue: 'custom_queue',
    });
  });

  it('throws when RABBITMQ_URL is not a valid url', () => {
    process.env.RABBITMQ_URL = 'not-a-valid-url';

    expect(() => rabbitmqConfig()).toThrow();
  });

  it('throws when RABBITMQ_QUEUE is an empty string', () => {
    process.env.RABBITMQ_QUEUE = '';

    expect(() => rabbitmqConfig()).toThrow();
  });
});
