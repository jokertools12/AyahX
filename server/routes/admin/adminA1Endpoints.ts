import { z } from 'zod';
import type { CatalogDatabase } from '../../services/catalogContracts';
import type { AdminRegister } from '../../admin/adminContracts';
import { AdminAccessService } from '../../admin/adminAccessService';
import { AdminSecurityService } from '../../admin/adminSecurityService';
import { AdminRoleService } from '../../admin/adminRoleService';
import { AdminSettingsService } from '../../admin/adminSettingsRegistry';
import { AdminAuditService } from '../../admin/adminAuditService';
import { AdminDashboardService } from '../../admin/adminDashboardService';
import { ADMIN_ROLES, isAdminPermission } from '../../admin/adminPermissions';
import { ADMIN_LIST_QUERY, createAdminRouter, type AdminRouterOptions } from './adminRouter';
const code=z.object({code:z.string().trim().min(6).max(128)}).strict();
export function registerAdminA1Endpoints(register:AdminRegister,db:CatalogDatabase,access:AdminAccessService,env:NodeJS.ProcessEnv=process.env):void{
 const security=new AdminSecurityService(db,access,env),roles=new AdminRoleService(db),settings=new AdminSettingsService(db,env),audit=new AdminAuditService(db),dashboard=new AdminDashboardService(db,env);
 register({method:'get',path:'/auth/me',permission:'security.self',enrollmentAllowed:true,handler:async ctx=>({data:{...ctx.user,sessionId:ctx.sessionId,totp:await security.status(ctx),environment:env.NODE_ENV==='production'?'production':'local'}})});
 register({method:'post',path:'/auth/logout',permission:'security.self',enrollmentAllowed:true,writes:true,body:z.object({}).strict(),handler:async ctx=>({data:await security.revoke(ctx,ctx.sessionId)})});
 register({method:'get',path:'/dashboard',permission:'dashboard.read',handler:async()=>({data:await dashboard.get()})});
 register({method:'get',path:'/roles',permission:'roles.read',handler:async()=>({data:await roles.roles()})});
 register({method:'get',path:'/permissions',permission:'roles.read',handler:async()=>({data:roles.permissions()})});
 register({method:'put',path:'/roles/:slug/permissions',permission:'roles.manage',superAdminOnly:true,writes:true,body:z.object({permissions:z.array(z.string().refine(isAdminPermission)).max(100),confirmation:z.string().max(50)}).strict(),handler:async ctx=>({data:await roles.update(ctx)})});
 register({method:'get',path:'/users',permission:'users.read',query:ADMIN_LIST_QUERY,handler:ctx=>roles.users(ctx.query)});
 register({method:'put',path:'/users/:id/roles',permission:'roles.manage',superAdminOnly:true,writes:true,body:z.object({roles:z.array(z.enum([...ADMIN_ROLES,'user'])).min(1).max(8),confirmation:z.string().max(36)}).strict(),handler:async ctx=>({data:await roles.assign(ctx)})});
 register({method:'get',path:'/settings',permission:'settings.read',handler:async()=>({data:await settings.list()})});
 register({method:'patch',path:'/settings/:key',permission:'settings.write',writes:true,body:z.object({value:z.union([z.string().max(8192),z.number(),z.boolean()])}).strict(),handler:async ctx=>({data:await settings.update(ctx)})});
 register({method:'get',path:'/flags',permission:'flags.read',handler:async()=>({data:await settings.list(true)})});
 register({method:'patch',path:'/flags/:key',permission:'flags.write',writes:true,body:z.object({value:z.boolean(),confirmation:z.string().max(100)}).strict(),handler:async ctx=>({data:await settings.update(ctx,true)})});
 register({method:'get',path:'/audit',permission:'audit.read',query:ADMIN_LIST_QUERY.extend({action:z.string().max(191).optional(),entityType:z.string().max(64).optional(),entityId:z.string().max(191).optional(),actorId:z.string().max(36).optional(),from:z.string().datetime().optional(),to:z.string().datetime().optional()}),handler:ctx=>audit.list(ctx.query)});
 register({method:'get',path:'/security/totp',permission:'security.self',enrollmentAllowed:true,handler:async ctx=>({data:await security.status(ctx)})});
 register({method:'post',path:'/security/totp/enroll',permission:'security.self',enrollmentAllowed:true,writes:true,body:z.object({}).strict(),handler:async ctx=>({data:await security.enroll(ctx)})});
 register({method:'post',path:'/security/totp/confirm',permission:'security.self',enrollmentAllowed:true,writes:true,body:code,handler:async ctx=>({data:await security.confirm(ctx,String(ctx.body.code))})});
 register({method:'post',path:'/security/totp/disable',permission:'security.self',enrollmentAllowed:true,writes:true,body:code,handler:async ctx=>({data:await security.disable(ctx,String(ctx.body.code))})});
 register({method:'post',path:'/security/totp/recovery',permission:'security.self',enrollmentAllowed:true,writes:true,body:code,handler:async ctx=>({data:await security.regenerateRecovery(ctx,String(ctx.body.code))})});
 register({method:'get',path:'/security/sessions/all',permission:'security.sessions.manage',superAdminOnly:true,handler:async ctx=>({data:await security.sessions(ctx,true)})});
 register({method:'get',path:'/security/sessions',permission:'security.self',enrollmentAllowed:true,handler:async ctx=>({data:await security.sessions(ctx)})});
 register({method:'delete',path:'/security/sessions/:id',permission:'security.self',enrollmentAllowed:true,writes:true,body:z.object({}).strict(),handler:async ctx=>({data:await security.revoke(ctx,ctx.params.id)})});
}
/** Root mounts this at /api/admin and registers the separate A2a module. */
export function createAdminApplicationRouter(options:AdminRouterOptions){return createAdminRouter({...options,register:(register,access)=>{registerAdminA1Endpoints(register,options.db,access,options.env);options.register?.(register,access);}});}
