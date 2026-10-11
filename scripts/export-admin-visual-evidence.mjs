/** Export only reviewed, resized screenshots; never copy sessions, traces or credentials. */
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {createCanvas,loadImage} from '@napi-rs/canvas';
async function files(dir){const result=[];for(const item of await readdir(dir,{withFileTypes:true})){const path=join(dir,item.name);if(item.isDirectory())result.push(...await files(path));else if(item.name.endsWith('.png'))result.push(path);}return result;}
const pagesOutput=process.argv[2]??'tooling/e2e/.e2e/a1-a2a-pages-loaded';
const pagesRun=JSON.parse(await readFile(join(pagesOutput,'report.json'),'utf8')).run.id;
const sources=await files(pagesOutput);
const logins=(await files('tooling/e2e/.e2e/a1-a2a-functional-security-final')).filter(path=>path.includes('admin-login-'));
if(sources.length!==56||logins.length!==4)throw new Error('EXPECTED_56_PAGE_AND_4_LOGIN_IMAGES');
const index=[];
async function image(source,destination,crop){const bytes=await readFile(source),original=await loadImage(bytes);const [x,y,w,h]=crop??[0,0,original.width,original.height];const scale=Math.min(1,720/w),canvas=createCanvas(Math.round(w*scale),Math.round(h*scale));canvas.getContext('2d').drawImage(original,x,y,w,h,0,0,canvas.width,canvas.height);await mkdir(destination.slice(0,destination.lastIndexOf('/')),{recursive:true});await writeFile(destination,canvas.toBuffer('image/png'));index.push({file:destination,source:relative('.',source).replaceAll('\\','/'),source_sha256:createHash('sha256').update(bytes).digest('hex'),width:canvas.width,height:canvas.height,crop:crop??null});}
for(const path of [...sources,...logins]){const device=path.includes('/mobile/')||path.includes('\\mobile\\')?'mobile':'desktop';let name=path.split(/[\\/]/u).at(-1).replace(/^\d+-/u,'');if(/^admin-reciters-[a-f0-9-]{36}-/u.test(name))name=name.replace(/-[a-f0-9-]{36}-/u,'-detail-');await image(path,`docs/data/admin-pages/${device}-${name}`);if(name.includes('_kit'))await image(path,`docs/data/admin-ui-kit/${device}-${name}`);}
const baseline=await files('tooling/e2e/.e2e/artifacts');
function select(list,suffix){const result=list.find(path=>(path.includes('/desktop/')||path.includes('\\desktop\\'))&&path.endsWith(suffix));if(!result)throw new Error('IMAGE_SOURCE_MISSING');return result;}
const home=select(baseline,'001-public-home-light.png'),auth=select(baseline,'005-public-auth-light.png'),surahs=select(baseline,'003-public-surahs-light.png'),kit=select(sources,'013-admin-_kit-light.png'),recitations=select(sources,'019-admin-recitations-light.png');
const pairs=[['button',home,[840,542,200,65],kit,[995,275,120,80]],['card',surahs,[1074,317,330,207],kit,[30,218,1115,144]],['field',auth,[510,500,420,80],kit,[860,451,260,110]],['form',auth,[490,382,460,355],kit,[30,380,1115,461]],['table',surahs,[725,316,680,418],recitations,[31,465,1115,520]],['chip',home,[580,192,287,40],kit,[89,919,180,66]]];
for(const [name,site,siteCrop,admin,adminCrop]of pairs){await image(site,`docs/data/admin-design-parity/${name}-public.png`,siteCrop);await image(admin,`docs/data/admin-design-parity/${name}-admin.png`,adminCrop);}
for(const device of ['desktop','mobile']){const proof=JSON.parse(await readFile(`tooling/e2e/.e2e/admin-quality/axe-${device}.json`,'utf8'));if(proof.evidence.length!==28||proof.evidence.some(item=>item.violations.length))throw new Error('AXE_PROOF_FAILED');await writeFile(`docs/data/admin-pages/axe-${device}.json`,JSON.stringify(proof,null,2)+'\n');}
await writeFile('docs/data/admin-pages/index.json',JSON.stringify({observed_at:new Date().toISOString(),pages_run:pagesRun,functional_run:'01a12adc-31ec-782f-bacd-674907de411e',page_images:56,blank_login_images:4,images:index,notes:'Actual local MySQL/Redis/Chromium pixels, resized or cropped only; UI Kit is an explicit component demonstration. Public cards are compared with admin tables because the public page has no data table.'},null,2)+'\n');
console.log(JSON.stringify({page_images:56,blank_login_images:4,kit_images:4,parity_pairs:6,axe_critical_serious:0}));
