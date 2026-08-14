import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MissingContractError } from '@task1/shared/errors/index';
import { z } from 'zod';

import { ContractModule } from './contract.module.js';
import { Contract } from './decorators/contract.decorator.js';

@Controller('contracted')
class ContractedTestController {
  @Get()
  @Contract({ request: z.object({}), response: z.object({ ok: z.boolean() }) })
  public handle(): { ok: boolean } {
    return { ok: true };
  }
}

@Controller('uncontracted')
class UncontractedTestController {
  @Get()
  public handle(): void {
    // no @Contract on purpose
  }
}

// A 15s timeout (vs. the 5s default) on the two tests below: each spins up a real Nest
// application (createNestApplication + app.init()), which is slow enough under full-monorepo
// parallel test load (all 4 packages' suites running concurrently) to occasionally exceed the
// default — this is CPU-contention latency, not a hang, so a generous timeout is the correct fix
// rather than retry logic or skipping the test.
const NEST_APP_BOOT_TEST_TIMEOUT_MS = 15_000;

describe('ContractModule', () => {
  it(
    'should initialize successfully, when every controller handler has a @Contract',
    async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [ContractModule],
        controllers: [ContractedTestController],
      }).compile();
      const app = moduleRef.createNestApplication();

      await expect(app.init()).resolves.not.toThrow();
      await app.close();
    },
    NEST_APP_BOOT_TEST_TIMEOUT_MS,
  );

  it(
    'should fail to initialize, when a controller handler has no @Contract',
    async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [ContractModule],
        controllers: [UncontractedTestController],
      }).compile();
      const app = moduleRef.createNestApplication();

      await expect(app.init()).rejects.toThrow(MissingContractError);
    },
    NEST_APP_BOOT_TEST_TIMEOUT_MS,
  );
});
