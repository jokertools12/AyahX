import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import https from 'node:https';
import type { TLSSocket } from 'node:tls';
import type { IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { CatalogError } from './catalogContracts';
import type { AdminSourceValidator,AlternateRecordingProof } from './recitationAdminService';
import { getFfmpegBinary } from './ffmpegBinary';
export interface AudioTransportEvidence { host:string; dns_addresses:string[]; connected_address:string|null; tls_authorized:boolean; certificate_sha256:string|null }
export interface AudioLinkCheck { status:string; httpStatus:number|null; checkedAt:string; finalUrl?:string; contentType?:string; contentLength?:number; retryAt?:string; retryHost?:string; redirects?:string[]; transport_evidence?:AudioTransportEvidence[] }
export type AudioDnsLookup=(host:string)=>Promise<Array<{address:string;family:number}>>;
/** The only wildcard accepted is the audited Internet Archive CDN namespace. */
export function catalogHostAllowed(host:string,hosts:readonly string[]):boolean{
  const name=host.toLowerCase();return hosts.some(h=>h.toLowerCase()===name||h==='*.us.archive.org'&&name.endsWith('.us.archive.org')&&name!== 'us.archive.org');
}
export function isPublicAudioAddress(address:string):boolean{
  const family=isIP(address);
  if(family===4){const [a,b,c]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19))||(a===192&&b===0)||(a===198&&b===51&&c===100)||(a===203&&b===0&&c===113));}
  if(family===6){const ip=address.toLowerCase();return /^[23][a-f0-9]{3}:/u.test(ip)&&!/^2001:(?:db8|0+):/u.test(ip)&&!ip.startsWith('2002:');}
  return false;
}
export function assertCatalogAudioUrl(raw:string,hosts:readonly string[]):URL{
  let url:URL;try{url=new URL(raw);}catch{throw new CatalogError('AUDIO_URL_INVALID',422);}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||(url.port&&url.port!=='443')||isIP(url.hostname.replace(/^\[|\]$/gu,'')))throw new CatalogError('AUDIO_URL_UNSAFE',422);
  if(!catalogHostAllowed(url.hostname,hosts)||url.hostname.includes('youtube')||url.hostname==='youtu.be')throw new CatalogError('AUDIO_HOST_NOT_ALLOWED',422);
  if([...url.searchParams.keys()].some(k=>/token|signature|credential|expires|x-amz|x-goog|key-pair-id|policy|^sig$|^api[_-]?key$/iu.test(k)))throw new CatalogError('SIGNED_AUDIO_URL_NOT_PERSISTABLE',422);
  return url;
}
/** Exact DB host allowlist, DNS/public-IP check and pinned address on every hop. */
export class CatalogAudioSource implements AdminSourceValidator {
  private readonly nextRequest=new Map<string,number>();
  private readonly blockedUntil=new Map<string,number>();
  constructor(private readonly lookup:AudioDnsLookup=host=>dnsLookup(host,{all:true,verbatim:true}),private readonly intervalMs=1000){}
  restoreRateLimit(host:string,retryAt:string):void{
    const until=Date.parse(retryAt);if(!/^[a-z0-9.-]+$/iu.test(host)||!Number.isFinite(until))throw new CatalogError('AUDIO_RATE_LIMIT_INVALID',503);
    if(until>Date.now())this.blockedUntil.set(host,Math.max(until,this.blockedUntil.get(host)??0));
  }
  private async addresses(host:string):Promise<Array<{address:string;family:number}>>{
    try{return await this.lookup(host);}catch(error){
      if(error&&typeof error==='object'&&'code' in error&&['ENOTFOUND','EAI_AGAIN','ETIMEOUT','ESERVFAIL'].includes(String(error.code)))throw new CatalogError('AUDIO_DNS_UNAVAILABLE',502);
      throw error;
    }
  }
  async validate(raw:string,hosts:string[]):Promise<void>{
    const url=assertCatalogAudioUrl(raw,hosts);const addresses=await this.addresses(url.hostname);
    if(!addresses.length||addresses.some(a=>!isPublicAudioAddress(a.address)))throw new CatalogError('AUDIO_DNS_UNSAFE',422);
  }
  private async request(raw:string,hosts:string[],method:'HEAD'|'GET',range?:string,signal?:AbortSignal):Promise<{response:IncomingMessage;url:URL;redirects:string[];transport_evidence:AudioTransportEvidence[]}>{
    let url=assertCatalogAudioUrl(raw,hosts);const redirects:string[]=[],transport_evidence:AudioTransportEvidence[]=[];
    for(let hop=0;hop<=5;hop++){
      signal?.throwIfAborted();
      const addresses=await this.addresses(url.hostname);if(!addresses.length||addresses.some(a=>!isPublicAudioAddress(a.address)))throw new CatalogError('AUDIO_DNS_UNSAFE',422);
      const blocked=this.blockedUntil.get(url.hostname)??0;if(blocked>Date.now())throw new CatalogError('AUDIO_RATE_LIMITED',429,{retry_at:new Date(blocked).toISOString(),retry_host:url.hostname});
      const wait=Math.max(0,(this.nextRequest.get(url.hostname)??0)-Date.now());this.nextRequest.set(url.hostname,Date.now()+wait+this.intervalMs);
      if(wait)await delay(wait,undefined,{signal});
      signal?.throwIfAborted();
      const address=addresses[0];
      const response=await new Promise<IncomingMessage>((accept,reject)=>{
        const req=https.request(url,{method,agent:false,family:address.family,signal,
          lookup:(_host,options,done)=>options.all?done(null,[address]):done(null,address.address,address.family),
          headers:{'User-Agent':'AyahX-D4-audio-catalog/1.0',Accept:'audio/*',...(range?{Range:range}:{})},timeout:20000},accept);
        req.once('timeout',()=>req.destroy(new Error('AUDIO_REQUEST_TIMEOUT')));req.once('error',()=>reject(new CatalogError('AUDIO_REQUEST_FAILED',502)));req.end();
      });
      const socket=response.socket as TLSSocket;
      const certificate=socket.getPeerCertificate?.();
      transport_evidence.push({host:url.hostname,dns_addresses:addresses.map(a=>a.address),connected_address:socket.remoteAddress??null,tls_authorized:socket.authorized===true,certificate_sha256:certificate?.fingerprint256??null});
      if(response.statusCode===429){
        const value=response.headers['retry-after'];const rawRetry=Array.isArray(value)?value[0]:value;
        const retry=rawRetry&&/^\d+$/u.test(rawRetry)?Date.now()+Number(rawRetry)*1000:rawRetry?Date.parse(rawRetry):Date.now()+60000;
        const until=Number.isFinite(retry)?Math.max(Date.now()+1000,retry):Date.now()+60000;this.blockedUntil.set(url.hostname,until);response.destroy();
        throw new CatalogError('AUDIO_RATE_LIMITED',429,{retry_at:new Date(until).toISOString(),retry_host:url.hostname});
      }
      if(response.statusCode && response.statusCode>=300&&response.statusCode<400){const location=response.headers.location;response.destroy();if(!location||hop===5)throw new CatalogError('AUDIO_REDIRECT_INVALID',502,{redirects,transport_evidence});const next=new URL(location,url).href;redirects.push(next);try{url=assertCatalogAudioUrl(next,hosts);}catch(error){if(error instanceof CatalogError)throw new CatalogError(error.code,error.status,{...error.details,redirects,transport_evidence});throw error;}continue;}
      return {response,url,redirects,transport_evidence};
    }
    throw new CatalogError('AUDIO_REDIRECT_INVALID',502);
  }
  async checkLink(raw:string,hosts:string[],signal?:AbortSignal):Promise<AudioLinkCheck>{
    const checkedAt=new Date().toISOString();
    try{
      let result=await this.request(raw,hosts,'HEAD',undefined,signal);
      if(result.response.statusCode===405||result.response.statusCode===501){result.response.destroy();result=await this.request(raw,hosts,'GET','bytes=0-1023',signal);}
      const r=result.response;const status=r.statusCode??0;const type=String(r.headers['content-type']??'');const length=Number(r.headers['content-length']??0);
      r.destroy();const available=(status===200||status===206)&&/^(?:audio\/|application\/octet-stream)/iu.test(type);
      return {status:available?'available':'source_unavailable',httpStatus:status,checkedAt,finalUrl:result.url.href,contentType:type,...(length>0?{contentLength:length}:{}),redirects:result.redirects,transport_evidence:result.transport_evidence};
    }catch(error){if(error instanceof CatalogError)return {status:error.code,httpStatus:error.status===429?429:null,checkedAt,...(Array.isArray(error.details.redirects)?{redirects:error.details.redirects as string[]}:{}),...(Array.isArray(error.details.transport_evidence)?{transport_evidence:error.details.transport_evidence as AudioTransportEvidence[]}:{}),...(error.details.retry_at?{retryAt:String(error.details.retry_at),retryHost:String(error.details.retry_host)}:{})};throw error;}
  }
  private async decodedFingerprint(raw:string,hosts:string[]):Promise<string>{
    const {response}=await this.request(raw,hosts,'GET');
    const type=String(response.headers['content-type']??'');
    if(response.statusCode!==200||!/^(?:audio\/|application\/octet-stream)/iu.test(type)){response.destroy();throw new CatalogError('AUDIO_UNAVAILABLE',502);}
    return this.streamFingerprint(response);
  }
  private async streamFingerprint(response: Readable): Promise<string>{
    // The decoder receives only the validated stream; playlists cannot open network/local-file protocols.
    const child=spawn(getFfmpegBinary(),['-nostdin','-v','error','-threads','1','-protocol_whitelist','pipe','-i','pipe:0','-map','0:a:0','-vn','-ac','1','-ar','16000','-f','s16le','pipe:1'],{stdio:['pipe','pipe','pipe']});
    const diagnostic=createHash('sha256');let diagnosticBytes=0;child.stderr.on('data',(bytes:Buffer)=>{diagnosticBytes+=bytes.length;diagnostic.update(bytes);});const hash=createHash('sha256');let input=0,output=0;
    const timer=setTimeout(()=>{response.destroy();child.kill('SIGKILL');},120000);
    const closed=new Promise<void>((accept,reject)=>{child.once('error',()=>reject(new CatalogError('AUDIO_DECODER_UNAVAILABLE',503)));child.once('close',code=>code===0?accept():reject(new CatalogError('AUDIO_DECODE_FAILED',502)));});
    const decoding=(async()=>{for await(const bytes of child.stdout){output+=bytes.length;hash.update(bytes);}})();
    response.on('data',(bytes:Buffer)=>{input+=bytes.length;if(input>96*1024*1024){response.destroy(new Error('AUDIO_SIZE_LIMIT'));child.kill('SIGKILL');}});
    try{await Promise.all([pipeline(response,child.stdin),closed,decoding]);if(diagnosticBytes)throw new CatalogError('AUDIO_DECODE_DIAGNOSTIC',422,{diagnostic_sha256:diagnostic.digest('hex')});if(!output)throw new CatalogError('AUDIO_EMPTY',502);return hash.digest('hex');}
    catch(error){response.destroy();child.kill('SIGKILL');if(error instanceof CatalogError)throw error;throw new CatalogError('AUDIO_FINGERPRINT_FAILED',502);}
    finally{clearTimeout(timer);}
  }
  async verifySameRecording(primaryUrl:string,alternateUrl:string,hosts:string[]):Promise<AlternateRecordingProof>{
    const primarySha256=await this.decodedFingerprint(primaryUrl,hosts);const alternateSha256=await this.decodedFingerprint(alternateUrl,hosts);
    if(primarySha256!==alternateSha256)throw new CatalogError('ALTERNATE_RECORDING_MISMATCH',422);
    return {primaryUrl,primarySha256,alternateSha256,verifiedAt:new Date().toISOString(),method:'decoded_audio_sha256'};
  }
  /** Reference is an authenticated verified R2 object, never a YouTube download or signed URL. */
  async verifySameRecordingStream(reference:Readable,candidateUrl:string,hosts:string[]):Promise<{primarySha256:string;alternateSha256:string;verifiedAt:string;method:'decoded_audio_sha256'}>{
    const primarySha256=await this.streamFingerprint(reference),alternateSha256=await this.decodedFingerprint(candidateUrl,hosts);
    if(primarySha256!==alternateSha256)throw new CatalogError('ALTERNATE_RECORDING_MISMATCH',422);
    return {primarySha256,alternateSha256,verifiedAt:new Date().toISOString(),method:'decoded_audio_sha256'};
  }
  async verifyRecordingFingerprint(url:string,hosts:string[],expectedSha256:string):Promise<void>{
    if(!/^[a-f0-9]{64}$/u.test(expectedSha256)||(await this.decodedFingerprint(url,hosts))!==expectedSha256)throw new CatalogError('ALTERNATE_RECORDING_MISMATCH',422);
  }
  /** Blob SHA for explicitly licensed hosted files; never a decoded SHA or a YouTube request. */
  async verifyLicensedBlob(url:string,hosts:string[],expectedSha256:string):Promise<void>{
    if(!/^[a-f0-9]{64}$/u.test(expectedSha256))throw new CatalogError('LICENSED_RECORDING_UNVERIFIED',409);
    const {response}=await this.request(url,hosts,'GET');
    if(response.statusCode!==200||!/^(?:audio\/|application\/octet-stream)/iu.test(String(response.headers['content-type']??''))){response.destroy();throw new CatalogError('LICENSED_AUDIO_UNAVAILABLE',502);}
    const hash=createHash('sha256');let bytes=0;const timer=setTimeout(()=>response.destroy(new Error('LICENSED_BLOB_TIMEOUT')),120000);
    try{for await(const chunk of response){bytes+=chunk.length;if(bytes>1_000_000_000)throw new CatalogError('AUDIO_SIZE_LIMIT',422);hash.update(chunk);}if(!bytes||hash.digest('hex')!==expectedSha256)throw new CatalogError('LICENSED_RECORDING_CHANGED',409);}
    catch(error){if(error instanceof CatalogError)throw error;throw new CatalogError('LICENSED_BLOB_CHECK_FAILED',502);}
    finally{clearTimeout(timer);response.destroy();}
  }
}
