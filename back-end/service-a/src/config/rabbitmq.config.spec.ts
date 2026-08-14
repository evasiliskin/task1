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
      delete process.env.RABBITMQ_SERVICE_B_QUEUE;
      delete process.env.RABBITMQ_PREFETCH_COUNT;

      expect(rabbitmqConfig()).toEqual({
        url: 'amqp://guest:guest@localhost:5672',
        queue: 'service_a_queue',
        serviceBQueue: 'service_b_queue',
        prefetchCount: 2,
      });
    });

    it('should default prefetchCount to 2, when RABBITMQ_PREFETCH_COUNT is not set', () => {
      delete process.env.RABBITMQ_PREFETCH_COUNT;

      expect(rabbitmqConfig().prefetchCount).toBe(2);
    });
  });

  describe('environment overrides', () => {
    it('should parse values from environment variables, when all variables are set', () => {
      process.env.RABBITMQ_URL = 'amqp://user:pass@rabbit-host:5672';
      process.env.RABBITMQ_QUEUE = 'custom_service_a_queue';
      process.env.RABBITMQ_SERVICE_B_QUEUE = 'custom_service_b_queue';
      process.env.RABBITMQ_PREFETCH_COUNT = '5';

      expect(rabbitmqConfig()).toEqual({
        url: 'amqp://user:pass@rabbit-host:5672',
        queue: 'custom_service_a_queue',
        serviceBQueue: 'custom_service_b_queue',
        prefetchCount: 5,
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

    it('should throw, when RABBITMQ_SERVICE_B_QUEUE is an empty string', () => {
      process.env.RABBITMQ_SERVICE_B_QUEUE = '';

      expect(() => rabbitmqConfig()).toThrow();
    });
  });
});
