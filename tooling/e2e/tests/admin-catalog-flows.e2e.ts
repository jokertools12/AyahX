import {test,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const enabled=process.env.AYAHX_ADMIN_E2E==='1';
interface Recording{id:string;slug:string;reciter_id:string;display_label_ar:string|null;display_label_en:string|null;generated_label_en?:string;is_default_for_reciter:number;voice_identity_status:string}
interface Reader{id:string;slug:string;name_ar:string;name_en:string|null}
interface Manifest{local_only:boolean;prefix:string;fixture:{reader:string;target:string;primary:string;secondary:string;partial:string};surah:number;reciters:Reader[];recitations:Recording[];provider:{id:string;code:string};chapters:Array<{id:string;recitation_id:string;surah:number;name_ar:string;ayah_count:number}>}
const privateDirectory=process.env.LOCALAPPDATA?join(process.env.LOCALAPPDATA,'AyahX','private-backups'):null;
const manifest:Manifest|null=enabled?JSON.parse(readFileSync(join(privateDirectory!,'a2a-browser-catalog-fixtures.json'),'utf8')):null;
const sessionFixture:{super_admin:{cookie:string}}|null=enabled?JSON.parse(readFileSync(join(privateDirectory!,'a1-browser-fixtures.json'),'utf8')):null;
function fixtures(){if(!manifest?.local_only||!manifest.prefix||!sessionFixture)throw new Error('LOCAL_CATALOG_FIXTURES_REQUIRED');const reader=manifest.reciters.find(r=>r.id===manifest.fixture.reader),target=manifest.reciters.find(r=>r.id===manifest.fixture.target),primary=manifest.recitations.find(r=>r.id===manifest.fixture.primary);if(!reader||!target||!primary)throw new Error('LOCAL_CATALOG_MANIFEST_INVALID');return {manifest,reader,target,primary};}
async function readRows<T>(browser:Browser,path:string):Promise<T[]>{const encoded=await browser.evaluate(async route=>{if(!route.startsWith('/api/'))throw new Error('SAME_ORIGIN_API_ONLY');const response=await fetch(route,{credentials:route.startsWith('/api/admin/')?'same-origin':'omit',cache:'no-store'});if(!response.ok)throw new Error('LOCAL_READ_STATUS_'+response.status);const body=await response.json();if(!Array.isArray(body.data))throw new Error('LOCAL_READ_SHAPE');return JSON.stringify(body.data);},path);return JSON.parse(encoded) as T[];}
const publicPath=(reader:Reader)=>'/api/catalog/reciters/'+encodeURIComponent(reader.slug)+'/recitations';
const listPath=(prefix:string)=>'/api/admin/catalog/recitations?limit=100&sort=sort_order&direction=asc&q='+encodeURIComponent(prefix);
async function isMobile(browser:Browser){return (await browser.evaluate(()=>innerWidth))<768;}
function recordingRow(browser:Browser,id:string,mobile:boolean){return browser.locator((mobile?'.admin-mobile-cards article':'.admin-table-desktop tbody tr')+`:has(button[aria-label="Move up ${id}"])`);}
async function undoOrder(browser:Browser){await browser.locator('[data-sonner-toast]').filter({hasText:'Recitation order saved'}).last().getByRole('button','Undo').tap();}

if(enabled)test.setup('restore local catalog fixture session',{sessions:['admin-catalog-local']},async({app,browser,session})=>{
 if(!app.baseUrl||!['127.0.0.1','localhost'].includes(new URL(app.baseUrl).hostname))throw new Error('LOCAL_CATALOG_ONLY');fixtures();
 await browser.setCookies([{domain:new URL(app.baseUrl).hostname,path:'/api/admin',name:'ayahx_admin_session',value:sessionFixture!.super_admin.cookie,httpOnly:true,sameSite:'Strict'}]);
 await browser.addInitScript(()=>localStorage.setItem('ayahx-admin-lang','en'));
 await app.open('/admin');await expect(browser.locator('h1')).toHaveText('Dashboard');await session.save('admin-catalog-local');
});
const options={session:enabled?'admin-catalog-local':undefined,timeout:120000};

test('catalog inline Enter edit and reader default reach public reads with immutable audit diff',options,async({app,browser,screen})=>{
 test.skip(!enabled,'Opt-in actual local catalog fixtures');const {manifest:m,reader,target,primary}=fixtures();
 await app.open('/admin/recitations?q='+encodeURIComponent(m.prefix));await expect(browser.locator('h1')).toHaveText('Recitations and sources');
 const before=(await readRows<Recording>(browser,listPath(m.prefix))).find(r=>r.id===primary.id)!;const original=before.display_label_en??before.generated_label_en!;
 const row=recordingRow(browser,primary.id,await isMobile(browser)),label=m.prefix+' UI label '+Date.now();
 await row.getByRole('button',original).tap();await screen.getByRole('textbox','Edit name').fill(label);await screen.getByRole('textbox','Edit name').press('Enter');
 await expect.poll(async()=> (await readRows<Recording>(browser,publicPath(reader))).find(r=>r.id===primary.id)?.display_label_en).toBe(label);
 await row.getByRole('button','Details').tap();const drawer=screen.getByRole('dialog');const defaultButton=drawer.getByRole('button','Set reader default');
 if(await defaultButton.isDisabled()){await browser.keyboard.press('Escape');await recordingRow(browser,m.fixture.secondary,await isMobile(browser)).getByRole('button','Details').tap();await drawer.getByRole('button','Set reader default').tap();await expect.poll(async()=>Number((await readRows<Recording>(browser,listPath(m.prefix))).find(r=>r.id===m.fixture.secondary)?.is_default_for_reciter)).toBe(1);await browser.keyboard.press('Escape');await row.getByRole('button','Details').tap();}
 await defaultButton.tap();
 await expect.poll(async()=>{const rows=await readRows<Recording>(browser,publicPath(reader));return {first:rows[0]?.id,selected:Number(rows.find(r=>r.id===primary.id)?.is_default_for_reciter)};}).toEqual({first:primary.id,selected:1});
 await drawer.getByRole('button','Move to another reader').tap();await drawer.getByRole('combobox','Target reader').tap();await screen.getByRole('button',target.name_en??target.name_ar).tap();await drawer.getByLabel('Move reason').fill('Local confirmation preview only');await drawer.getByRole('button','Review move impact').tap();
 const confirm=screen.getByRole('dialog').filter({hasText:'Confirm recitation move'});await expect(confirm.getByLabel('Type '+primary.slug+' to confirm')).toBeVisible();await expect(confirm.getByRole('button','Confirm')).toBeDisabled();await confirm.getByRole('button','Cancel').tap();await browser.keyboard.press('Escape');
 const auditPath='/api/admin/audit?entityId='+primary.id+'&action=recitation.presentation&limit=100';
 await expect.poll(async()=> (await readRows<{after:{display_label_en?:string}}>(browser,auditPath)).some(a=>a.after.display_label_en===label)).toBe(true);
 await app.open('/admin/audit?entityId='+primary.id+'&action=recitation.presentation');await expect(browser.locator('h1')).toHaveText('Audit log');
 const auditContainer=browser.locator(await isMobile(browser)?'.admin-mobile-cards article':'.admin-table-desktop tbody tr').first();await auditContainer.getByRole('button','Details').tap();await expect(screen.getByRole('dialog').getByText('Before')).toBeVisible();await expect(screen.getByRole('dialog').getByText('After')).toBeVisible();await expect(screen.getByRole('dialog').getByText(new RegExp(label))).toBeVisible();
 // Restore the fixture's descriptive label via the same editable UI, never a write API.
 await app.open('/admin/recitations?q='+encodeURIComponent(m.prefix));await recordingRow(browser,primary.id,await isMobile(browser)).getByRole('button',label).tap();await screen.getByRole('textbox','Edit name').fill(original);await screen.getByRole('textbox','Edit name').press('Enter');await expect.poll(async()=> (await readRows<Recording>(browser,publicPath(reader))).find(r=>r.id===primary.id)?.display_label_en).toBe(original);
});

test('catalog keyboard ordering and desktop drag persist actual ranks and Undo restores them',options,async({app,browser})=>{
 test.skip(!enabled,'Opt-in actual local catalog fixtures');const {manifest:m}=fixtures();await app.open('/admin/recitations?q='+encodeURIComponent(m.prefix));await expect(browser.locator('h1')).toHaveText('Recitations and sources');
 const before=(await readRows<Recording>(browser,listPath(m.prefix))).map(r=>r.id);expect(before.length).toBeGreaterThan(1);const mobile=await isMobile(browser),swapped=[before[1],before[0],...before.slice(2)];
 await recordingRow(browser,before[0],mobile).getByRole('button','Move down '+before[0]).press('Enter');await expect.poll(async()=> (await readRows<Recording>(browser,listPath(m.prefix))).map(r=>r.id)).toEqual(swapped);await undoOrder(browser);await expect.poll(async()=> (await readRows<Recording>(browser,listPath(m.prefix))).map(r=>r.id)).toEqual(before);
 if(!mobile){await recordingRow(browser,before[0],false).dragTo(recordingRow(browser,before[1],false));await expect.poll(async()=> (await readRows<Recording>(browser,listPath(m.prefix))).map(r=>r.id)).toEqual(swapped);await undoOrder(browser);await expect.poll(async()=> (await readRows<Recording>(browser,listPath(m.prefix))).map(r=>r.id)).toEqual(before);}
});

test('chapter matrix supports keyboard focus and stored timing SVG JSON and validators',options,async({app,browser,screen})=>{
 test.skip(!enabled,'Opt-in actual local catalog fixtures');const {manifest:m,primary}=fixtures();await app.open('/admin/availability?recitation_id='+primary.id);await expect(browser.locator('h1')).toHaveText('Chapter availability matrix');
 const buttons=browser.locator('.admin-matrix button');await expect(buttons).toHaveCount(114);await buttons.first().focus();await buttons.first().press('ArrowRight');await expect(buttons.nth(1)).toBeFocused();await buttons.nth(1).press('End');await expect(buttons.last()).toBeFocused();await buttons.last().press('Home');await expect(buttons.first()).toBeFocused();await buttons.nth(m.surah-1).focus();await buttons.nth(m.surah-1).press('Enter');
 const drawer=screen.getByRole('dialog');await expect(drawer.getByText('Timed / canonical words')).toBeVisible();await expect(drawer.getByRole('button','Copy Missing-word evidence')).toBeVisible();await drawer.getByRole('link','Read-only timing viewer').tap();await expect(browser.locator('h1')).toHaveText('Timing viewer');
 await expect(screen.getByRole('image','Stored word and segment intervals in milliseconds')).toBeVisible();await expect.poll(()=>browser.locator('.catalog-timeline rect').count()).toBeGreaterThan(0);await screen.getByRole('tab','JSON').tap();await expect(browser.locator('[role=tabpanel][data-state=active] pre')).toContainText('"legal_words"');await expect(browser.locator('[role=tabpanel][data-state=active] pre')).toContainText('"coverage_words"');await screen.getByRole('tab','Validators').tap();await expect(screen.getByRole('button','Copy Existing validator result')).toBeVisible();await expect.poll(()=>browser.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('voice gate setting changes the real public consumer and is restored through settings UI',options,async({app,browser,screen})=>{
 test.skip(!enabled,'Opt-in actual local catalog fixtures');const {manifest:m,reader}=fixtures();await app.open('/admin/settings');await expect(browser.locator('h1')).toHaveText('Settings and flags');
 const card=browser.locator('section.admin-card').filter({hasText:'voice_gate_policy'}),select=card.getByLabel('Value'),original=await select.inputValue();
 await select.selectOption({value:'require_confirmed'});await card.getByRole('button','Save').tap();await expect.poll(async()=> (await readRows<Recording>(browser,publicPath(reader))).some(r=>r.id===m.fixture.secondary)).toBe(false);
 try{await select.selectOption({value:'allow_auto_verified'});await card.getByRole('button','Save').tap();await expect.poll(async()=> (await readRows<Recording>(browser,publicPath(reader))).some(r=>r.id===m.fixture.secondary)).toBe(true);}
 finally{await select.selectOption({value:original});await card.getByRole('button','Save').tap();await expect.poll(()=>select.inputValue()).toBe(original);}
 if(original==='require_confirmed')await expect.poll(async()=> (await readRows<Recording>(browser,publicPath(reader))).some(r=>r.id===m.fixture.secondary)).toBe(false);
});

test('catalog URL filters and atomic sorting retain filters and show a real empty result',options,async({app,browser,screen})=>{
 test.skip(!enabled,'Opt-in actual local catalog fixtures');const {manifest:m}=fixtures();await app.open('/admin/recitations?q='+encodeURIComponent(m.prefix));await expect(browser.locator('h1')).toHaveText('Recitations and sources');
 await screen.getByText('Advanced filters').tap();await screen.getByLabel('Provider').selectOption({value:m.provider.code});await expect.poll(async()=>new URL(await browser.url()).searchParams.get('provider')).toBe(m.provider.code);await screen.getByLabel('Voice status').selectOption({value:'confirmed'});
 if(!await isMobile(browser)){await screen.getByRole('button','Display label').tap();await expect.poll(async()=>new URL(await browser.url()).searchParams.get('sort')).toBe('display_label_ar');await screen.getByRole('button','Display label ↑').tap();await expect.poll(async()=>Object.fromEntries(new URL(await browser.url()).searchParams)).toMatchObject({q:m.prefix,provider:m.provider.code,voice:'confirmed',sort:'display_label_ar',direction:'desc'});}
 await screen.getByRole('searchbox','Search names and provider').fill(m.prefix+'-no-existing-record-'+Date.now());await screen.getByRole('button','Search').tap();await expect(screen.getByText('No matching results')).toBeVisible();const url=new URL(await browser.url());expect(url.searchParams.get('provider')).toBe(m.provider.code);expect(url.searchParams.get('voice')).toBe('confirmed');
});

test('dirty reader drafts survive declined anchor tab and browser back then accepted back exits',options,async({app,browser,screen})=>{
 test.skip(!enabled,'Opt-in actual local catalog fixtures');const {reader}=fixtures();await app.open('/admin/reciters/'+reader.id+'?tab=recitations');await expect(browser.locator('h1')).toHaveText(reader.name_en??reader.name_ar);await screen.getByRole('tab','Profile').tap();
 const input=screen.getByLabel('Arabic name'),draft=reader.name_ar+' تعديل محلي غير محفوظ';await input.fill(draft);let denied=0;const dismiss=await browser.onDialog(async dialog=>{denied++;await dialog.dismiss();});
 await screen.getByRole('link','All readers').tap();await expect(input).toHaveValue(draft);await screen.getByRole('tab','Recitations').tap();await expect(input).toHaveValue(draft);await expect(screen.getByRole('tab','Profile')).toBeSelected();
 await browser.evaluate(()=>{history.back();return true;});await expect.poll(()=>denied).toBe(3);await expect.poll(async()=>new URL(await browser.url()).searchParams.get('tab')).toBe('profile');await expect(input).toHaveValue(draft);await dismiss();
 const accept=await browser.onDialog('accept');await browser.evaluate(()=>{history.back();return true;});await expect(screen.getByRole('tab','Recitations')).toBeSelected();await expect(screen.getByLabel('Arabic name')).toHaveCount(0);await accept();
});
