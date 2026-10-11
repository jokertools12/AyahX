import {readFile,writeFile} from 'node:fs/promises';
const read=async name=>JSON.parse(await readFile(`docs/data/${name}.json`,'utf8'));
const bundle=await read('admin-bundle-after'),lh=await read('admin-lighthouse'),migration=await read('a1-production-migration-proof'),worker=await read('a2a-worker-local-acceptance'),secrets=await read('a1-secret-scan');
let shipping=null;try{shipping=await read('a1-a2a-publication');}catch(error){if(error.code!=='ENOENT')throw error;}
const status=shipping?.passed?'مكتمل مع بوابات النشر المثبتة':'القبول المحلي وتطبيق migration مكتملان؛ CI والدمج والنشر والتحقق اللاحق قيد العمل';
const links=shipping?.pull_requests?.map(item=>`[PR #${item.number}](${item.url})`).join('، ')??'لم يُفتح PR بعد في وقت توليد هذا المستند';
const max=Math.max(...Object.values(bundle.admin).map(item=>item.gzip_bytes));
const body=`# تقرير الدفعة 3 — A1 + A2a

الحالة: ${status}. آخر تحديث: ${new Date().toISOString()}. لا تنفيذ D5 ولا A2b.

## 1. ما الذي تغيّر

لوحة lazy تحت /admin/* بهوية AyahX: تسجيل الدخول، الرئيسية، الأدوار، المستخدمون (تعيين الدور فقط)، التدقيق، الإعدادات والأعلام، الأمان والجلسات؛ القراء وتفاصيل القارئ، التلاوات والمصادر، مصفوفة 114 سورة، المزوّدون، القرآن للقراءة فقط، والتوقيتات للقراءة فقط. UI Kit محلية لـsuper_admin. [فهرس الصفحات و60 لقطة](admin-pages/index.json)، [مراجعة كل صفحة بالصور](../admin-ui-review.md)، [الدليل](../admin-guide.ar.md)، [لغة التصميم](../design-language.md)، [مقارنة ستة عناصر](admin-design-parity/README.md).

RBAC لسبعة أدوار ومصفوفة قابلة للتحرير، مصادقة/Origin/Redis rate/Zod موحّدة، سجل immutable audit واحد، registry إعدادات بمستهلكين فعليين وإبطال كاش، TOTP اختياري AES-GCM ورموز استرداد مجزأة. [مصفوفة الصلاحيات المولّدة](../admin-permissions.md)، [مصفوفة الربط العام](../admin-wiring-matrix.md).

migration006 أعادت استخدام admin_roles/admin_permissions/admin_sessions/admin_user_extensions التاريخية، وأضافت permissions وadmin_auth_attempts وadmin_catalog_tasks وأعمدة إضافية، بلا تكرار جدول إعدادات أو حسابات. ترقّت صلاحيتا admin الموجودتان إلى super_admin فقط؛ كلمات المرور والهوية والبيانات الأصلية محفوظة. لا زر نشر أو اعتماد هوية صوتية/حقوق تلقائي، ولا تحرير نص قرآني أو توقيت أو سلوك ريندر.

## 2. ما تحققت منه فعليًا

نسخة production مشفرة جديدة استُعيدت بتدفق مباشر دون plaintext على القرص؛ 60 جدولًا مطابقة بالعدد وCHECKSUM على MySQL9.7.2. [النسخة](a1-backup-proof.json). up مرتان ثم down محلي وإعادة up: [بروفة006](a1-migration-local-proof.json). dry-run وapply production بنفس SHA256 ${migration.sql_sha256}، اتصال واحد وجلسات متتابعة، حراس مساحة/اتصالات وحجم packet دون تجاوز. التطبيق ${migration.elapsed_ms}ms وCOMMIT/إغلاق SSH0 مثبتان. [dry-run](a1-production-migration-dry-run.json)، [apply والتحقق](a1-production-migration-proof.json).

D1 ثابت114/6236/77433 والبصمة eca6ed31262dff3f8013160766e185c5331ef12efff3bc8989448383d40e4fe4؛ D3 ثابت422463. جميع أعداد الجداول الحرجة ثابتة، وكذلك بصمات users/profiles والأعمدة الأصلية؛ اختلاف checksum بعض الجداول الموسعة متوقع من أعمدة جديدة ومنح وصلاحيات مصرح بها. df قبل: ${migration.disk_before.available_bytes} متاح من ${migration.disk_before.total_bytes}؛ بعد: ${migration.disk_after.available_bytes}، نمو ${migration.disk_after.used_bytes-migration.disk_before.used_bytes} بايت.

قبول A1:21endpoint×7أدوار،19مجموعة فعلية على MySQL/Redis،48 كتابة مأذونة لكل منها audit واحد. قبول A2a:29endpoint×7أدوار،43 كتابة/audit واحد، وإثبات تأثير جميع عناصر مصفوفة الربط في API العام محليًا فقط. استعلامات القوائم على69تلاوة/7765فصلًا؛ مدى التوقيت يستخدم idx_timing_ready_range بـ0.383–0.484ms، أقل من50ms. [A1](a1-local-acceptance.json)، [A2aHTTP](a2a-http-acceptance.json). تشغيل server/index.ts الحقيقي كشف401 قبل parser وOrigin403 وأخطاء422 آمنة، وشغّل وأوقف العامل بصورة سليمة: [دليل الخادم](a1-actual-server-smoke.json).

العامل الحقيقي: check_links إلى ${worker.source_host} عبر TLS/HEAD، completed في ${worker.jobs[0].elapsed_ms.toFixed(1)}ms؛ إعادة حساب إتاحة stale fixture نجحت في ${worker.jobs[1].elapsed_ms.toFixed(1)}ms، مع request IDs مستقلة وأصل البيانات ثابت. لا تنزيل صوت كامل أو استضافة. [دليل العامل](a2a-worker-local-acceptance.json).

الظهور العام quran_catalog_v2 يبقى OFF إنتاجيًا. staging بقيت متوقفة؛ لم تتغير موارد production أو volumes أو صلاحيات R2. ADMIN_2FA_ENC_KEY أضيف للخادم فقط دون طباعة القيمة أو نشر مبكر. [دليل المتغير](a1-secret-variable-proof.json).

## 3. نتائج الاختبارات

| الفحص | النتيجة الفعلية |
|---|---|
| npm test -- --maxWorkers=2 |1009 ناجح،11 متخطى،0 فشل؛140 ملف ناجح/5متخطى،133.15s|
| npx tsc --noEmit |ناجح؛ solution config، يعززه فحص52جذر أدمن حقيقي بصفر أخطاء|
| TypeScript الخلفية |strict ناجح للجذور المعدلة ومراجعها مع server/types/ffprobe-static.d.ts القائمة|
| lint الملفات المتغيرة |0 رسائل جديدة؛29تحذيرًا سابقًا دون إصلاح lint العام|
| build |ناجح، frontend/server؛ لا تغيير واجهة عامة أو ريندر|
| E2Eوظيفي |20/20 جهازين:دخول،تعديل/افتراضية/ترتيب/Undo/سحب مكتبي،SVG/JSON،إعدادات،URL/فراغ،diff،مسودة Back،وXSS حرفي دون تنفيذ|
| تنقل سبعة أدوار |2/2،جدول صلاحيات فعلي لكل دور|
| صفحات axe/لقطات |14×2ثيم×2جهاز=56،صفرcritical/serious؛4لقطات دخول فارغ إضافية|
| Lighthouse الرئيسية/القراء/الإعدادات |${lh.pages.map(page=>page.path+':'+page.accessibility+'/'+page.bestPractices+' CLS='+page.cls.toFixed(5)).join('؛ ')}|
|1000صف virtualized|23tr/10بطاقات،أقصى تفاعل مختبري32ms/48ms؛INPميداني غير متاح|
| الحزمة العامة |${bundle.public_before_gzip}→${bundle.public.gzip_bytes}gzip بايت (${bundle.public_change_percent.toFixed(2)}%)،ضمن≤2%زيادة|
|أقصى مسار أدمن|${max}gzip بايت،ضمن250KiB|
| الأسرار |${secrets.known_secret_count}قيمة اعتماد معروفة،${secrets.text_files_checked}ملف نصي+لوج محلي؛صفر تسريب جديد،3تطابقات تاريخية غير معدلة مثبتة مقابل baseline|

[Types](admin-types.json)،[lint](a1-a2a-lint.json)،[الحزمة](admin-bundle-after.json)،[Lighthouse](admin-lighthouse.json)،[التفاعل المختبري](admin-interaction-performance.json)،[فحص الأسرار](a1-secret-scan.json). E2Eالنهائي01a12adc-31ec-782f-bacd-674907de411e؛الصورالمحمّلة01a12acc-d26e-7183-a414-318fbd9cd5f5. التقارير/traces/session/rawlogs خاصة وليست فيGit. mocks للوحدات فقط.

الشحن: ${links}. ${shipping?.passed?'SUCCESS للخدمات الأربع،health/ready200،smoke قراءة ونافذة10دقائق نظيفة مثبتة في [دليل النشر](a1-a2a-publication.json).':'بوابات الشحن لم تُعلن ناجحة قبل نتائجها الفعلية.'}

## 4. ما لم يكتمل أو يحتاج قرارًا

بحث D5 فقط: [التصميم المقترح](../plan/D5_DESIGN.md). HF العام RUNNING/health200 وready404؛ العامل الداخلي health200/ready503 MODEL_NOT_CONFIGURED. قراءة نموذج Base الخاص أعادت401 دون توكن، لذا **لم يُقَس CPUbenchmark** ولا تُختلق سرعة أو تكلفة. التوصية تهيئة النموذج المرخص ثم اختبار صغير حقيقي؛ لا محاذاة في هذه الدفعة. فرق ملفات مشاهيرmp3quran لا يفسره lag ثابت وحده؛ لا تخفيف العتبات.415فصلًا شبه مكتمل/914كلمة ناقصة تحتاج معالجة مصدرية ومراجعة، ومعيار MAE30/p9575 المقترح يحتاج اعتماد المستخدم قبلD5.

البسملة والصوت والترخيص والتوقيتات غير المقبولة تبقى قرارات مراجعة بشرية. مخطط إدارة الحسابات الكاملة والتوقيت ومركز المراجعةA2b خارج هذه الدفعة. لوحة الصحة لا تدّعي heartbeat للعمال إذا لم يوجد؛ تعرض حدود القياس صراحة. INP ميداني غير متاح قبل الإطلاق، وقياسinformation_schema للمساحة يستبعدredo/undo/filesystem.

## 5. المخاطر المعروفة والقرارات الذاتية

بعض جداول الأدمن التاريخية مختلفة عن أسماء الخطة؛ وُثّقت المطابقة وأعيد استخدامها. حافظنا على grants القديمة وseed مرة واحدة، وحراسة down محلية ترفض بيانات أدوار غير متوافقة. سجل audit أصبح immutable؛ التشغيل والنسخ يحتاجان مراعاة triggers. TOTPاختياري لتجنب إقفال الأدمن. بياناتاختبارA2a نسخ محلية مع سبب LOCAL_FIXTURE_ONLY، لا اعتماد صوت/حقوق أصلية.

فحص الأسرار سجّل3تطابقات تاريخية لملف.envالمحلي مقابل أمثلة اختبار/توثيق قديمة؛ لم ينسبها إلى هذه الدفعة ولم يدّع خلو تاريخGit كله. أدلة loadingالأولى استُبدلت بلقطات بعد تحميل البيانات والخطوط؛ أدلة إخفاق اختبارBack والقفل/العزل لا تُقدّم كنجاح، وتوجد إعادة فحص ناجحة بعد إصلاح السبب. حدquotaالاختبار يُعزل في RedisDB10 محليًا دون تغييرproduction أو اختبارrate الحقيقي.

الإنفاق بداية ${18.179866015894323}$؛ ${shipping?.billing?`نهاية ${shipping.billing.after}$،الفرق ${shipping.billing.after-18.179866015894323}$ على workspace كله،والمتبقي ${shipping.billing.remaining}$.`:'قبلapply18.2016927805963$،نهايةالدّفعة تنتظر القراءة.'} لا ادعاء توفير مالي معزول أو تكلفة هذه الدفعة وحدها. حد30$/تنبيه20$؛ لا تخفيضات إضافية أو تشغيلstaging/snapshot/حذف الملفات المقيدة.

## 6. الخطوة التالية

${shipping?.passed?'التوقف بعد هذا التقرير. لا D5 أو A2b دون تفويض جديد.':'استكمال PR/CI الأخضر،الدمج،SUCCESS للخدمات المتأثرة،health/ready،smoke و10دقائق لوج،وقراءة الفاتورة النهائية؛ثم التوقف دون D5/A2b.'}
`;
await writeFile('docs/data/a1-a2a-report.ar.md',body.replace(/([0-9])(?=[\u0600-\u06FF])/gu,'$1 ').replace(/([\u0600-\u06FF])(?=[0-9])/gu,'$1 '),'utf8');
const header=`# الدفعة 3 — A1 + A2a، 2026-10-11\n\n${status}. [التقرير الحالي](data/a1-a2a-report.ar.md)، [migration006 الإنتاجية](data/a1-production-migration-proof.json)، [مراجعة الواجهة والصور](admin-ui-review.md). 1009اختبار ناجح/11متخطى،20E2Eوظيفي،56axeحالة؛D1/D3ثابتان،صلاحيتا الأدمنترقّتا دون مس بياناتهما؛catalogOFF،stagingمتوقفة.\n\n`;
for(const path of ['docs/progress.md','docs/launch-blockers.md','docs/railway-ops-log.md','FEATURE_QA_LOG.md']){let text=await readFile(path,'utf8');text=text.replace(/^# الدفعة 3 — A1 \+ A2a، 2026-10-11\n[\s\S]*?\n\n(?=# )/u,'');const localHeader=path==='FEATURE_QA_LOG.md'?header.replaceAll('(data/','(docs/data/').replace('(admin-ui-review.md)','(docs/admin-ui-review.md)'):header;await writeFile(path,localHeader+text,'utf8');}
console.log(JSON.stringify({status,report:'docs/data/a1-a2a-report.ar.md'}));
