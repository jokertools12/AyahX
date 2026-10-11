import type { ZodType } from 'zod';
import type { CatalogActor } from '../services/catalogAudit';
import type { AdminPermission, AdminRole } from './adminPermissions';
export interface AdminIdentity { id: string; email: string; displayName: string | null; roles: AdminRole[]; permissions: AdminPermission[] }
export interface AdminRequestContext {
  actor: CatalogActor; user: AdminIdentity; sessionId: string;
  params: Record<string, string>; body: Record<string, unknown>; query: Record<string, unknown>;
  requestId: string; ip: string;
}
export interface AdminEndpointDefinition {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete'; path: string; permission: AdminPermission;
  superAdminOnly?: boolean; enrollmentAllowed?: boolean; writes?: boolean;
  body?: ZodType; query?: ZodType;
  handler(ctx: AdminRequestContext): Promise<{ data: unknown; meta?: Record<string, unknown> }>;
}
export type AdminRegister = (definition: AdminEndpointDefinition) => void;
export class AdminError extends Error {
  constructor(readonly code: string, readonly status: number, readonly detail: Record<string, unknown> = {}) { super(code); this.name = 'AdminError'; }
}
export const ADMIN_COOKIE = 'ayahx_admin_session';
