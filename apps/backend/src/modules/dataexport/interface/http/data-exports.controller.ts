import { Readable } from 'node:stream';

import {
  CreateDataExportBody,
  type DataExportDto,
  type DataExportLink,
  type DataExportList,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  Public,
  RequireCapability,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { DataExportService } from '../../application/data-export.service.js';

/** Settings → Dữ liệu (SET-10): owners and admins (`data.export`); never an API key. */
@WorkspaceScoped()
@Controller('data-exports')
export class DataExportsController {
  constructor(@Inject(DataExportService) private readonly exports: DataExportService) {}

  @RequireCapability('data.export')
  @Get()
  list(@CurrentWorkspace() ws: WorkspaceId): Promise<DataExportList> {
    return this.exports.list(ws);
  }

  @RequireCapability('data.export')
  @Post()
  async create(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(CreateDataExportBody)) body: CreateDataExportBody,
  ): Promise<DataExportDto> {
    const name = (await user.displayName?.()) ?? null;
    return this.exports.request(ws, { userId: user.userId, name }, body.includeMedia ?? false);
  }

  @RequireCapability('data.export')
  @Post(':exportId/link')
  @HttpCode(200)
  link(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('exportId', new ParseUUIDPipe()) id: string,
  ): Promise<DataExportLink> {
    return this.exports.createLink(ws, id);
  }
}

/**
 * The one-time download link: the token is the credential (32 random bytes, hashed at rest,
 * 5 minutes, one use), so the browser can stream the ZIP with a plain navigation.
 */
@Public()
@Controller('data-exports/download')
export class DataExportDownloadController {
  constructor(@Inject(DataExportService) private readonly exports: DataExportService) {}

  @Get(':token')
  async download(@Param('token') token: string, @Res() reply: FastifyReply): Promise<void> {
    const file = await this.exports.download(token);
    void reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${file.fileName}"`)
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer');
    if (file.sizeBytes !== null) void reply.header('Content-Length', String(file.sizeBytes));
    await reply.send(Readable.from(file.body));
  }
}
