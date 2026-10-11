/** A real TS program rooted in admin sources, rather than solution-tsconfig no-op. */
import { createRequire } from 'node:module';
import { writeFile,mkdir } from 'node:fs/promises';
import { dirname,join,relative,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(join(root,'package.json')),ts=require('typescript');
const argument=name=>{const index=process.argv.indexOf(name);if(index<0)return undefined;if(!process.argv[index+1]||process.argv[index+1].startsWith('--'))throw new Error('ARGUMENT_VALUE_REQUIRED');return process.argv[index+1];};
async function main(){
 const configPath=join(root,'tsconfig.app.json'),config=ts.readConfigFile(configPath,ts.sys.readFile);
 if(config.error)throw new Error('TSCONFIG_READ_FAILED');
 const parsed=ts.parseJsonConfigFileContent({...config.config,include:['src/admin/**/*.ts','src/admin/**/*.tsx'],exclude:['**/*.test.ts','**/*.test.tsx','**/test/**','**/tests/**']},ts.sys,root,{},configPath);
 const options={...parsed.options,noEmit:true,incremental:false};
 if(!parsed.fileNames.length)throw new Error('ADMIN_TYPE_ROOTS_MISSING');
 const envFile=join(root,'src','vite-env.d.ts'),roots=[...parsed.fileNames,...(ts.sys.fileExists(envFile)?[envFile]:[])];
 const program=ts.createProgram(roots,options),all=[...parsed.errors,...ts.getPreEmitDiagnostics(program)],admin=[],external=[],global=[];
 for(const diagnostic of all){const file=diagnostic.file?relative(root,diagnostic.file.fileName).replaceAll('\\','/'):null;const position=diagnostic.file&&diagnostic.start!==undefined?diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start):undefined;const result={file,line:position?position.line+1:null,character:position?position.character+1:null,code:diagnostic.code,category:ts.DiagnosticCategory[diagnostic.category],message:ts.flattenDiagnosticMessageText(diagnostic.messageText,'\n')};if(!file)global.push(result);else if(file.startsWith('src/admin/'))admin.push(result);else external.push(result);}
 const passed=!admin.some(item=>item.category==='Error')&&!global.some(item=>item.category==='Error');
 const report={scope:'src/admin/**/*.ts(x)',observedAt:new Date().toISOString(),typescriptVersion:ts.version,rootCount:parsed.fileNames.length,roots:parsed.fileNames.map(file=>relative(root,file).replaceAll('\\','/')).sort(),adminDiagnostics:admin,externalDiagnostics:external,globalDiagnostics:global,externalDiagnosticPolicy:'Imported external source diagnostics are reported separately; no legacy application errors are repaired by this checker.',passed};
 const output=JSON.stringify(report,null,2),reportPath=resolve(argument('--report')??join(root,'docs','data','admin-types.json'));await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,output+'\n','utf8');console.log(output);if(!passed)process.exitCode=1;
}
main().catch(error=>{console.error(JSON.stringify({code:error instanceof Error&&/^[A-Z0-9_]+$/u.test(error.message)?error.message:'ADMIN_TYPE_CHECK_FAILED'}));process.exitCode=1;});
