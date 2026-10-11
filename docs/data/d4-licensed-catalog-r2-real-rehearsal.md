# قبول MySQL وR2 في التشغيل نفسه

سكربت `scripts/test-d4-licensed-catalog-r2-real.ts` أُعدّ ليشغّله الجذر فقط. لم يشغّله الوكيل الذي كتب الكود، لذلك لا يثبت هذا المستند نجاحًا فعليًا.

```powershell
npx tsx scripts/test-d4-licensed-catalog-r2-real.ts --template ayahx_d4_catalog_20261010 --database ayahx_d4_licensed_acceptance_r2_20261011 --licensed-rehearsal docs/data/d4-licensed-publication-three-checks-scratch.json --r2-credentials C:/Users/cpazi/AppData/Local/AyahX/private-r2/credentials.json --r2-scratch C:/Users/cpazi/AppData/Local/AyahX/private-r2/sql-acceptance --report docs/data/d4-licensed-catalog-r2-real-acceptance.json
```

مسارا credentials وscratch في المثال توضيحيان؛ يستخدم الجذر المسارات الخاصة الفعلية الموجودة عنده. ملف credentials له الشكل المستخدم في بروفة R2 السابقة: `accountId` و`endpoint` و`staging.bucket` و`staging.writer` و`staging.reader`، وكل حساب منهما له accessKeyId وsecretAccessKey. لا تُعرض قيم الملف في التقرير أو اللوج.

المجال محصور بـMySQL9.7.2 على127.0.0.1:33319 وقاعدة جديدة يبدأ اسمها بـayahx_d4_licensed_acceptance_، وbucket **ayahx-audio-staging** وبادئة **test/UUID/** جديدة. لا تتصل البروفة بـproduction ولا تنسخ بيانات users/user_roles. تنسخ DDL الحقيقي وجداول النص القانوني الثلاثة من النموذج المحلي، وتستخدم مصدرها الفعلي دون اختلاق جداول من خطة قديمة. يتطلب السكربت تقرير البروفة الجديد الذي يشمل offset/publish/slice، وتعبير slice القديم الفعلي، وبصمات المصدر الحالية.

التنفيذ الحقيقي يجمع:

- ثلاثة WAV مولّدة نملكها، مع أطوال مختلفة. طول الفصل الأول يكفي حدود توقيت الفصل القانوني المنسوخ؛ الضوضاء ليست تلاوة قرآن ولا دليل هوية صوتية.
- upload إلى مفتاح immutable، وHEAD وGET عبر credentials قراءة منفصلة، وSHA فعلي للبايتات، وffprobe ومحاذاة مقاسة بين WAV الأصلية والمنزلة باستخدام helper المملوك سابقًا.
- رفض توقيت ينتهي بعد مدة بايتات R2 الفعلية بأكثر من 30ms، قبل أي إرفاق مصدر. تستخدم الحالة السلبية الملف المملوك نفسه وffprobe والـ offset الحقيقيين، ولا تغيّر بيانات إنتاج أو توقيتات QUD.
- rows وJOIN وCHECK ومعاملات MySQL الفعلية، وحقوق بشرية **fixtures محلية اصطناعية** لا تمنح حقوق إنتاج. فرع resolver يأخذ S3LicensedAudioStorage الفعلي للقراءة فقط.
- AudioPlan حقيقي، وGET مؤقت حقيقي بحد900 ثانية، وSHA للملف المنزّل من الرابط الناتج، وFFmpeg يخرج فيديو خاصًا بصوت نافذة AudioPlan نفسها، ثم ffprobe يقيس مدته ويتأكد من audio/video streams.
- فصل واحد مرخّص لا يمنح بقية الفصول؛ cache مبالغ فيه عمدًا. flag OFF يمنع قراءة التخزين، وسحب الحقوق أو تغيّر surah في storage object يمنع LaunchReadiness/availability، ويبقى offset_verified=false وحالته العالمية الأصلية ثابتة.
- audit metadata دون رابط موقّع أو capability. جميع أخطاء النقل/SDK تُختزل إلى codes ثابتة، والتقرير يمر بفحص أسرار قبل كتابته.

تنظيف السحابة يحذف مفاتيح التشغيل الثلاثة فقط بعد التحقق من بادئتها، ويتحقق بـHEAD=null، وبقائمة بادئة فارغة وعدم بقاء multipart uploads فيها. لا يبدأ السكربت multipart أصلًا. تُترك الملفات المحلية والفيديو وscratch database للأدلة وتُغلق الاتصالات. لا يصبح actual_r2_acceptance=true إلا بعد نجاح مراحل SQL والتخزين والرندر والتنظيف معًا.

بروفة النقل المعزول السابقة تشخيص محلي منفصل، وليست بديلًا عن تقرير هذا السكربت. هذا الاختبار أيضًا لا يثبت صحة أي ملف قرآن خارجي أو هوية قارئ أو إذن قانوني حقيقي.
