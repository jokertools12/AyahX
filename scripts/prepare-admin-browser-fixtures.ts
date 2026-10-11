import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
const schema=process.env.AYAHX_ADMIN_LOCAL_SCHEMA??'ayahx_d2_a1_verified_20261011';
if(!/^ayahx_d2_a1_[a-z0-9_]+$/.test(schema))throw new Error('LOCAL_SCHEMA_REQUIRED');
const directory=join(process.env.LOCALAPPDATA??join(homedir(),'AppData','Local'),'AyahX','private-backups');await mkdir(directory,{recursive:true});const file=join(directory,'a1-browser-fixtures.json');
interface Fixture{id:string;email:string;password:string;cookie?:string}
const roles=['super_admin','admin','content_manager','moderator','support','finance','analyst'];let fixtures:Record<string,Fixture>={};
try{fixtures=JSON.parse(await readFile(file,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
const db=await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database:schema});
try{const [version]=await db.query<mysql.RowDataPacket[]>('SELECT VERSION() version');if(version[0].version!=='9.7.2')throw new Error('MYSQL_VERSION_REQUIRED');for(const role of roles){let fixture=fixtures[role];if(!fixture){fixture={id:randomUUID(),email:`${role}@a1-local.example.test`,password:randomBytes(24).toString('base64url')};await db.execute('INSERT INTO users(id,email,password_hash) VALUES(?,?,?)',[fixture.id,fixture.email,await bcrypt.hash(fixture.password,10)]);await db.execute('INSERT INTO profiles(id,user_id,display_name) VALUES(?,?,?)',[randomUUID(),fixture.id,'Local admin fixture']);await db.execute('INSERT INTO user_roles(id,user_id,role) VALUES(?,?,?)',[randomUUID(),fixture.id,role]);fixtures[role]=fixture;await writeFile(file,JSON.stringify(fixtures),{mode:0o600});}const response=await fetch('http://localhost:3001/api/admin/auth/login',{method:'POST',headers:{Origin:'http://localhost:3001','Content-Type':'application/json'},body:JSON.stringify({email:fixture.email,password:fixture.password})});if(response.status!==200)throw new Error('LOCAL_FIXTURE_LOGIN_FAILED_'+response.status);const header=response.headers.get('set-cookie');if(!header)throw new Error('LOCAL_COOKIE_REQUIRED');fixture.cookie=decodeURIComponent(header.split(';')[0].slice('ayahx_admin_session='.length));}await writeFile(file,JSON.stringify(fixtures),{mode:0o600});console.log(JSON.stringify({local_only:true,fixture_roles:roles.length,authenticated_via:'actual_http_login',secrets_logged:false}));}finally{await db.end();}
