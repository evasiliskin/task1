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
      delete process.env.RABBITMQ_DEAD_LETTER_QUEUE;
      delete process.env.RABBITMQ_RETRY_QUEUE;
      delete process.env.RABBITMQ_RETRY_DELAY_MS;

      expect(rabbitmqConfig()).toEqual({
        url: 'amqp://guest:guest@localhost:5672',
        queue: 'service_b_queue',
        prefetchCount: 10,
        maxRetries: 5,
        deadLetterQueue: 'service_b_queue.dlq',
        retryQueue: 'service_b_queue.retry',
        retryDelayMs: 5000,
      });
    });
  });

  describe('environment overrides', () => {
    it('should parse values from environment variables, when all variables are set', () => {
      process.env.RABBITMQ_URL = 'amqp://user:pass@rabbit-host:5672';
      process.env.RABBITMQ_QUEUE = 'custom_service_b_queue';
      process.env.RABBITMQ_PREFETCH_COUNT = '20';
      process.env.RABBITMQ_MAX_RETRIES = '3';
      process.env.RABBITMQ_DEAD_LETTER_QUEUE = 'custom_service_b_queue.dlq';
      process.env.RABBITMQ_RETRY_QUEUE = 'custom_service_b_queue.retry';
      process.env.RABBITMQ_RETRY_DELAY_MS = '10000';

      expect(rabbitmqConfig()).toEqual({
        url: 'amqp://user:pass@rabbit-host:5672',
        queue: 'custom_service_b_queue',
        prefetchCount: 20,
        maxRetries: 3,
        deadLetterQueue: 'custom_service_b_queue.dlq',
        retryQueue: 'custom_service_b_queue.retry',
        retryDelayMs: 10000,
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

    it('should throw, when RABBITMQ_DEAD_LETTER_QUEUE is an empty string', () => {
      process.env.RABBITMQ_DEAD_LETTER_QUEUE = '';

      expect(() => rabbitmqConfig()).toThrow();
    });
  });
});
