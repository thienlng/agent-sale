import {
  CreateTaskRequest,
  type TaskDto,
  type TaskList,
  TaskListQuery,
  UpdateTaskRequest,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';

import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { TaskService } from '../../application/task.service.js';

const viewer = (u: AuthState) => ({ userId: u.userId, role: u.role });

/**
 * Thin controller: team tasks (CRM-04). `contacts.view` is held by every role, so any member may
 * list and create; other members' tasks need `contacts.view_all` (checked by the service).
 */
@WorkspaceScoped()
@Controller('tasks')
export class TasksController {
  constructor(@Inject(TaskService) private readonly tasks: TaskService) {}

  @RequireCapability('contacts.view')
  @Get()
  list(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Query(new ZodValidationPipe(TaskListQuery)) query: unknown,
  ): Promise<TaskList> {
    return this.tasks.list(ws, query, viewer(user));
  }

  @RequireCapability('contacts.view')
  @Post()
  @HttpCode(201)
  create(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(CreateTaskRequest)) body: unknown,
  ): Promise<TaskDto> {
    return this.tasks.create(ws, body, viewer(user));
  }

  @RequireCapability('contacts.view')
  @Patch(':taskId')
  update(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('taskId') id: string,
    @Body(new ZodValidationPipe(UpdateTaskRequest)) body: unknown,
  ): Promise<TaskDto> {
    return this.tasks.update(ws, id, body, viewer(user));
  }

  @RequireCapability('contacts.view')
  @Post(':taskId/complete')
  @HttpCode(200)
  complete(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('taskId') id: string,
  ): Promise<TaskDto> {
    return this.tasks.complete(ws, id, viewer(user));
  }

  @RequireCapability('contacts.view')
  @Post(':taskId/cancel')
  @HttpCode(200)
  cancel(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('taskId') id: string,
  ): Promise<TaskDto> {
    return this.tasks.cancel(ws, id, viewer(user));
  }
}
