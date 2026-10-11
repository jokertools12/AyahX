import { readFile, readdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
// Compare the same entry graph rather than summing every lazy route.
const html=await readFile('dist/index.html','utf8');
const files=new Map((await Promise.all((await readdir('dist/assets')).filter(n=>/\.(js|css)$/.test(n)).map(async n=>[n,await readFile(join('dist/assets',n))]))));
const entry=/src="\/assets\/([^"]+\.js)"/.exec(html)?.[1];
if(!entry)throw new Error('ENTRY_MISSING');
function graph(name,seen=new Set()) {
  if(seen.has(name))return seen;seen.add(name);
  const contents=files.get(name)?.toString();if(!contents)throw new Error('ASSET_MISSING');
  for(const match of contents.matchAll(/(?:from|import)\s*["']\.\/([^"']+\.js)["']/g))graph(match[1],seen);
  return seen;
}
const publicAssets=[...graph(entry),...html.matchAll(/href="\/assets\/([^"]+\.css)"/g)].map(x=>typeof x==='string'?x:x[1]);
const measure=names=>({files:names.map(name=>({name,bytes:files.get(name).length,gzip_bytes:gzipSync(files.get(name)).length})),gzip_bytes:names.reduce((n,name)=>n+gzipSync(files.get(name)).length,0)});
const report={measured_at:new Date().toISOString(),public:measure([...new Set(publicAssets)]),admin:Object.fromEntries([...files.keys()].filter(n=>n.startsWith('Admin')&&n.endsWith('.js')).map(n=>[n,measure([...graph(n)])]))};
await writeFile(process.argv[2]||'docs/data/admin-bundle-after.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({public_gzip:report.public.gzip_bytes,admin_routes:Object.keys(report.admin).length}));
