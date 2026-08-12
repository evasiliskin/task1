import { IS_PUBLIC_KEY, Public } from './public.decorator.js';

describe('Public', () => {
  it('should set isPublic metadata to true, when applied to a handler', () => {
    class TestController {
      @Public()
      public handler(): void {}
    }

    const metadata = Reflect.getMetadata(IS_PUBLIC_KEY, TestController.prototype.handler);

    expect(metadata).toBe(true);
  });
});
