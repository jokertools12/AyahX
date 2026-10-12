import {readFile,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {join} from 'node:path';
const manifest=JSON.parse(await readFile('dist/.vite/manifest.json','utf8'));
function graph(key,seen=new Set(),assets=new Set()){
 if(seen.has(key))return assets;seen.add(key);const item=manifest[key];if(!item)throw new Error('MANIFEST_ENTRY_MISSING:'+key);
 assets.add(item.file);for(const css of item.css??[])assets.add(css);
 for(const dependency of item.imports??[])graph(dependency,seen,assets);return assets;
}
async function measure(keys){const assets=new Set();for(const key of keys)graph(key,new Set(),assets);const files=[];for(const name of [...assets].sort()){const bytes=await readFile(join('dist',name));files.push({name,bytes:bytes.length,gzip_bytes:gzipSync(bytes).length});}return{files,gzip_bytes:files.reduce((sum,file)=>sum+file.gzip_bytes,0)};}
const entry='index.html',publicRoot=Object.keys(manifest).find(key=>manifest[key].name==='App'),adminRoot='src/admin/AdminEntry.tsx';
if(!publicRoot)throw new Error('PUBLIC_ROOT_MISSING');
const routes=Object.keys(manifest).filter(key=>/^src\/admin\/(?:pages\/.*\.tsx|AdminKit\.tsx)$/.test(key));
const admin={};for(const route of routes)admin[route]=await measure([entry,adminRoot,route]);
admin.login=await measure([entry,adminRoot]);
const baselineIndex=process.argv.indexOf('--baseline');
if(baselineIndex>=0&&!process.argv[baselineIndex+1])throw new Error('BUNDLE_BASELINE_PATH_REQUIRED');
const baselinePath=baselineIndex<0?'docs/data/admin-bundle-before.json':process.argv[baselineIndex+1];
const before=JSON.parse(await readFile(baselinePath,'utf8'));
const publicMeasure=await measure([entry,publicRoot]);
const report={measured_at:new Date().toISOString(),baseline_path:baselinePath,method:'Gzip sum of initial entry + selected lazy root + route static imports + all CSS; route alternatives excluded',public:publicMeasure,public_before_gzip:before.public.gzip_bytes,public_change_percent:100*(publicMeasure.gzip_bytes/before.public.gzip_bytes-1),admin,public_increase_pass:publicMeasure.gzip_bytes<=before.public.gzip_bytes*1.02,admin_initial_pass:Object.values(admin).every(route=>route.gzip_bytes<=250*1024)};
await writeFile(process.argv[2]??'docs/data/admin-bundle-after.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({public_before:report.public_before_gzip,public_after:publicMeasure.gzip_bytes,change_percent:report.public_change_percent,max_admin_gzip:Math.max(...Object.values(admin).map(route=>route.gzip_bytes)),public_increase_pass:report.public_increase_pass,admin_initial_pass:report.admin_initial_pass}));
if(!report.public_increase_pass||!report.admin_initial_pass)process.exitCode=1;
