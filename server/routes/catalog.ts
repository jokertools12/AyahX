import { createHash } from 'node:crypto';
import { Router } from 'express';
import type { RecitationCatalogService } from '../services/recitationCatalogService';
import { CatalogError } from '../services/catalogContracts';
import { createRateLimiter } from '../middleware/rateLimiter';
import { attachResponseError,logger } from '../logger';
export function createCatalogRouter(service:RecitationCatalogService):Router{
  const router=Router();
  router.use(async(_req,res,next)=>{try{await service.requireEnabled();next();}catch(error){attachResponseError(res,error);if(error instanceof CatalogError)return res.status(error.status).set('Cache-Control','no-store').json({code:error.code,error:'كتالوج التلاوات غير متاح حاليًا'});logger.error('Catalog configuration read failed',error);return res.status(503).set('Cache-Control','no-store').json({code:'CATALOG_UNAVAILABLE',error:'تعذر قراءة كتالوج التلاوات'});}});
  router.use(createRateLimiter({windowMs:60000,max:120}));
  const route=(path:string,load:(params:Record<string,string>)=>Promise<unknown>):void=>{
    router.get(path,async(req,res)=>{
      try{
        const params=Object.fromEntries(Object.entries(req.params).map(([key,value])=>[key,String(value)]));
        const data=await load(params);const body=JSON.stringify({data});const etag='"'+createHash('sha256').update(body).digest('hex')+'"';
        // Revalidate human/public gates on every request; no stale visibility cache.
        res.set('ETag',etag).set('Cache-Control','public, max-age=0, must-revalidate');
        if(req.headers['if-none-match']?.split(',').map(s=>s.trim()).includes(etag))return res.status(304).end();
        return res.json({data});
      }catch(error){attachResponseError(res,error);if(error instanceof CatalogError)return res.status(error.status).set('Cache-Control','no-store').json({code:error.code,error:error.code,...error.details});logger.error('Catalog read failed',error);return res.status(503).set('Cache-Control','no-store').json({code:'CATALOG_UNAVAILABLE',error:'تعذر قراءة كتالوج التلاوات'});}
    });
  };
  route('/reciters',()=>service.listReciters());route('/reciters/:slug/recitations',p=>service.listRecitationsForReciter(p.slug));
  route('/recitations/:slug/surahs',p=>service.listSurahsForRecitation(p.slug));route('/recitations/:slug/chapters/:surah/availability',p=>service.getAvailability(p.slug,Number(p.surah)));
  return router;
}
