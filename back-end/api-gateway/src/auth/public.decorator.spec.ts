import { IS_PUBLIC_KEY, Public } from './public.decorator.js';

class TestController {
  @Public()
  public handler(this: void): boolean {
    return true;
  }
}

describe('Public', () => {
  it('should set isPublic metadata to true, when applied to a handler', () => {
    const handler: unknown = TestController.prototype.handler;
    const metadata: unknown = Reflect.getMetadata(IS_PUBLIC_KEY, handler as object);

    expect(metadata).toBe(true);
  });
});
