import {
  AssignTagRequest,
  type ContactDto,
  ContactHistoryQuery,
  type ContactListResponse,
  ContactQueryRequest,
  CreateContactNoteRequest,
  CreateContactRequest,
  RemoveTagAssignmentRequest,
  UpdateContactNoteRequest,
  UpdateContactRequest,
  UpdateTagAssignmentRequest,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { ContactService } from '../../application/contact.service.js';
import { TagAssignmentService } from '../../application/tag-assignment.service.js';

/** Thin controller: customers, their notes, history and tags. */
@WorkspaceScoped()
@Controller()
export class ContactsController {
  constructor(
    @Inject(ContactService) private readonly contacts: ContactService,
    @Inject(TagAssignmentService) private readonly tags: TagAssignmentService,
  ) {}

  @Post('contacts')
  @HttpCode(201)
  create(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(CreateContactRequest)) body: unknown,
  ): Promise<ContactDto> {
    return this.contacts.create(ws, body, user.userId);
  }

  // Declared before contacts/:contactId so "query" is never taken for an id.
  @Post('contacts/query')
  @HttpCode(200)
  query(
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ZodValidationPipe(ContactQueryRequest)) body: unknown,
  ): Promise<ContactListResponse> {
    return this.contacts.query(ws, body);
  }

  @Get('contacts/:contactId')
  get(@CurrentWorkspace() ws: WorkspaceId, @Param('contactId') id: string): Promise<ContactDto> {
    return this.contacts.get(ws, id);
  }

  @Patch('contacts/:contactId')
  update(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('contactId') id: string,
    @Body(new ZodValidationPipe(UpdateContactRequest)) body: unknown,
  ): Promise<ContactDto> {
    return this.contacts.update(ws, id, body, user.userId);
  }

  @Get('contacts/:contactId/notes')
  async notes(@CurrentWorkspace() ws: WorkspaceId, @Param('contactId') id: string) {
    return { data: await this.contacts.listNotes(ws, id) };
  }

  @Post('contacts/:contactId/notes')
  @HttpCode(201)
  addNote(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('contactId') id: string,
    @Body(new ZodValidationPipe(CreateContactNoteRequest)) body: unknown,
  ) {
    return this.contacts.addNote(ws, id, body, user.userId);
  }

  @Patch('contacts/:contactId/notes/:noteId')
  editNote(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('contactId') id: string,
    @Param('noteId') noteId: string,
    @Body(new ZodValidationPipe(UpdateContactNoteRequest)) body: unknown,
  ) {
    return this.contacts.editNote(ws, id, noteId, body, user.userId);
  }

  @Get('contacts/:contactId/history')
  async history(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('contactId') id: string,
    @Query(new ZodValidationPipe(ContactHistoryQuery)) query: unknown,
  ) {
    return { data: await this.contacts.history(ws, id, query) };
  }

  @Get('contacts/:contactId/tags')
  async tagsOf(@CurrentWorkspace() ws: WorkspaceId, @Param('contactId') id: string) {
    return { data: await this.tags.list(ws, id) };
  }

  /** 201 when the tag was added, 200 when it was already there (safe to retry). */
  @Post('contacts/:contactId/tags')
  async assign(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('contactId') id: string,
    @Body(new ZodValidationPipe(AssignTagRequest)) body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { created, assignment } = await this.tags.assign(ws, id, body, user.userId);
    void reply.status(created ? 201 : 200);
    return assignment;
  }

  @Patch('tag-assignments/:assignmentId')
  updateAssignment(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('assignmentId') id: string,
    @Body(new ZodValidationPipe(UpdateTagAssignmentRequest)) body: unknown,
  ) {
    return this.tags.updateValues(ws, id, body, user.userId);
  }

  @Post('tag-assignments/:assignmentId/remove')
  @HttpCode(200)
  removeAssignment(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('assignmentId') id: string,
    @Body(new ZodValidationPipe(RemoveTagAssignmentRequest)) body: unknown,
  ) {
    return this.tags.remove(ws, id, body, user.userId);
  }
}
