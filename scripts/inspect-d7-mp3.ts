/** Root-only, read-only bounded MP3 header diagnosis; never emits an audio URL. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { get } from 'node:https';
import mysql from 'mysql2/promise';
import { CatalogRenderManifestService } from '../server/services/catalogRenderManifest';
import { CatalogAudioSource } from '../server/services/catalogAudioSource';
import { catalogDatabaseFromPool } from '../server/services/catalogMysqlDatabase';
const matrix=JSON.parse(await readFile(process.argv[2],'utf8'));
const pool=mysql.createPool({host:'127.0.0.1',port:33319,user:'root',database:'ayahx_d2_d7_restored_20261011',connectionLimit:1});
try{
 const builder=new CatalogRenderManifestService({db:catalogDatabaseFromPool(pool),source:new CatalogAudioSource()});
 for(const item of matrix.cases.filter((row:{id:string})=>row.id.endsWith('long-last-ten'))){
  const manifest=await builder.build(item.request),identity=manifest.audioPlan.sourceIdentity;
  assert.equal(identity.kind,'external_url');if(identity.kind!=='external_url')throw new Error('EXTERNAL_REQUIRED');
  const bytes=await new Promise<Buffer>((resolve,reject)=>{get(identity.url,{headers:{Range:'bytes=0-65535','User-Agent':'AyahX-D7-RenderLab/2.0'}},response=>{if(response.statusCode!==206){response.destroy();reject(new Error('RANGE_REQUIRED'));return;}const chunks:Buffer[]=[];response.on('data',(chunk:Buffer)=>chunks.push(chunk));response.on('end',()=>resolve(Buffer.concat(chunks)));response.on('error',()=>reject(new Error('HEADER_READ_FAILED')));}).on('error',()=>reject(new Error('HEADER_REQUEST_FAILED')));});
  let pos=0;if(bytes.toString('ascii',0,3)==='ID3'){pos=10+((bytes[6]&127)<<21)+((bytes[7]&127)<<14)+((bytes[8]&127)<<7)+(bytes[9]&127);}
  const frames=[];
  for(;pos+4<bytes.length;){const h=bytes.readUInt32BE(pos),version=(h>>>19)&3,layer=(h>>>17)&3,bi=(h>>>12)&15,si=(h>>>10)&3,pad=(h>>>9)&1,mode=(h>>>6)&3;
   if((h>>>21)!==2047||version===1||layer!==1||bi===0||bi===15||si===3){pos++;continue;}
   const rate=[44100,48000,32000][si]/(version===3?1:version===2?2:4),bitrate=(version===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[bi];
   const length=Math.floor((version===3?144000:72000)*bitrate/rate)+pad;
   const frame=bytes.subarray(pos,pos+length),xing=Math.max(frame.indexOf('Xing'),frame.indexOf('Info')),lame=frame.indexOf('LAME');
   frames.push({offset:pos,version,rate,bitrate,pad,length,mode,xing:xing<0?null:{tag:frame.toString('ascii',xing,xing+4),flags:frame.readUInt32BE(xing+4),frames:frame.readUInt32BE(xing+8),bytes:frame.readUInt32BE(xing+12)},lame:lame<0?null:{tag:frame.toString('ascii',lame,lame+9),delay:(frame[lame+21]<<4)|(frame[lame+22]>>>4),padding:((frame[lame+22]&15)<<8)|frame[lame+23]}});pos+=length;
  }
  console.log(JSON.stringify({id:item.id,probe_bytes:bytes.length,frames:frames.length,first:frames.slice(0,3),bitrates:[...new Set(frames.map(f=>f.bitrate))],rates:[...new Set(frames.map(f=>f.rate))]}));
 }
}finally{await pool.end();}
