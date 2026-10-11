# دليل قبول R2 الحقيقي — اختبارات اختيارية K5 (1–7)

هذا التغيير يجهّز التشغيل فقط. لم ينفّذ الوكيل الفرعي كتابة R2 أو قاعدة بيانات أو تشغيل خدمة محلية. دليل R2 الحقيقي ينتج عندما يشغّل الوكيل الرئيسي الأوامر أدناه. لا تغيير في `storage_adapter` أو الواجهة أو الريندر الإنتاجي في هذا السكربت.

التنفيذ يقبل `ayahx-audio-staging` فقط، ويكتب تحت `test/<UUID>/`. فحص الرمز على `ayahx-audio-prod` هو `ListObjectsV2` للقراءة فقط ويتطلب HTTP 403؛ وجود bucket الإنتاج موثّق في readback منفصل. لا ينشئ bucket ولا يكتب على الإنتاج، ولا يوجد fallback محلي. كل الملفات الخاصة تبقى خارج Git ولا يحاول السكربت حذفها.

## المدخلات والأوامر

ملف credentials خاص خارج Git، بالشكل التالي؛ الكلمات بين الأقواس أسماء حقول توضيحية وليست مفاتيح فعلية:

```json
{"accountId":"[account]","endpoint":"[exact HTTPS R2 account endpoint]","staging":{"bucket":"ayahx-audio-staging","writer":{"accessKeyId":"[writer id]","secretAccessKey":"[writer secret]"},"reader":{"accessKeyId":"[reader id]","secretAccessKey":"[reader secret]"}}}
```

اضبط مسارات خاصة جديدة لكل محاولة، ثم شغّل من المستودع:

```powershell
$env:RUN_REAL_R2_ACCEPTANCE = '1'
$env:R2_ACCEPTANCE_CREDENTIAL_FILE = '[absolute private credentials file]'
$env:R2_ACCEPTANCE_REPORT = '[absolute new private report.json]'
$env:R2_ACCEPTANCE_SCRATCH = '[absolute private scratch outside Git]'
$env:R2_ACCEPTANCE_LIFECYCLE_EVIDENCE = '[absolute docs/data/d4-r2-control-plane-readback.json]'
$env:R2_ACCEPTANCE_BROWSER_EVIDENCE = '[absolute actual browser evidence.json]'
npx tsx scripts/run-r2-storage-acceptance.ts
```

الغلاف يشغّل عملية foreground ويقرأ stdout/stderr في الذاكرة فقط، ويفحص المفاتيح الفعلية وسلاسل توقيع presigned عبر حدود chunks، ولا يعرض أي مخرجات خام. يكتب ملفًا إضافيًا `<report>.captured-log-scan.json` بأعداد bytes والنتيجة فقط. لا يُحتفظ بلوج خام. نجاح القبول النهائي يتطلب تقرير الاختبارات وتقرير فحص المخرجات معًا، وليس build أو تقرير وحدات.

CI الاختياري: `npx vitest run src/test/ownedStorageAudioAcceptance.test.ts`. دون opt-in والمسارات المطلوبة يُتخطى اختبار R2 تلقائيًا؛ لا يقرأ secrets ولا ينشئ S3 client حينها. الاختبارات المحلية الأخرى تشغّل FFmpeg وffprobe فعليًا على صوت اصطناعي مملوك فقط. لا تُضف credentials أو صوتًا أو scratch أو التقارير الخاصة إلى Git. لا يحذف السكربت أي ملف filesystem، بما في ذلك checkpoint الخاص.

## مصفوفة الأدلة

| القبول | الدليل الذي ينفذه السكربت |
|---|---|
| 1 | WAV اصطناعي ≥50MiB، multipart بحجم 8MiB للأجزاء، HEAD بالحجم الفعلي، presigned GET بخمس دقائق وRange HTTP206/Content-Range/bytes، SHA-256 لكل الملفات المقروءة فعليًا |
| 2 | محاولة PUT وDELETE بالرمز read-only داخل test/ تتطلب403، وListObjectsV2 بالكاتب على bucket الإنتاج الموجود تتطلب403؛ لا يُعتبر404 إثبات صلاحية |
| 3 | ملف دليل Chromium فعلي منفصل ومقاس من الوكيل الرئيسي؛ لا يُستبدل بـOPTIONS من Node، وعدم وجوده يترك القبول pending |
| 4 | رفض >1GB قبل النقل، اختلاف HEAD/expected size، SHA خاطئ على كائن حقيقي، ملف نصي مرفوع يتنكر كصوت، MP4 اصطناعي مرفوع بامتدادm4a يحتوي مسار فيديو؛ كلها عبر خدمات التحقق الحالية وأكواد محددة |
| 5 | ثلاثة فصول اصطناعية مستقلة، SHA+ffprobe ثم offset مُقاس ثم StorageAudioPlan licensed_file ثم toRenderTimeline ثم FFmpeg حقيقي لفيديو ثانيتين وفحص وجود الصوت والفيديو والمدة وبصمة الناتج |
| 6 | checkpoint خاص بعد الجزء الأول، عميل جديد يستعيد الأجزاء من R2 ويكملها، ثم multipart آخر يحتوي جزءًا فعليًا يُلغى وListParts يُثبت404؛ readback lifecycle يوم واحد بلا حذف كائنات |
| 7 | فحص JSON لكل قيم المفاتيح الفعلية ومؤشرات التوقيع/URL، أخطاء ثابتة بلا SDK details، وغلاف foreground يفحص stdout/stderr الفعلي دون طباعته |

تسجّل الأوقات للرفع والقراءة والدورة كلها. المصروف الفعلي قبل/بعد يُقرأ من Cloudflare بواسطة الوكيل الرئيسي ويضاف إلى التقرير؛ السكربت لا يدّعي فاتورة أو توفيرًا ولا يغيّر حد الميزانية.

## offset والريندر: نطاق الإثبات

الصوت PRNG PCM غير دوري ومملوك، بثلاث seeds مستقلة. تُفك تسع نوافذ فعلًا بواسطة FFmpeg من originals والملفات المقروءة من R2، موزعة بداية/وسط/نهاية لكل فصل وبأطوال مختلفة. NCC مطبّع حول المتوسط من القيمة الخام، وبحث lag من−80 إلى+80ms (أوسع من حد قبول30ms)، والقياس الداخلي يستبعد300ms من طرفي نافذة ثانية. النجاح يظل NCC≥0.95 وفرق مدة≤30ms و|lag|≤30ms؛ لا تقريب عند الحد ولا fake callback. تغيير ملف PCM فعليًا واختبار إزاحة40ms يكشفهما الاختبار. أصل الفصل standalone0 يُقاس من نافذة البداية ولا يُفترض إذا تغيّر التسجيل.

`qudVersion=v0.0.0` معرف fixture فقط، وأرقام surah/ayah في هذا الاختبار مواقع اصطناعية لا بيانات قرآنية ولا rows DB. هذا يثبت مسار الملف/التحقق/خطة القص/FFmpeg؛ لا يثبت هوية قارئ، أو مطابقة تسجيل QUD، أو يمنح confirmed/offset_verified/published لأي تلاوة حقيقية. لا يفحص CatalogResolver بواسطة قاعدة بيانات أو يكتب مراجعات بشرية؛ ذلك يبقى في بروفة root المستقلة. `StorageAudioPlan` يبقى URL-free، والـURL الموقّع runtime فقط. تحويل التوقيت يتم في `toRenderTimeline` وحده.

استئناف multipart هو انقطاع جلسة عميل واستعادة checkpoint بعميل جديد، وليس ادعاء kill−9؛ الحقل `process_kill_test=false` صريح. lifecycle الدليل readback actualconfiguration مع إلغاء upload فعلي، وليس انتظار24ساعة أو تزوير الزمن: `expiry_observed=false`.

## دليل المتصفح وlifecycle

دليل lifecycle هو readback الحقيقي لـCloudflare `checked_at` و`results[]`؛ يبحث السكربت عن `bucket=ayahx-audio-staging,step=verify/lifecycle,success=true,status=200`، وعن قاعدة enabled / Age / maxAge86400 على prefixعام أوtest/، ويرفض أي قاعدة حذف enabled. يحتفظ فقط ببصمة الملف وتوقيته في التقرير. عمر الدليل أقل من24ساعة.

دليل Chromium المنفصل بالشكل التالي؛ قيم `true` تُكتب فقط بعد قياس فعلي:

```json
{"bucket":"ayahx-audio-staging","checked_at":"[actual UTC]","browser":"chromium","allowed_origin":"https://ayahx-staging.up.railway.app","denied_origin":"https://not-our-origin.invalid","checks":{"allowed_put":true,"allowed_get":true,"range_status":206,"disallowed_blocked":true}}
```

CORS يجب أن يسمح `if-none-match` لأن عقد PUT الحالي يوقّع If-None-Match:* لحماية immutablekeys، إضافة إلى Content-Type/Range والترويسات الضرورية المقاسة. تغيير CORS وقياس Chromium يقوم به root فقط. ملف الدليل لا يحتوي URLs موقّعة أو tokens، والقبول يسجل بصمته دون نسخ payload. عدم وجود دليل يمنع `PASSED_STORAGE_ACCEPTANCE_1_TO_7` ويخرج CLI برمز1 مع حالة pending صريحة.

## تنظيف الكائنات وأخطاء التنفيذ

finally يُلغي uploads المفتوحة المعروفة، ويحذف كل مفاتيح هذا UUID فقط، ويتحقق HEAD404 لكل كائن ثم ListObjectsV2 فارغ وListMultipartUploads فارغ على نفسprefix. عند فشل scopes قد يكون read-only PUT قد نجح فعلًا؛ مفتاحه مسجّل للتنظيف أيضًا. أي فشل تنظيف يجعل الحالةFAILED وأكوادها محفوظة، ولا تُخفى الأخطاء. لا حذف خارجtest/ ولا حذف filesystem. بعد نجاح القبول الكامل ومراجعة الأدلة، root وحده يقرر تفعيل المحوّل وفق بوابات المستخدم.
