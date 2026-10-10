/** Real production reads through a loopback HTTP app. Flag override lives only in this process. */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import mysql from 'mysql2';
import express from 'express';
import {createCatalogRouter} from '../server/routes/catalog';
import {RecitationCatalogService,readCatalogSettings} from '../server/services/recitationCatalogService';
import {type CatalogDatabase,type CatalogSettings} from '../server/services/catalogContracts';
import {openRailwayMysqlSession} from './lib/railwayMysqlSession';
import {ENVIRONMENTS} from './lib/railwayQuranOps';
const remote=await openRailwayMysqlSession(ENVIRONMENTS.production,{allowWrites:false});
// Only SELECT projections emitted by CatalogService are accepted. Query values use mysql2 escaping.
function columns(sql:string):string[]{
  assert.match(sql,/^SELECT /u);let depth=0;let quoted=false;let start=7;const fields:string[]=[];
  for(let i=7;i<sql.length;i++){
    if(sql[i]==="'"&&sql[i-1]!=='\\')quoted=!quoted;
    if(quoted)continue;if(sql[i]==='(')depth++;if(sql[i]===')')depth--;
    if(depth===0&&sql[i]===','){fields.push(sql.slice(start,i).trim());start=i+1;}
    if(depth===0&&sql.slice(i,i+6)===' FROM '){fields.push(sql.slice(start,i).trim());break;}
  }
  assert.ok(fields.length,'SELECT_PROJECTION_REQUIRED');
  return fields.map(field=>{const match=/(?:^|[.\s])([a-z_][a-z0-9_]*)$/iu.exec(field);assert.ok(match,'SELECT_ALIAS_REQUIRED');return match[1];});
}
const db:CatalogDatabase={read:async(query,params=[])=>{
  const keys=columns(query);const safeParams=params.map(p=>{if(p===null||typeof p==='string'||typeof p==='number'||typeof p==='boolean')return p;throw new Error('SHADOW_PARAMETER_NOT_APPROVED');});const formatted=mysql.format(query,safeParams);const json=keys.flatMap(k=>[mysql.escape(k),'q.`'+k+'`']).join(',');
  const raw=await remote.read(`SELECT JSON_OBJECT(${json}) FROM (${formatted}) q;`);return raw.trim().split('\n').filter(Boolean).map(r=>JSON.parse(r));
},execute:async()=>{throw new Error('PRODUCTION_SHADOW_WRITE_PROHIBITED');},transaction:async()=>{throw new Error('PRODUCTION_SHADOW_WRITE_PROHIBITED');}};
let localEnabled=false;const settings=async():Promise<CatalogSettings>=>({...await readCatalogSettings(db),enabled:localEnabled});
const service=new RecitationCatalogService(db,settings,{resolveAudioPlan:async()=>{throw new Error('NO_UNREVIEWED_PRODUCTION_AUDIO');}});
const app=express();app.use('/api/catalog',createCatalogRouter(service));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();assert.ok(address&&typeof address!=='string');
const report:Record<string,unknown>={started_at:new Date().toISOString(),target:'actual production MySQL through loopback HTTP',writes:0,production_flag_changed:false};
try{
  const before=await readCatalogSettings(db);assert.equal(before.enabled,false);
  const paths=['/reciters','/reciters/ali-al-huthaifi/recitations','/recitations/ali_al_huthaifi_mp3quran/surahs','/recitations/ali_al_huthaifi_mp3quran/chapters/1/availability'];
  const responses:Record<string,unknown>[]=[];
  for(const enabled of [false,true]){localEnabled=enabled;for(const path of paths){const r:Response=await fetch(`http://127.0.0.1:${address.port}/api/catalog${path}`);const b=await r.json();responses.push({local_override:enabled,path,status:r.status,code:b.code??null,data_count:Array.isArray(b.data)?b.data.length:null});
    if(!enabled){assert.equal(r.status,404);assert.equal(b.code,'QURAN_CATALOG_DISABLED');}
    else if(path.includes('/recitations/ali_')){assert.equal(r.status,404);assert.equal(b.code,'RECITATION_NOT_PUBLIC');}
    else{assert.equal(r.status,200);assert.deepEqual(b.data,[]);}
  }}
  assert.deepEqual(await readCatalogSettings(db),before);report.responses=responses;report.actual_flag=before;report.passed=true;
}catch(error){report.passed=false;report.failure=error instanceof Error?error.message:'UNKNOWN_FAILURE';throw new Error('D4_SHADOW_ACCEPTANCE_FAILED');}
finally{server.close();report.serial=await remote.close();report.finished_at=new Date().toISOString();writeFileSync('docs/data/d4-t3-production-shadow-api.json',JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,writes:0,flag_changed:false}));
