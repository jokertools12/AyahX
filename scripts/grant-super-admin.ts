import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { CatalogDatabase } from '../server/services/catalogContracts';
import { appendCatalogAudit } from '../server/services/catalogAudit';
/** Emergency SSH-only command: no password or profile writes. Dry-run default. */
export async function grantSuperAdmin(db:CatalogDatabase,userId:string,apply=false):Promise<{userId:string;action:string;roles:string[]}> {
 if(!/^[a-zA-Z0-9_-]{1,36}$/u.test(userId))throw new Error('USER_ID_INVALID');
 const [user]=await db.read('SELECT id FROM users WHERE id=?',[userId]);if(!user)throw new Error('USER_NOT_FOUND');
 const roles=await db.read('SELECT role FROM user_roles WHERE user_id=?',[userId]);
 if(!apply)return{userId,action:roles.some(row=>row.role==='super_admin')?'unchanged':'would_grant',roles:roles.map(row=>String(row.role))};
 const [grant]=await db.read("SELECT COUNT(*) count FROM admin_permissions WHERE role_slug='super_admin' AND permission_key='roles.manage'");if(Number(grant?.count)!==1)throw new Error('ADMIN_MIGRATION_REQUIRED');
 await db.transaction(async tx=>{
  const before=await tx.read('SELECT role FROM user_roles WHERE user_id=? FOR UPDATE',[userId]);
  if(!before.some(row=>row.role==='super_admin'))await tx.execute("INSERT INTO user_roles(id,user_id,role) VALUES(?,?,'super_admin')",[randomUUID(),userId]);
  await appendCatalogAudit(tx,{id:'emergency-ssh',kind:'system',permissions:new Set(['roles.manage']),requestId:randomUUID()},'admin.emergency.grant','user_roles',userId,{roles:before.map(row=>row.role)},{roles:[...new Set([...before.map(row=>row.role),'super_admin'])]});
 });return{userId,action:'granted',roles:[...new Set([...roles.map(row=>String(row.role)),'super_admin'])]};
}
async function main(){
 const args=process.argv.slice(2),index=args.indexOf('--user-id'),userId=args[index+1];if(index<0||!userId)throw new Error('USAGE: --user-id ID [--apply --confirm-production]');
 const apply=args.includes('--apply');if(apply&&process.env.NODE_ENV==='production'&&!args.includes('--confirm-production'))throw new Error('PRODUCTION_CONFIRMATION_REQUIRED');
 const {pool}=await import('../server/db');const {catalogDatabaseFromPool}=await import('../server/services/catalogMysqlDatabase');
 try{console.log(JSON.stringify(await grantSuperAdmin(catalogDatabaseFromPool(pool),userId,apply)));}finally{await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error instanceof Error&&/^[A-Z_: -]+$/u.test(error.message)?error.message:'EMERGENCY_GRANT_FAILED');process.exitCode=1;});
