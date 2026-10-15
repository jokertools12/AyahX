# نقطة الاستئناف — 2026-10-15

هدف Enterprise الكامل نشط، وغير مكتمل. التفويض الأصلي يشمل GitHub وRailway
وR2 والمهاجرات مع التحقق. المشروع هو Desktop checkout؛ الحزمة المرجعية محفوظة
دون تعديل وuntracked. لا تستخدم Downloads أو worktree آخر. لا تشترِ credits
ولا تستهلك resets. آخر فحص استخدام: 19% من الأسبوع مستهلكة.

## آخر توجيه من المالك

- أكد نشر staging صراحةً، وحدد حسابيه لتهيئة owner؛ لا تسأله مجددًا عن التفويض.
- فحص DB للبيئتين وجد حسابًا مطابقًا واحدًا بكل بيئة. الهوية والمعرفات الخاصة في
  `tooling/reports/enterprise-baseline/owner-identity-staging.json` وملف production.
  لا تنشر البريد أو user IDs في Git. لم يُمنح owner بعد، ولم يلزم حذف حسابات.
- صلاحية البنية لا تلغي موافقة صاحب الوسائط على إرسالها لمزود AI أو اعتماد
  الأدمن للتوقيت. كل مصادر الكتالوج الجديدة ما زالت معطلة.

## Git والكود الحالي

- repo: jokertools12/AyahX. Baseline: 42b04fd98912081d6c967ac7ec7cb931ce4519ab.
- PR26 foundation، PR27 admin-only timing، PR28 HTTP patches، PR29 inactive catalog،
  PR30 trusted availability، PR31 capability policy: مدموجة.
- main: bb609e49ed7f014acd1fe33826f01a9bc38c3ef9. PR31 head:
  5005d64d7534a9100ca74a84825f3ff313e4e394. CI contracts/public-ui نجح؛ أكد Code Review
  نفس head. annotations: تحذيرات any قديمة في quran.ts وإشعار ترقية hosted runner.
- الفرع الحالي codex/ayahx-authority-storage: SQL002 وrunner/CLI/tests جديدة، وCI/docs.
  لم تُفتح PR لهذه الشريحة بعد. اختر الملفات صراحةً؛ لا تضف حزمة الخطة أو التقارير.

## Railway: الحالة الفعلية تتقدم على رسائل الأدوات

- project6394b364-57bc-4736-8ce1-10dcf382c1e5؛ staging e726848b-49ec-45ab-bce8-a1462dd85bc8.
- API service1ff57ef9-b793-4130-ae60-ce8392172cf8؛ deployment
  96761220-12ed-4e8d-9a8c-428516eeee38: SUCCESS، actual runtime bb609e4.
  RAILWAY_GIT_COMMIT_SHA وdeploymentID وبصمة catalogAccessPolicy تطابق المصدر المراجع؛
  ready200/database connected، logs22/0 errors، public desktop/mobile E2E10/10.
- accept-deploy أعاد cancellation مرتين رغم موافقة المالك. لاحقًا ظهر النشر أعلاه
  ولا staged patch الآن. لا تقل إن النشر ما زال معلقًا؛ تحقق من الحالة الفعلية.
- config.source.commitSha ما زال90bf8f8، بينما deployment/runtime bb609e4. سبب الفرق
  غير مثبت. لا تعتمد على pin metadata وحدها؛ تحقق من runtime والملفات لكل نشر.
  احفظ فرع النشر ثابتًا حتى terminal status والاختبار.
- production API/Skia/control/alignment بقيت42b04fd، آخر deployments SUCCESS بتاريخ
  2026-10-14. لا promotion أو SQL Enterprise على production حتى الآن.
- API preDeploy الحالي npm run db:setup. API/Skia/control startup تنفذ ensure DDL؛
  لا تبدل مستخدم DB إلى محدود الصلاحيات قبل فصل هذه المسارات واختبار النشر.
- قد تدخل الخدمة SLEEPING؛ public ready يوقظها. SSH أحيانًا أعاد account discovery
  بدل تنفيذ الأمر: تحقق من marker/JSON والمعنى، لا exit0 فقط. ملفات التشخيص داخل
  الحاوية مؤقتة وقد تزول عند إعادة الحاوية؛ أعد نسخها مع mkdir وبصمات/byte markers.

## قاعدة البيانات والنسخ الخاصة

- staging MySQL UUID6e077998-c7b7-11f1-8cb6-a2aac0196f86، version9.7.2، schema railway.
- 001 SQL SHA7c2285c32aaa29fa1d321fa48ddea09382a882d5b4efe51645684a6fbb4cc433:
  مطبق staging، pending0؛ الجداول الخمسة فارغة، disabled CHECKs باقية. حفظ24schema
  و23nonvolatile row digests؛ heartbeat capacity مستثنى من مقارنة الصفوف الحية.
- 002 **لم يطبق على railway بعد**. Backup `staging-before-authority.sql` SHA
  f9cabb5b3f067d5528ce84ed1ad91c9e275bb1879c1847c0aa7d4febf5fd61cb، 29 tables.
  restored scratch `ayahx_rehearsal_20261015_authority` بنفس DB defaults:
  utf8mb4 / utf8mb4_0900_ai_ci. Frozen12INSERT statements متطابقة مع re-dump.
- 002 rehearsal نجح: جدولان واثنان audit triggers. Baseline digest
  692a9703d2eaa328b0b1a3519e7feb7bb51137e7c599235752cdc095e5887992.
  named staging dry-run5 pending، strict SQL/FK1. Eleven negative DB checks نجحت،
  bootstrap FK cycle وrevocation/regrant نجحا؛ rollback للـfixtures، 29 جدولًا محفوظة،
  authority rows0. Astra: لا high/medium للشريحة الخاملة، ولا activation أو writer.
- Actual prefix recovery نجح على نسختين منفصلتين: ..._authority_resume_source و
  ..._authority_resume_restore. Backup حقيقي للنسخة source SHA
  086bca7b9a91cc81abea4eb861e5f92c6b46d307bc178dfd48baea21f00452a1؛ بعد إنشاء step0
  فقط، receipt-backed apply أكمل4 steps، final dry-run0، 29 جدولًا وصفوفها محفوظة.
- التقارير/receipts والسكربتات في ignored `tooling/reports/enterprise-baseline/`:
  authority-rehearsal-result.json، authority-constraints-result.json، authority-resume-result.json.
  Backup freshness24h؛ لا تعِد استعمال receipt منتهيًا ولا تحذف scratch أو بيانات.

## الشريحة المحلية التالية

1. اختبارات002:25 جديدة +43role +18catalog =86 PASS؛ app/strict TypeScript، lint، build PASS.
   Object.hasOwn استبدلت بـhasOwnProperty.call للتوافق مع app ES2020. أضف الأدلة للسجلات،
   commit/PR، انتظر CI ثم merge وnamed staging apply بنفس SQL والreceipt، وتحقق من
   schema/triggers والصفوف وpending0. لا bootstrap ضمن migration002.
2. أكمل grant/audit persistence writer/verifier وربط API وowner bootstrap على staging
   للحساب المحدد. capability policy والloader حقن فقط حاليًا، ولا authoritative store
   أو route/export wiring. sequential evidence checks ليست atomic export authorization.
3. writer يحتاج transaction locks للactor/grant/subject، audit في نفس transaction،
   payload-hash idempotency، تاريخ صلاحية المنح، revocation binding وlast-owner guard.
   existing account delete في auth.ts:273-307 يجب أن يحمي آخر owner أيضًا.
4. فصل صلاحيات DB قبل production authority activation: startup DDL موجود في index.ts،
   worker.ts، renderControl.ts؛ preDeploy db:setup أيضًا. credentials MYSQL_* فقط؛
   لا DATABASE_URL حاليًا. explicit privileged migrations ثم app user بلا schema privileges.
5. أكمل source/profile mapping والحقوق: SOURCE_REVIEW وTEXT_SOURCE_REVIEW وAUDIO_SOURCE_REVIEW
   وADDITIONAL_SOURCE_REVIEW. لا canonical mushaf/count/font approved بعد؛ OFL fonts
   candidate hashes فقط. QUD universal-ayahs URL404؛ QUL resource rights/hashes pending؛
   QF له cache/attribution/terms؛ EveryAyah isOpenLicense label ليس دليل ترخيص.
6. أكمل COVERAGE/28 tasks:9Admin/5Studio/36real presets، Browser local export، Skia+FFmpeg
   MP4 حقيقي وفحص صورة/تشكيل/صوت/توقيت/logs. لا real render acceptance جديد حتى الآن.
   dependency audit ما زال26finding؛ R2 private buckets موجودة لكن runtime غير موصول،
   و48h DB/provider expiry لم يطبقا. production بعد بوابات فعلية، لا health/build فقط.

الملكية: coordinator للموارد الخارجية وSQL/docs/CI. Sol child انتهى من runner وfixture
resume script، وLuna انتهى من source reviews وstartup privilege inventory؛ لا كتاب نشطون
في الملفات المشتركة. حد أقصى وكيلان فرعيان، لا تفويض متداخل. السجل التفصيلي في
VERIFICATION.md وDECISIONS.md؛ لا credentials أو user rows أو traces خاصة في Git.
