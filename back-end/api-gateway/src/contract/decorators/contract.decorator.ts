import { SetMetadata } from '@nestjs/common';

import type { IEndpointContract } from '../contracts/endpoint-contract.js';

export const CONTRACT_METADATA = 'endpoint_contract';

export const Contract = (contract: IEndpointContract): ReturnType<typeof SetMetadata> =>
  SetMetadata(CONTRACT_METADATA, contract);
