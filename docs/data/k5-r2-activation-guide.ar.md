# تفعيل محوّل R2 بأمر محدود

`scripts/activate-d4-r2-storage.ts` أمر root فقط، منفصل عن allowlist العام لخطط D4. لا يغيّر schema أو public flag أو قرارات المراجعة أو بيانات الأدمن أو البيئة أو الملفات الصوتية. لم يشغّل الوكيل الفرعي هذا الأمر على قاعدة بيانات. تغيير واحد مسموح: `system_settings.key_name='storage_adapter'` إلى القيمة النصية `r2` مع `is_secret=0`، وسجل تدقيق حتمي باستخدام `D4AuditSqlPlan` وقفل `ayahx_audit_chain`.

إذا غاب الإعداد يُدرج صف واحد category=catalog؛ زيادة system_settings المسموحة هي+1 فقط. إذا وُجد url_reference يُحدّث value_text وحده ويحافظ علىcategory؛ يحرس القيمة السابقة وis_secret ووقت الصف epoch المستقر عبر timezone، ثم ROW_COUNT=1. إذا كانr2 فعلاً تصبح الخطة idempotent بلا DML ولا سجل تدقيق إضافي. لا تعديل لأي إعداد آخر، ويثبت ذلك ببصمة مستقلة لكل الصفوف الأخرى دون إخراج قيمها السرية.

## الأدلة والبوابات

الأعلام المطلوبة: `--acceptance`, `--log-scan`, `--browser`, `--variables`, `--budget`, `--sql-output`, `--report`, `--target`. ملفات الأدلة هي نتائج R2 الفعلية الحالية، ولا يقرأ الأمر مفاتيح R2. يقبل full1–7 فقط، cleanup الفعلي، NCC/lag/duration الخام عبر assertLicensedOffsetEvidence، HTTP403 لنطاق الرموز، browserSHA مطابقًا للسلسلة داخل تقرير R2، secret-scan الغلاف، وreadback متغيراتproduction للتطبيق والعامل وrender-control مع فصل read-only عنwriter. الأدلة بعمر≤24ساعة، ودليل ميزانيةworkspace بعمر≤30دقيقة، hardlimit30 والمتبقي≥3. تغيير أي byte في الأدلة يغيّر بصمة SQL وإقرارdry-run.

التطبيق علىproduction يتطلب `--apply --confirm-production --approved-dry-run <report>` و`--baseline <private Inventory>`. الـSQL حتمي ويُصدّر أولًا إلى ملف جديد خارج Git؛ apply يعيد القراءة والحساب ويقارن SHA الفعلي للملف مع الخطة وdry-run والأدلة قبل النقل. لا ينفّذ ملفSQL عشوائي، ولا يعدّل genericdata-plan allowlist. خطأ input/evidence قبل فتح الاتصال لا ينفّذ أي استعلام.

baseline يجب أن يكون inventory حاليًا، بعد اكتمال أعمالD4 السابقة، عبر أمرroot `capture-d4-production-inventory.ts`. تُقارن قاعدة9.7.2/serverUUID، بصمة القانوني وأعدادD1/D3، ثم جميع counts وCHECKSUMTABLE عدا audit_logs/system_settings اللذين لهما قواعد الاستثناء الضيقة. users/user_roles وكل الجداول البشرية محمية بالكامل. بعد التنفيذ تتكرر الفحوص وتُثبت قيمة الإعداد وذيل التدقيق وبصمة الإعدادات الأخرى. لا تُطبع بيانات المستخدم أو الإعدادات الأخرى.

SSH واحد متتابع يستخدم `RailwayMysqlSession`، وفحصthreads/maxconnections قبل النقل وقبلدفعة الكتابة. df الفعلي قبل/بعد وfree≥20%؛ SQL≤256KiB وأقل منربعmax_allowed_packet؛ دفعة واحدة ≤2صفDML. لا أحجام دفعات عامة ولا اتصالات متوازية. تقريرserial/commit/close موجود. إن فشل أي تحقق بعدcommit فالنتيجةFAILED؛ root يتولى rollback الإعداد ومراجعة سبب التراجع قبل متابعة النشر، ولا تُعلن الحالة نجاحًا.

## أوامر root

من المستودع، جهّز args بالأدلة العامة الموجودة (كل عنصر مسار ملف فعلي):

```powershell
$r2ProofArgs = @(
  '--acceptance','docs/data/d4-r2-real-acceptance.json',
  '--log-scan','docs/data/d4-r2-log-secret-scan.json',
  '--browser','docs/data/d4-r2-browser-cors.json',
  '--variables','docs/data/d4-r2-variables.json',
  '--budget','docs/data/d4-budget-resume-20261011.json'
)
# محلي فقط: scratch كامل يحتوي D1/D3 وusers/user_roles وaudit_logs وsystem_settings.
# يبدأ baseline المحلي من القراءة الفعلية؛ --baseline اختياري محليًا.
npx tsx scripts/activate-d4-r2-storage.ts --target local --local-db ayahx_d4_your_scratch --local-port 33319 --apply --sql-output "$env:TEMP/ayahx-r2-local-new.sql" --report "$env:TEMP/ayahx-r2-local-new.json" @r2ProofArgs
# production dry-run: قراءة فقط؛ استخدم baseline الحالي الملتقط بواسطة root.
npx tsx scripts/activate-d4-r2-storage.ts --target production --dry-run --baseline "$env:TEMP/ayahx-r2-before-inventory.json" --sql-output "$env:TEMP/ayahx-r2-activation-approved.sql" --report "$env:TEMP/ayahx-r2-dry-new.json" @r2ProofArgs
# بعد نجاح البروفة وdry-run: root وحده يطبّق نفس SQL والأدلة.
npx tsx scripts/activate-d4-r2-storage.ts --target production --apply --confirm-production --baseline "$env:TEMP/ayahx-r2-before-inventory.json" --approved-dry-run "$env:TEMP/ayahx-r2-dry-new.json" --sql-output "$env:TEMP/ayahx-r2-activation-approved.sql" --report "$env:TEMP/ayahx-r2-applied-new.json" @r2ProofArgs
```

اتصالMySQL المحلي loopback فقط، root وport33319 افتراضيًا، واسمDB يبدأayahx_d4_؛ كلمة المرور إن لزمت عبرMYSQL_LOCAL_PASSWORD فقط، بلاargument أوlog. لا إنشاء/حذفDB ولا خدمة محلية من الأمر. كل ملفاتSQL والتقارير تستخدمwx وترفض استبدال الملف السابق؛ لكل محاولةprivatepath جديد. لا cleanupfilesystem.

تجديد الميزانية إلى ملف جديد بعد30دقيقة يفرض dry-run جديدًا وSQL جديدًا، وكذلك أي تغيير auditseed أو baseline أو إعداد أو artifact. لا تُغيّر الأدلة لتجاوز الفشل. النشر وhealth/ready ولوج10دقائق وsmoke والـflagOFF والتحقق النهائي تبقى مسؤوليةroot وفق بوابات المستخدم؛ نجاح تغييرالإعداد ليس دليل نجاح النشر.
