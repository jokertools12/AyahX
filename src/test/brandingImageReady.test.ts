// @vitest-environment node
import { createCanvas } from '@napi-rs/canvas';
import { expect, it } from 'vitest';
import { NativeSceneRenderer } from '../../server/renderer/nativeSceneRenderer';
import { RenderManifestSchema } from '../../server/models/renderManifest';
import { LOGO_WATERMARK_PRESET_OPTIONS } from '../data/displayOptions';
it.each(LOGO_WATERMARK_PRESET_OPTIONS)('accepts the $value logo style for cloud production', ({value}) => {
  expect(RenderManifestSchema.shape.displaySettings.shape.logoWatermarkPreset.parse(value)).toBe(value);
});
it('draws uploaded logo pixels on the first native frame after initialization', async () => {
  const logo=createCanvas(160,80),ctx=logo.getContext('2d');ctx.fillStyle='#00ff00';ctx.fillRect(0,0,160,80);
  const scene=new NativeSceneRenderer({
    outputDimensions:{width:720,height:1280},fps:30,
    reciter:{id:'fixture',name:''},canonicalAyahRange:{surahNumber:1,surahName:'الفاتحة',startAyah:1,endAyah:1,ayahs:[{numberInSurah:1,text:'بسم الله'}]},
    timingMap:{words:[],validationStatus:'needs_review'},audio:{durationSeconds:1},
    background:{type:'color',url:'#000000',overlayOpacity:0,motionSpeed:1},
    typography:{fontFamily:'Amiri',fontSize:28,textColor:'#ffffff'},
    displaySettings:{showSurahName:false,showReciterName:false,showAyahText:false,showAyahNumber:false,logoWatermarkEnabled:true,logoWatermarkPreset:'custom',logoWatermarkUrl:logo.toDataURL('image/png'),logoWatermarkPosition:'topRight',logoWatermarkSize:110,logoWatermarkOpacity:1},
  } as any);
  try{
    await scene.init();const bytes=await scene.renderFrameRgbaBuffer(0,0);let green=0;
    for(let i=0;i<bytes.length;i+=4)if(bytes[i]<30&&bytes[i+1]>230&&bytes[i+2]<30)green++;
    expect(green).toBeGreaterThan(100);
  }finally{await scene.close();}
});
