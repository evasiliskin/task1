import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  it('should return status ok, when called', () => {
    const result = controller.check();

    expect(result.status).toBe('ok');
    expect(typeof result.timestamp).toBe('string');
  });
});
