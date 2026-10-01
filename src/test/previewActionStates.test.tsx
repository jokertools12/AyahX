import fs from 'node:fs';
import ts from 'typescript';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

// Exercise the actual action JSX without media/network side effects from the
// full page. The real idle page and settings are covered by browser QA.
const source = fs.readFileSync('src/pages/PreviewPage.tsx','utf8');
const tree = ts.createSourceFile('PreviewPage.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let actionNode: ts.JsxElement | undefined;
function find(node: ts.Node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree)==='Card' && node.getText(tree).includes('serverRenderJob.isRendering ?')) actionNode=node;
  ts.forEachChild(node,find);
}
find(tree);
if (!actionNode) throw new Error('Preview action section was not found');
const action = actionNode as ts.JsxElement;
const ancestors: string[] = [];
for(let p=action.parent;p;p=p.parent) if(ts.isJsxElement(p)) ancestors.push(p.openingElement.tagName.getText(tree));
const names = new Set<string>();
function tags(node:ts.Node) {
  if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)) {
    const tag=node.tagName.getText(tree);
    if(/^[A-Z]/.test(tag)) names.add(tag);
  }
  ts.forEachChild(node,tags);
}
tags(action);
const components: Record<string,unknown>={Button,Card,CardContent,Badge,Progress,SocialShareButtons:()=>React.createElement('div',{'data-testid':'sharing'})};
for(const name of names) components[name] ??= ()=>null;
const compiled=ts.transpileModule(`function Panel(p) { const {serverRenderJob,videoRecorder,renderEngineLabel,downloadFilename,toast,surah,reciter,isPublicVideo,setIsPublicVideo,discoverTitle,setDiscoverTitle,handlePublishCloud,handleSave,isSaving,isIbtahalatMode,ibtTrackTitle,toSafeFilename,exportSettings,handleStartExport,audioLoaded,audioError,timingsLoading}=p; return (${action.getText(tree)}); }`,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
const Panel=new Function('React',...Object.keys(components),`${compiled};return Panel;`)(React,...Object.values(components)) as React.ComponentType<Record<string,unknown>>;
function fixture() {
  return {
    discoverTitle:'',setDiscoverTitle:vi.fn(),handlePublishCloud:vi.fn(),
    serverRenderJob:{isRendering:false,error:null,isCompleted:false,status:'idle',progress:35,queuePosition:2,etaSeconds:10,engine:'browser_cloud',stage:'جاري الإنتاج',videoBlob:new Blob(['cloud']),cancelActiveRender:vi.fn(),cancelRender:vi.fn(),retryRender:vi.fn(),downloadRenderedMp4:vi.fn().mockResolvedValue(undefined),reset:vi.fn()},
    videoRecorder:{isRecording:false,videoBlob:null as Blob|null,mp4Blob:null as Blob|null,isConverting:false,progress:42,convertProgress:63,stage:'جاري التسجيل',downloadMp4:vi.fn(),downloadWebm:vi.fn(),reset:vi.fn()},
    renderEngineLabel:()=> 'الإنتاج السحابي',downloadFilename:'fixture.mp4',toast:{error:vi.fn()},surah:{name:'الفاتحة',englishName:'Al-Fatiha'},reciter:{id:'fixture-reciter',name:'قارئ'},isPublicVideo:false,setIsPublicVideo:vi.fn(),handleSave:vi.fn(),isSaving:false,isIbtahalatMode:false,ibtTrackTitle:'',toSafeFilename:(s:string)=>s,exportSettings:{format:'mp4'},handleStartExport:vi.fn(),audioLoaded:true,audioError:null,timingsLoading:false,
  };
}
afterEach(cleanup);
describe('Preview action states remain direct and functional',()=>{
  it('keeps the actions outside disclosure groups and tabs',()=>{
    expect(ancestors).not.toContain('SettingsSection');
    expect(ancestors).not.toContain('TabsContent');
  });
  it.each(['ready','loading','audio-error','not-loaded'])('preserves idle export gating: %s',state=>{
    const p=fixture();p.timingsLoading=state==='loading';p.audioLoaded=state!=='not-loaded';
    render(<Panel {...p} audioError={state==='audio-error'?'failed':null}/>);
    const button=screen.getByRole('button');
    if(state==='ready') {fireEvent.click(button);expect(p.handleStartExport).toHaveBeenCalledOnce();}
    else expect(button).toBeDisabled();
  });
  it.each(['queued','rendering'])('preserves server progress and cancel behavior: %s',status=>{
    const p=fixture();Object.assign(p.serverRenderJob,{isRendering:true,status});render(<Panel {...p}/>);
    fireEvent.click(screen.getByRole('button',{name:status==='queued'?'إلغاء وبدء من جديد':'إلغاء'}));
    expect(status==='queued'?p.serverRenderJob.cancelActiveRender:p.serverRenderJob.cancelRender).toHaveBeenCalledOnce();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
  it('keeps both retry and cancel on server failure',()=>{
    const p=fixture();render(<Panel {...p} serverRenderJob={{...p.serverRenderJob,error:'تعذر الإنتاج'}}/>);
    fireEvent.click(screen.getByRole('button',{name:'إعادة المحاولة'}));fireEvent.click(screen.getByRole('button',{name:'إلغاء وبدء من جديد'}));
    expect(p.serverRenderJob.retryRender).toHaveBeenCalledOnce();expect(p.serverRenderJob.cancelActiveRender).toHaveBeenCalledOnce();
  });
  it('retains cloud download, title and publication without a duplicate library save',()=>{
    const p=fixture();p.serverRenderJob.isCompleted=true;render(<Panel {...p}/>);
    fireEvent.click(screen.getByRole('button',{name:'تحميل الفيديو (MP4 عالي الجودة)'}));
    expect(p.serverRenderJob.downloadRenderedMp4).toHaveBeenCalledWith('fixture.mp4');
    expect(screen.getByTestId('sharing')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'),{target:{value:'عنوان جديد'}});expect(p.setDiscoverTitle).toHaveBeenCalledWith('عنوان جديد');
    fireEvent.click(screen.getByRole('button',{name:'مشاركة الفيديو في اكتشف'}));expect(p.handlePublishCloud).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button',{name:'حفظ في المكتبة'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'إنشاء فيديو جديد'}));expect(p.serverRenderJob.reset).toHaveBeenCalledOnce();
  });
  it.each(['recording','converting'])('keeps local progress state: %s',state=>{
    const p=fixture();p.videoRecorder.isRecording=state==='recording';p.videoRecorder.isConverting=state==='converting';p.videoRecorder.videoBlob=state==='converting'?new Blob(['local']):null;
    render(<Panel {...p}/>);expect(screen.getByRole('progressbar')).toBeInTheDocument();expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it.each(['mp4','webm'])('exports only MP4, including legacy saved format=%s',format=>{
    const p=fixture();p.videoRecorder.videoBlob=new Blob(['local']);p.exportSettings.format=format;render(<Panel {...p}/>);
    fireEvent.click(screen.getByRole('button',{name:'تحميل الفيديو (MP4)'}));
    expect(screen.queryByRole('button',{name:/WebM/})).not.toBeInTheDocument();
    expect(p.videoRecorder.downloadMp4).toHaveBeenCalledWith('fixture.mp4');expect(p.videoRecorder.downloadWebm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'حفظ في المكتبة'}));expect(p.handleSave).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button',{name:'إنشاء فيديو جديد'}));expect(p.videoRecorder.reset).toHaveBeenCalledOnce();
  });
});
