import { StreamableFile } from '@nestjs/common';
import { z } from 'zod';

export const GetReportResponseSchema = z.instanceof(StreamableFile);
