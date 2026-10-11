// Unit fixtures only. Real MySQL/production acceptance is a separate CLI proof.
import { describe,it,expect,vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createCatalogRouter } from '../../server/routes/catalog';
import { RecitationCatalogService } from '../../server/services/recitationCatalogService';
import { RecitationAdminService } from '../../server/services/recitationAdminService';
import type { CatalogDatabase,CatalogSettings } from '../../server/services/catalogContracts';
describe('D4 catalog HTTP contract unit fixtures',()=>{
  it('disabled is an explicit 404 for all routes; ETag requires visibility revalidation',async()=>{
    const read=vi.fn().mockResolvedValue([]);let settings:CatalogSettings={enabled:false,availabilityMode:'complete_only'};
    const db:CatalogDatabase={read,execute:vi.fn(),transaction:vi.fn()};
    const audio={resolveAudioPlan:vi.fn()};const service=new RecitationCatalogService(db,async()=>settings,audio);
    const app=express();app.use('/api/catalog',createCatalogRouter(service));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
    const base='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/api/catalog';
    try{
      for(const path of ['/reciters','/reciters/reader/recitations','/recitations/source/surahs','/recitations/source/chapters/1/availability']){
        const response=await fetch(base+path);expect(response.status).toBe(404);expect(await response.json()).toMatchObject({code:'QURAN_CATALOG_DISABLED'});
      }
      expect(read).not.toHaveBeenCalled();settings={...settings,enabled:true};
      const open=await fetch(base+'/reciters');expect(open.status).toBe(200);expect(await open.json()).toEqual({data:[]});const etag=open.headers.get('etag');expect(etag).toBeTruthy();
      const revalidated=await fetch(base+'/reciters',{headers:{'If-None-Match':etag!}});expect(revalidated.status).toBe(304);
      settings={...settings,enabled:false};const disabledAgain=await fetch(base+'/reciters',{headers:{'If-None-Match':etag!}});expect(disabledAgain.status).toBe(404);
      expect(audio.resolveAudioPlan).not.toHaveBeenCalled();
    }finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));}
  });
  it('actor denial happens before any SQL or external network work',async()=>{
    const db:CatalogDatabase={read:vi.fn(),execute:vi.fn(),transaction:vi.fn()};const validator={validate:vi.fn(),verifySameRecording:vi.fn()};
    const admin=new RecitationAdminService(db,validator);const actor={id:'person',kind:'human' as const,permissions:new Set<string>()};
    await expect(admin.updatePresentation(actor,'id',{sort_order:1})).rejects.toMatchObject({code:'CATALOG_PERMISSION_DENIED'});
    await expect(admin.setDefault(actor,'id')).rejects.toMatchObject({code:'CATALOG_PERMISSION_DENIED'});
    await expect(admin.setPublic(actor,'id',true)).rejects.toMatchObject({code:'CATALOG_PERMISSION_DENIED'});
    await expect(admin.reviewVoice(actor,'id','confirmed','note')).rejects.toMatchObject({code:'CATALOG_PERMISSION_DENIED'});
    await expect(admin.moveRecitation(actor,'id','other','note')).rejects.toMatchObject({code:'CATALOG_PERMISSION_DENIED'});
    await expect(admin.addAlternate(actor,{recitationId:'id',surah:1,url:'https://example.com/a.mp3',priority:1})).rejects.toMatchObject({code:'CATALOG_PERMISSION_DENIED'});
    await expect(admin.disableAlternate(actor,'id')).rejects.toMatchObject({code:'CATALOG_PERMISSION_DENIED'});
    await expect(admin.setAvailabilityMode(actor,'ayah_ranges')).rejects.toMatchObject({code:'CATALOG_PERMISSION_DENIED'});
    expect(db.read).not.toHaveBeenCalled();expect(db.transaction).not.toHaveBeenCalled();expect(validator.validate).not.toHaveBeenCalled();
  });
});
