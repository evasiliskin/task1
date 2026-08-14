import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { Controller, Get, Inject, Res, StreamableFile } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/http/logger.service';
import { buildOutboundHeaders } from '@task1/shared/request-context/propagation.util';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { type Response } from 'express';
import { firstValueFrom, timeout } from 'rxjs';

import rabbitmqConfig from '../config/rabbitmq.config.js';
import reportConfig, { type ReportConfiguration } from '../config/report.config.js';
import { Contract } from '../contract/decorators/contract.decorator.js';
import { type BoundRequest, ModelBinder } from '../contract/decorators/model-binder.decorator.js';

import { ReportPathOutsideConfiguredDirectoryError } from './errors.js';
import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-client.token.js';
import { GetReportRequestSchema } from './schemas/get-report-request.schema.js';
import { GetReportResponseSchema } from './schemas/get-report-response.schema.js';

const REPORTS_PDF_GENERATE_PATTERN = 'reports.pdf.generate';

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- deliberately a `type`, not an `I`-prefixed `interface`, matching the RMQ reply shape of `IGenerateReportResult`
type GenerateReportRpcResult = { reportPath: string };

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  public constructor(
    @Inject(SERVICE_B_RMQ_CLIENT) private readonly serviceBClient: ClientProxy,
    private readonly requestContextService: RequestContextService,
    @Inject(rabbitmqConfig.KEY)
    private readonly rabbitmqConfiguration: ConfigType<typeof rabbitmqConfig>,
    @Inject(reportConfig.KEY) private readonly reportConfiguration: ReportConfiguration,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger('ReportsController');
  }

  @Get('pdf')
  @Contract({ request: GetReportRequestSchema, response: GetReportResponseSchema })
  @ApiOperation({
    summary: 'Generate and download a PDF processing report, optionally scoped to one import',
  })
  @ApiQuery({ name: 'importId', required: false, description: 'Import run UUID' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'The generated PDF report' })
  public async getPdfReport(
    @ModelBinder(GetReportRequestSchema) bound: BoundRequest<typeof GetReportRequestSchema>,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const headers = buildOutboundHeaders(this.requestContextService.requireContext());
    const record = new RmqRecordBuilder(bound.data).setOptions({ headers }).build();

    const result = await firstValueFrom(
      this.serviceBClient
        .send<GenerateReportRpcResult>(REPORTS_PDF_GENERATE_PATTERN, record)
        .pipe(timeout(this.rabbitmqConfiguration.rpcTimeoutMs)),
    );

    this.assertReportPathIsContained(result.reportPath);

    let reportFileDeleted = false;

    const deleteReportFile = (): void => {
      if (reportFileDeleted) {
        return;
      }

      reportFileDeleted = true;

      // eslint-disable-next-line security/detect-non-literal-fs-filename -- result.reportPath is the path service-b just reported having written inside the shared report-storage volume, not raw external input.
      unlink(result.reportPath).catch((error: unknown) => {
        this.logger.warn(
          { reportPath: result.reportPath, error },
          'failed to delete generated PDF report file',
        );
      });
    };

    // 'close' fires once the response has fully finished sending (after
    // 'finish') AND when the underlying connection is terminated
    // prematurely (client-aborted download) — a single listener covers
    // both the happy path and an aborted download.
    response.on('close', deleteReportFile);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
    const reportFileStream = createReadStream(result.reportPath);

    reportFileStream.on('error', (error) => {
      this.logger.error(
        { reportPath: result.reportPath, error },
        'failed to stream generated PDF report file',
      );
      deleteReportFile();
    });

    return new StreamableFile(reportFileStream, {
      type: 'application/pdf',
      disposition: `attachment; filename="report-${bound.data.importId ?? 'aggregate'}.pdf"`,
    });
  }

  private readonly logger: AppLogger;

  // Defense-in-depth: the RMQ reply is internal (service-b's own generated
  // path, already UUID-constrained upstream), but this refuses to read or
  // delete anything outside the shared report-storage directory this
  // gateway process is configured for, rather than trusting the reply path
  // unconditionally.
  private assertReportPathIsContained(reportPath: string): void {
    const reportDirectory = resolve(this.reportConfiguration.dir);
    const resolvedReportPath = resolve(reportPath);

    if (
      resolvedReportPath !== reportDirectory &&
      !resolvedReportPath.startsWith(`${reportDirectory}${sep}`)
    ) {
      throw new ReportPathOutsideConfiguredDirectoryError(reportPath, reportDirectory);
    }
  }
}
