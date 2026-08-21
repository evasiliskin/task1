import rabbitmqConfig from './rabbitmq.config.js';

describe('rabbitmqConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return documented defaults, when no environment variables are set', () => {
      delete process.env.RABBITMQ_URL;
      delete process.env.RABBITMQ_QUEUE;
      delete process.env.RABBITMQ_PREFETCH_COUNT;
      delete process.env.RABBITMQ_MAX_RETRIES;
      delete process.env.RABBITMQ_RETRY_DELAY_MS;
      delete process.env.RABBITMQ_MAX_RETRY_DELAY_MS;
      delete process.env.RABBITMQ_PUBLISH_CONFIRM_TIMEOUT_MS;

      expect(rabbitmqConfig()).toEqual({
        url: 'amqp://guest:guest@localhost:5672',
        queue: 'service_b_queue',
        prefetchCount: 10,
        maxRetries: 5,
        retryDelayMs: 5000,
        maxRetryDelayMs: 600_000,
        publishConfirmTimeoutMs: 10_000,
      });
    });
  });

  describe('environment overrides', () => {
    it('should parse values from environment variables, when all variables are set', () => {
      process.env.RABBITMQ_URL = 'amqp://user:pass@rabbit-host:5672';
      process.env.RABBITMQ_QUEUE = 'custom_service_b_queue';
      process.env.RABBITMQ_PREFETCH_COUNT = '20';
      process.env.RABBITMQ_MAX_RETRIES = '3';
      process.env.RABBITMQ_RETRY_DELAY_MS = '10000';
      process.env.RABBITMQ_MAX_RETRY_DELAY_MS = '120000';
      process.env.RABBITMQ_PUBLISH_CONFIRM_TIMEOUT_MS = '15000';

      expect(rabbitmqConfig()).toEqual({
        url: 'amqp://user:pass@rabbit-host:5672',
        queue: 'custom_service_b_queue',
        prefetchCount: 20,
        maxRetries: 3,
        retryDelayMs: 10000,
        maxRetryDelayMs: 120000,
        publishConfirmTimeoutMs: 15_000,
      });
    });
  });

  describe('validation', () => {
    it('should throw, when RABBITMQ_URL is not a valid url', () => {
      process.env.RABBITMQ_URL = 'not-a-valid-url';

      expect(() => rabbitmqConfig()).toThrow();
    });

    it('should throw, when RABBITMQ_QUEUE is an empty string', () => {
      process.env.RABBITMQ_QUEUE = '';

      expect(() => rabbitmqConfig()).toThrow();
    });

    it('should throw, when RABBITMQ_PREFETCH_COUNT is not a positive number', () => {
      process.env.RABBITMQ_PREFETCH_COUNT = '0';

      expect(() => rabbitmqConfig()).toThrow();
    });

    it('should throw, when RABBITMQ_MAX_RETRIES is not a positive number', () => {
      process.env.RABBITMQ_MAX_RETRIES = '0';

      expect(() => rabbitmqConfig()).toThrow();
    });

    it('should throw, when RABBITMQ_MAX_RETRY_DELAY_MS is not a positive number', () => {
      process.env.RABBITMQ_MAX_RETRY_DELAY_MS = '0';

      expect(() => rabbitmqConfig()).toThrow();
    });

    it('should throw, when RABBITMQ_PUBLISH_CONFIRM_TIMEOUT_MS is not a positive number', () => {
      process.env.RABBITMQ_PUBLISH_CONFIRM_TIMEOUT_MS = '0';

      expect(() => rabbitmqConfig()).toThrow();
    });
  });
});
