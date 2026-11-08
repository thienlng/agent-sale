import { defineRoutes } from '../common/routes.js';
import {
  CreateDataExportBody,
  DataExportDto,
  DataExportLink,
  DataExportList,
} from './dataexport.schema.js';

export const dataExportRoutes = defineRoutes([
  {
    method: 'get',
    path: '/data-exports',
    assistant: { use: 'never' },
    summary: 'Recent whole-workspace data exports (newest first)',
    tag: 'dataexport',
    auth: true,
    workspaceScoped: true,
    responses: { 200: DataExportList },
  },
  {
    method: 'post',
    path: '/data-exports',
    assistant: { use: 'never' },
    summary: 'Start a whole-workspace data export (ZIP of CSV files, optionally with pictures)',
    tag: 'dataexport',
    auth: true,
    workspaceScoped: true,
    body: CreateDataExportBody,
    responses: { 201: DataExportDto },
  },
  {
    method: 'post',
    path: '/data-exports/{exportId}/link',
    assistant: { use: 'never' },
    summary: 'One-time download link for a ready export (valid 5 minutes)',
    tag: 'dataexport',
    auth: true,
    workspaceScoped: true,
    responses: { 200: DataExportLink },
  },
  {
    method: 'get',
    path: '/data-exports/download/{token}',
    summary: 'Download an export with a one-time link (streams the ZIP)',
    tag: 'dataexport',
    auth: false,
    responses: { 200: null },
  },
]);
