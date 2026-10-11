# تشغيل migration006 والتحقق منها

هذا ملف تشغيل للوكيل الرئيسي فقط. إعداد السكربت واختبارات النقل لا تعني تطبيقه؛ الدليل الفعلي يُكتب بعد انتهاء جلسة Railway بنجاح. لا يضيف الخادم migration إلى بدء التشغيل.

السكربت `scripts/apply-admin-foundation.ts` يستهدف production المعروفة فقط، ويعمل افتراضيًا للقراءة. يتطلب بروفة MySQL 9.7.2 حقيقية في `docs/data/a1-migration-local-proof.json` تحمل `up_twice_identical` و`down_restored_protected_data` و`reapplied` و`production_writes=0` وSHA-256 المطابقة لنفس SQL الحتمي. لا تكفي اختبارات البدائل.

قبل التطبيق يتحقق الوكيل الرئيسي من بوابات قبول الدفعة والميزانية والنسخة المشفرة المتحققة محليًا. السكربت يتحقق من عمر إثبات النسخة (أقل من 24 ساعة)، وبصمة ملف `.age`، وأعداد وبصمات جداول النسخة مقابل الإنتاج. لا يقرأ محتوى النسخة المفكوك ولا يطبع مسارها أو اتصال القاعدة. ملف baseline اختياري؛ إذا قُدّم فيجب أن تكون أعداده وبصماته وserver UUID مطابقة تمامًا.

مثال PowerShell للتشغيل بواسطة الوكيل الرئيسي، من جذر المستودع:

```powershell
$a1PrivateDirectory = Join-Path $env:LOCALAPPDATA 'AyahX/private-backups'
$a1BackupProof = Join-Path $a1PrivateDirectory 'a1-backup-verified.json'
$a1BaselineProof = Join-Path $a1PrivateDirectory 'a1-production-prewrite-inventory.json'
node node_modules/tsx/dist/cli.mjs scripts/apply-admin-foundation.ts --target production --backup $a1BackupProof --baseline $a1BaselineProof --rehearsal docs/data/a1-migration-local-proof.json
```

الـ dry-run لا يرسل أي DDL أو DML، ويكتب `docs/data/a1-production-migration-dry-run.json`: أسماء الجداول والأعمدة المخطط لها، عدد ترقيات الأدوار، وعدد صفوف permissions/grants الجديدة، وأعداد الجداول وبصماتها. يتوقف إذا كانت مساحة القرص الحرة دون 20%، أو الاتصالات عند الحد، أو MySQL غير 9.7.2، أو تغيّر D1/D3.

بعد استيفاء القبول، ينفّذ الوكيل الرئيسي أمر التطبيق الصريح:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/apply-admin-foundation.ts --target production --backup $a1BackupProof --baseline $a1BaselineProof --rehearsal docs/data/a1-migration-local-proof.json --dry-run docs/data/a1-production-migration-dry-run.json --apply --confirm-production
```

يرفض التطبيق اختلاف SHA أو حالة ما قبل الكتابة عن dry-run. يستخدم جلسة SSH واحدة واتصال MySQL واحد، والأوامر متتابعة دون إعادة محاولة تلقائية. يفحص الاتصالات قبل كل statement والمساحة قبل كل دفعة. كل دفعة ≤1000 صف، وSQL أقل من ثُمن max_allowed_packet وأقل من 256KiB. إذا احتاجت ترقية الأدمن أكثر من1000 صف يتوقف؛ لا يوسّع التفويض أو يغيّر SQL المعتمد تلقائيًا.

يُسمح فقط بتحويل الأدوار `admin→super_admin` عند seed الأول، مع تسجيل `a1_previous_role='admin'`. الأدوار التي أُسندت بعد seed لا تُرقّى عند الإعادة، ولا تُعاد صلاحيات أُزيلت عمدًا. يتحقق السكربت من الأعمدة الأصلية عبر بصمات صفوف محسوبة داخل MySQL؛ لا ينقل هويات المستخدمين أو ملفاتهم أو أسرار الجلسات أو TOTP إلى المخرجات. تبقى users/profiles كاملة ببصماتها الأصلية، وتبقى أعداد الجداول المحمية وsettings بما فيها `quran_catalog_v2` دون تغيير. يتحقق أيضًا من nullable/collation والـ ENUM والفهارس والـ triggers وأعداد الـ seeds؛ لا يزرع إعدادات الأمان الافتراضية في system_settings.

يكتب الإثبات النهائي `docs/data/a1-production-migration-proof.json` بملف مؤقت ثم rename، بعد تأكيد COMMIT وإغلاق MySQL وخروج SSH بصفر. إذا حدث فشل يكتب إثباتًا آمنًا بـ`passed=false` ورمز ثابت، ولا يصدر ادعاء قبول. لا يُستبدل ملف dry-run المعتمد بملف التطبيق.

## حدود down والتوقف بعد الفشل

DDL في MySQL يثبّت نفسه؛ COMMIT النهائي لا يجعل migration006 ذرّية. أي فشل قد يترك جزءًا من المخطط أو الـ seeds مطبقًا. لا توجد إعادة محاولة تلقائية ولا down على production. يُوقف الوكيل الرئيسي التنفيذ، ويفحص الحالة للقراءة، ثم يقرر إصلاحًا واضحًا أو استعادة النسخة وفق صلاحياته؛ إعادة التشغيل تحتاج dry-run جديدًا وبروفة/نسخة ملائمتين لحالة القاعدة.

`downAdminFoundation(db,'local-rehearsal')` مخصص لنسخة محلية قابلة للتخلص منها قبل بدء استخدام الأدمن. الحارس الموجود في الدالة يتحقق من قيمة scope ويرفض أدوارًا جديدة لا يمكن إرجاعها إلى ENUM القديم؛ **لا يتحقق بنفسه من عنوان اتصال MySQL**. لذا يجب أن يتحقق مشغّل البروفة من localhost ومن اسم مخطط محلي ومن MySQL 9.7.2، ولا يمرر إليه اتصال production مطلقًا.

يعيد down فقط ترقيات الدور التي تحمل `a1_previous_role='admin'`، ويسقط إضافات006 والـ triggers والفهارس والجداول الثلاثة وgrants ذات بادئة `a1:` وsupport المزروع. نجاحه على النسخة الأصلية يعتمد على أن support لم يكن موجودًا قبل006، كما ثبت في جرد هذه الدفعة. لا يعيد كلمات مرور أو profiles ولا يستعيد آثار عمليات أدمن لاحقة؛ ويحذف بيانات محاولات الدخول/المهام/المصادقة الجديدة. لا يُستخدم بعد إنشاء fixtures أو تغييرات جلسات/صلاحيات فعلية دون نسخة محلية جديدة؛ حارس ENUM لا يحمي تلك البيانات من الإسقاط.

اختبارات down/up مرتين تُجرى قبل fixtures وعلى الاستعادة المحلية الجديدة، ثم تُقارن الأعداد والبصمات الأصلية. الصفوف الاختبارية تبقى محلية. حساب المالك وبياناته لا يُعدّلان، وrollback الإنتاج بعد النشر يكون rollback للخدمة وفق بروتوكول الدفعة، مع المحافظة على المخطط الإضافي حتى قرار مستقل.
