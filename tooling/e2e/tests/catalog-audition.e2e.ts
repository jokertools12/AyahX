import {test} from '@e2e-dev/web';
import {expect} from 'e2e';
/** Opt-in actual provider playback on an injected local test fixture only. No app UI change or writes. */
test('معاينة ملف السورة الأصلي بنطاق زمني وطلب Range حقيقي', {timeout:60000},async({app,browser,screen})=>{
  test.skip(process.env.AYAHX_D4_AUDITION_SMOKE!=='1','requires explicit provider-network acceptance');
  const origin=new URL(app.baseUrl!);if(!['127.0.0.1','localhost'].includes(origin.hostname))throw new Error('LOCAL_AUDITION_FIXTURE_REQUIRED');
  await app.open('/');
  let ranged=false;
  await browser.route('https://cdn.mp3quran.net/**',async route=>{if(route.request.headers.range)ranged=true;await route.continue();});
  await browser.evaluate(()=>{
    const button=document.createElement('button');button.textContent='تشغيل عينة قبول محلية';
    const state=document.createElement('output');state.setAttribute('role','status');state.textContent='العينة جاهزة';
    const audio=document.createElement('audio');audio.preload='none';audio.src='https://cdn.mp3quran.net/audio/ali-hudhaifi/r1/001.mp3#t=1,3';
    button.onclick=()=>{audio.play().catch(()=>{state.textContent='فشل تشغيل العينة';});};
    audio.ontimeupdate=()=>{if(audio.currentTime>=1)state.textContent='بدأ النطاق عند '+audio.currentTime.toFixed(3);if(audio.currentTime>=3){audio.pause();state.textContent='انتهى النطاق';}};
    audio.onerror=()=>{state.textContent='خطأ مصدر الصوت';};
    document.body.replaceChildren(button,state,audio);
  });
  await screen.getByRole('button','تشغيل عينة قبول محلية').tap();
  await expect(screen.getByRole('status')).toHaveText('انتهى النطاق',{timeout:40000});
  const result=await browser.evaluate(()=>{const a=document.querySelector('audio')!;return {time:a.currentTime,paused:a.paused,src:a.src};});
  expect(result.time).toBeGreaterThanOrEqual(3);expect(result.time).toBeLessThan(3.5);expect(result.paused).toBe(true);expect(ranged).toBe(true);
});
