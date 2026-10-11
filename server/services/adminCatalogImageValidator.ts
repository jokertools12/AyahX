import {lookup} from 'node:dns/promises';
import https from 'node:https';
import {CatalogError} from './catalogContracts';
import {assertCatalogAudioUrl,isPublicAudioAddress} from './catalogAudioSource';
import type {ProfileImageValidator} from './adminCatalogService';
/** No image download or storage. HEAD uses a public DNS address pinned to TLS. */
export class AdminCatalogImageValidator implements ProfileImageValidator{
  async validate(raw:string):Promise<void>{
    let initial:URL;try{initial=new URL(raw);}catch{throw new CatalogError('PROFILE_IMAGE_URL_INVALID',422);}
    const url=assertCatalogAudioUrl(raw,[initial.hostname]),addresses=await lookup(url.hostname,{all:true,verbatim:true});
    if(!addresses.length||addresses.some(address=>!isPublicAudioAddress(address.address)))throw new CatalogError('PROFILE_IMAGE_DNS_UNSAFE',422);
    const address=addresses[0];await new Promise<void>((accept,reject)=>{const request=https.request(url,{method:'HEAD',agent:false,family:address.family,lookup:(_host,options,done)=>options.all?done(null,[address]):done(null,address.address,address.family),headers:{Accept:'image/*','User-Agent':'AyahX-admin-profile/1.0'},timeout:10000},response=>{const valid=response.statusCode===200&&/^image\/(?:png|jpeg|webp|gif|avif)(?:;|$)/iu.test(String(response.headers['content-type']??''));response.destroy();if(valid)accept();else reject(new CatalogError('PROFILE_IMAGE_UNVERIFIED',422));});request.once('timeout',()=>request.destroy(new CatalogError('PROFILE_IMAGE_TIMEOUT',502)));request.once('error',()=>reject(new CatalogError('PROFILE_IMAGE_REQUEST_FAILED',502)));request.end();});
  }
}
