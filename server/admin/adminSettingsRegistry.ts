import { z, type ZodType } from 'zod';
import type { CatalogDatabase, CatalogRow } from '../services/catalogContracts';
import { appendCatalogAudit } from '../services/catalogAudit';
import { encryptSettingSecret, isSettingsSecretEncryptionConfigured } from '../services/secretSettingsCrypto';
import { AdminError, type AdminRequestContext } from './adminContracts';
export interface AdminSettingDefinition { key: string; type: 'boolean'|'string'|'enum'|'number'; group: string; description: string; default: unknown; validator: Record<string,unknown>; isSecret: boolean; readOnly?: boolean; consumer: string[]; flag?: boolean; schema: ZodType }
const string = z.string().max(8192), boolean = z.boolean();
const definition = (key: string, type: AdminSettingDefinition['type'], group: string, description: string, fallback: unknown, schema: ZodType, validator: Record<string,unknown>, consumer: string[], extra: Partial<AdminSettingDefinition> = {}): AdminSettingDefinition => ({key,type,group,description,default:fallback,schema,validator,consumer,isSecret:false,...extra});
const ai = ['server/services/aiService.ts:getAiConfig/getImageAiConfig'];
const router = ['server/services/openRouterService.ts:getOpenRouterConfig'];
const catalog = ['server/services/recitationCatalogService.ts:readCatalogSettings'];
export const ADMIN_SETTINGS: readonly AdminSettingDefinition[] = [
 definition('AI_PROVIDER','enum','ai','مزوّد النص والصوت الصريح','',z.enum(['','openrouter','gemini','lovable','openai']),{options:['','openrouter','gemini','lovable','openai']},ai),
 definition('AI_IMAGE_PROVIDER','enum','ai','مزوّد الصور الصريح','none',z.enum(['none','gemini','openrouter']),{options:['none','gemini','openrouter']},ai),
 ...['GEMINI_IMAGE_MODEL','OPENROUTER_IMAGE_MODEL','OPENROUTER_TEXT_MODEL','OPENROUTER_TEXT_FALLBACK_MODELS','OPENROUTER_APP_NAME'].map(key=>definition(key,'string','ai','إعداد النموذج؛ النماذج البديلة مفصولة بفاصلة أو سطر','',string,{maxLength:8192},key.startsWith('OPENROUTER_TEXT')||key.endsWith('APP_NAME')?router:ai)),
 ...['OPENROUTER_API_KEY','GEMINI_API_KEY','LOVABLE_API_KEY','OPENAI_API_KEY'].map(key=>definition(key,'string','ai','مفتاح الخادم؛ يُخزن مشفّرًا ولا يُعاد للواجهة','',string,{maxLength:8192},ai,{isSecret:true})),
 ...['OPENROUTER_MODEL_FALLBACKS_ENABLED','OPENROUTER_ALLOW_PROVIDER_FALLBACKS','OPENROUTER_FREE_ONLY'].map(key=>definition(key,'boolean','ai','سياسة OpenRouter الصريحة',key==='OPENROUTER_FREE_ONLY',boolean,{},router)),
 definition('OPENROUTER_DATA_COLLECTION','enum','ai','سياسة الاحتفاظ لدى المزوّد','deny',z.enum(['allow','deny']),{options:['allow','deny']},router),
 definition('OPENROUTER_SITE_URL','string','ai','رابط الموقع في الطلبات','',z.union([z.literal(''),z.string().url().refine(value=>['http:','https:'].includes(new URL(value).protocol))]),{format:'http_url_or_empty'},router),
 definition('availability_mode','enum','quran_catalog','قاعدة عرض السور المتاحة','complete_only',z.enum(['complete_only','ayah_ranges']),{options:['complete_only','ayah_ranges']},catalog),
 definition('voice_gate_policy','enum','quran_catalog','بوابة هوية الصوت','allow_auto_verified',z.enum(['allow_auto_verified','require_confirmed']),{options:['allow_auto_verified','require_confirmed']},catalog),
 definition('show_timing_badges','boolean','quran_catalog','إظهار شارات التوقيت',true,boolean,{},['server/services/recitationCatalogService.ts:presentationSettings']),
 definition('default_attribution_text','string','quran_catalog','صيغة النسبة الافتراضية','',z.string().max(500),{maxLength:500},['server/services/recitationCatalogService.ts:presentationSettings']),
 definition('storage_adapter','enum','quran_catalog','محول التخزين التشغيلي','url_reference',z.enum(['url_reference','r2']),{options:['url_reference','r2']},catalog,{readOnly:true}),
 definition('quran_catalog_v2','boolean','features','إطلاق الكتالوج؛ يحتاج تأكيدًا مكتوبًا',false,boolean,{},catalog,{flag:true}),
 definition('admin_2fa_policy','enum','security','سياسة المصادقة الثنائية','optional',z.enum(['optional','required_for_super_admin','required_for_all']),{options:['optional','required_for_super_admin','required_for_all']},['server/admin/adminAccessService.ts:readAdminSecuritySettings']),
 definition('admin_idle_timeout_ms','number','security','مهلة خمول الجلسة بالمللي ثانية',1800000,z.number().int().min(60000).max(86400000),{min:60000,max:86400000},['server/admin/adminAccessService.ts:authenticate']),
 definition('admin_session_duration_ms','number','security','عمر الجلسة بالمللي ثانية',28800000,z.number().int().min(300000).max(604800000),{min:300000,max:604800000},['server/admin/adminAccessService.ts:login']),
];
export function parseSettingValue(def: AdminSettingDefinition, raw: string): unknown {
 if(def.type==='boolean') { if(['true','1','yes','on'].includes(raw.toLowerCase())) return true; if(['false','0','no','off',''].includes(raw.toLowerCase())) return false; throw new AdminError('ADMIN_SETTING_INVALID',503); }
 if(def.type==='number') return Number(raw);
 return raw;
}
export class AdminSettingsService {
 private cache?: {until:number;rows:CatalogRow[]};
 constructor(private readonly db:CatalogDatabase,private readonly env:NodeJS.ProcessEnv=process.env,private readonly now:()=>number=Date.now) {}
 invalidate(){this.cache=undefined;}
 async list(flags=false):Promise<CatalogRow[]> {
  if(!this.cache||this.cache.until<=this.now()) this.cache={until:this.now()+300000,rows:await this.db.read('SELECT key_name,value_text,is_secret,category,updated_at FROM system_settings')};
  const rows=this.cache.rows, known=new Set(ADMIN_SETTINGS.map(def=>def.key));
  const result=ADMIN_SETTINGS.filter(def=>Boolean(def.flag)===flags).map(def=>{
   const row=rows.find(value=>value.key_name===def.key),raw=row?String(row.value_text):this.env[def.key],secret=def.isSecret||Number(row?.is_secret)===1;
   let value:unknown=def.default, diagnostic:string|undefined;
   if(raw!==undefined&&!secret){try{value=parseSettingValue(def,raw);if(!def.schema.safeParse(value).success)diagnostic='STORED_VALUE_INVALID';}catch{value=raw;diagnostic='STORED_VALUE_INVALID';}}
   const {schema:_,flag:__,...publicDef}=def;
   return {...publicDef,value:secret?null:value,isSecret:secret,isSet:Boolean(raw),masked:secret&&Boolean(raw)?'••••••••':null,readOnly:Boolean(def.readOnly),diagnostic,updatedAt:row?.updated_at??null};
  });
  if(!flags)for(const row of rows)if(!known.has(String(row.key_name))){const secret=Number(row.is_secret)===1||/api_key|secret|token|password|credential/i.test(String(row.key_name));result.push({key:String(row.key_name),type:'string',group:String(row.category),description:'إعداد قديم دون مستهلك مسجّل',default:null,value:secret?null:String(row.value_text),validator:{},isSecret:secret,isSet:Boolean(row.value_text),masked:secret?'••••••••':null,readOnly:true,consumer:[],diagnostic:'NO_RUNTIME_CONSUMER',updatedAt:row.updated_at} as typeof result[number]);}
  return result;
 }
 async update(ctx:AdminRequestContext,flags=false):Promise<CatalogRow> {
  const def=ADMIN_SETTINGS.find(item=>item.key===ctx.params.key);
  if(!def||def.readOnly||Boolean(def.flag)!==flags)throw new AdminError('ADMIN_SETTING_READ_ONLY',409);
  if(flags&&(!ctx.user.permissions.includes('launch.manage')||ctx.body.confirmation!==def.key))throw new AdminError(ctx.user.permissions.includes('launch.manage')?'ADMIN_CONFIRMATION_REQUIRED':'ADMIN_FORBIDDEN',ctx.user.permissions.includes('launch.manage')?422:403);
  const parsed=def.schema.safeParse(ctx.body.value);if(!parsed.success)throw new AdminError('ADMIN_INPUT_INVALID',422,{fields:[{path:'value',message:'قيمة لا تطابق تعريف الإعداد'}]});
  if(def.isSecret&&!isSettingsSecretEncryptionConfigured())throw new AdminError('SETTINGS_ENCRYPTION_KEY_NOT_CONFIGURED',503);
  const plain=typeof parsed.data==='string'?parsed.data:String(parsed.data),stored=def.isSecret?encryptSettingSecret(plain):plain;
  await this.db.transaction(async tx=>{
   const [before]=await tx.read('SELECT value_text,is_secret FROM system_settings WHERE key_name=? FOR UPDATE',[def.key]);
   if(Number(before?.is_secret)===1&&!def.isSecret)throw new AdminError('ADMIN_SETTING_INVALID',409);
   await tx.execute('INSERT INTO system_settings(key_name,value_text,is_secret,category) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE value_text=VALUES(value_text),is_secret=VALUES(is_secret),category=VALUES(category)',[def.key,stored,def.isSecret?1:0,def.group]);
   await appendCatalogAudit(tx,ctx.actor,flags?'admin.flag.update':'admin.setting.update','system_setting',def.key,def.isSecret?{isSet:Boolean(before?.value_text)}:before?{value_text:before.value_text}:null,def.isSecret?{isSet:Boolean(plain)}:{value_text:plain});
  });this.invalidate();
  return (await this.list(flags)).find(row=>row.key===def.key)!;
 }
}
