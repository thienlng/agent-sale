import { defineRoutes } from '../common/routes.js';
import {
  AuthResponse,
  BootstrapResponse,
  LoginRequest,
  RefreshRequest,
  SignupRequest,
  UserDto,
} from './identity.schema.js';

export const identityRoutes = defineRoutes([
  {
    method: 'post',
    path: '/auth/signup',
    summary: 'Create a user, their first workspace (owner) and a session',
    tag: 'auth',
    auth: false,
    body: SignupRequest,
    responses: { 201: AuthResponse },
  },
  {
    method: 'post',
    path: '/auth/login',
    summary: 'Email + password login; sets the refresh cookie (web) or returns it (native)',
    tag: 'auth',
    auth: false,
    body: LoginRequest,
    responses: { 200: AuthResponse },
  },
  {
    method: 'post',
    path: '/auth/refresh',
    summary: 'Rotate the refresh token and issue a new access token',
    tag: 'auth',
    auth: false,
    body: RefreshRequest,
    responses: { 200: AuthResponse },
  },
  {
    method: 'post',
    path: '/auth/logout',
    summary: 'Revoke the current session and clear the refresh cookie',
    tag: 'auth',
    auth: true,
    responses: { 204: null },
  },
  {
    method: 'get',
    path: '/me',
    summary: 'The authenticated user',
    tag: 'auth',
    auth: true,
    responses: { 200: UserDto },
  },
  {
    method: 'get',
    path: '/bootstrap',
    summary: 'User + workspace memberships, fetched once before the SPA renders',
    tag: 'auth',
    auth: true,
    responses: { 200: BootstrapResponse },
  },
]);
