/** Root-owned staging test/ fixture lifecycle; no server launch, DB or provider media. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {S3LicensedAudioStorage} from '../server/services/catalogObjectStorage';
import {licensedObjectKey} from '../server/services/catalogStorageContracts';
const option=(key:string)=>{const i=process.argv.indexOf(key);assert.ok(i>=0&&process.argv[i+1],key);return process.argv[i+1];};
const privatePath=(key:string)=>{const path=resolve(option(key)),outside=relative(process.cwd(),path);assert.ok(outside==='..'||outside.startsWith('..'+sep)||isAbsolute(outside),'PRIVATE_FIXTURE_PATH_REQUIRED');return path;};
assert.equal(option('--allow'),'staging-test-prefix-only');const credential=JSON.parse(readFileSync(privatePath('--credentials'),'utf8'));
assert.equal(credential.staging.bucket,'ayahx-audio-staging');
const storage=new S3LicensedAudioStorage({accountId:credential.accountId,endpoint:credential.endpoint,bucket:credential.staging.bucket,access:'read_write',...credential.staging.writer});
const capabilitiesPath=privatePath('--capabilities'),mode=option('--mode');
try{
  if(mode==='prepare'){
    const wave=Buffer.alloc(32044);wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(16000,24);wave.writeUInt32LE(32000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(32000,40);for(let i=44;i<wave.length;i+=2)wave.writeInt16LE(Math.round(Math.sin((i-44)/32000*Math.PI*880)*1000),i);
    const sha=createHash('sha256').update(wave).digest('hex'),prefix=`test/${randomUUID()}/`,key=prefix+licensedObjectKey('owned-cors-get',1,sha,'wav'),putKey=prefix+licensedObjectKey('owned-cors-put',1,sha,'wav');
    const spec={objectKey:key,sizeBytes:wave.length,sha256:sha,contentType:'audio/wav'};
    const upload=await storage.presignPut(spec,900),response=await fetch(upload.url,{method:'PUT',headers:upload.requiredHeaders,body:new Uint8Array(wave)});assert.ok(response.ok,'OWNED_CORS_FIXTURE_UPLOAD_FAILED');assert.equal((await storage.head(key))?.sizeBytes,wave.length);
    const get=await storage.presignGet(key,900),put=await storage.presignPut({...spec,objectKey:putKey},900);
    writeFileSync(capabilitiesPath,JSON.stringify({bucket:credential.staging.bucket,keys:[key,putKey],get:get.url,put:put.url,bodyBase64:wave.toString('base64'),createdAt:new Date().toISOString()}),{flag:'wx'});
    console.log(JSON.stringify({owned_audio_bytes:wave.length,capabilities_saved_privately:true,ttl_seconds:900,bucket:credential.staging.bucket}));
  }else{
    assert.equal(mode,'cleanup');const capability=JSON.parse(readFileSync(capabilitiesPath,'utf8'));assert.equal(capability.bucket,credential.staging.bucket);assert.equal(capability.keys.length,2);for(const key of capability.keys){assert.match(key,/^test\/[a-f0-9-]+\/licensed\/owned-cors-/u);await storage.deleteObject(key);assert.equal(await storage.head(key),null,'CORS_FIXTURE_CLEANUP_FAILED');}
    const report={checked_at:new Date().toISOString(),actual_r2:true,bucket:credential.staging.bucket,test_objects_deleted:2,deleted_verified_by_head:true,no_provider_audio:true};writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
  }
}catch{throw new Error('R2_CORS_FIXTURE_FAILED');}finally{storage.close();}
