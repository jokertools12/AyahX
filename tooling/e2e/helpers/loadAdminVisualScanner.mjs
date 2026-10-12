import {readFile} from 'node:fs/promises';
import {transform} from '../../../node_modules/esbuild/lib/main.js';

/** Compile independently of tsx's keepNames instrumentation. A function passed
 * to page.evaluate must not refer to esbuild's module-level __name helper. */
export async function loadAdminVisualScanner(){
 const source=await readFile(new URL('./adminVisualScanner.ts',import.meta.url),'utf8');
 const compiled=await transform(source,{loader:'ts',format:'iife',globalName:'AyahXVisual',keepNames:false,target:'es2022'});
 return new Function(compiled.code+';return AyahXVisual.scanAdminVisualDocument;')();
}
