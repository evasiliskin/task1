import rabbitmqConfig from './rabbitmq.config';

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
      delete process.env.RABBITMQ_PING_TIMEOUT_MS;

      expect(rabbitmqConfig()).toEqual({
        url: 'amqp://guest:guest@localhost:5672',
        queue: 'service_a_queue',
        serviceBQueue: 'service_b_queue',
        pingTimeoutMs: 3000,
      });
    });
  });

  describe('environment overrides', () => {
    it('should parse values from environment variables, when all variables are set', () => {
      process.env.RABBITMQ_URL = 'amqp://user:pass@rabbit-host:5672';
      process.env.RABBITMQ_QUEUE = 'custom_service_a_queue';
      process.env.RABBITMQ_SERVICE_B_QUEUE = 'custom_service_b_queue';
      process.env.RABBITMQ_PING_TIMEOUT_MS = '5000';

      expect(rabbitmqConfig()).toEqual({
        url: 'amqp://user:pass@rabbit-host:5672',
        queue: 'custom_service_a_queue',
        serviceBQueue: 'custom_service_b_queue',
        pingTimeoutMs: 5000,
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

    it('should throw, when RABBITMQ_PING_TIMEOUT_MS is not a positive number', () => {
      process.env.RABBITMQ_PING_TIMEOUT_MS = '-1';

      expect(() => rabbitmqConfig()).toThrow();
    });
  });
});
