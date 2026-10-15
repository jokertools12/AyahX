# نقطة الاستئناف — 2026-10-15

هدف Enterprise الكامل نشط وغير مكتمل. التفويض يشمل GitHub/Railway/R2 و staging
ثم production بعد البوابات، والمهاجرات مع backup/restore/rehearsal. Desktop هو
الهدف والحزمة المرجعية untracked دون تعديل. لا credits/reset ؛ آخر استخدام 35%
أسبوعيًا. المالك وافق صراحةً على staging8618dcb وحدد حسابيه؛ لا تسأله مجددًا.

## الحالة المقبولة

- repo jokertools12/AyahX ؛ baseline42b04fd98912081d6c967ac7ec7cb931ce4519ab.
- PR26–34 مدموجة؛ main`db6d67de2507a9a0e6afa765a88a9ca68b08ff1f`.
- staging API runtime/source8618dcba4cfaeaa827aad74bf56154245cde09c7 ، deployment
  cc650771-ed5c-482e-a7a2-d4f11eed30bc SUCCESS ، fileSHA متطابق، publicUI10/10.
  accept-deploy قال cancellation أولًا، ثم بعد الموافقة الدقيقة nothing_staged ؛
  حالة Railway الفعلية أظهرت النشر والنجاح. لا bypass أو استمرار عائق افتراضي.
-001/002 مطبقان staging:31tables/2audit triggers ، pending0 ؛ حفظ 28nonvolatile
  rowdigests و 29originalschemas عند 002. SQL002 SHA
  5ed73d10af7aebe0669b2c12577f3bea68242c72bee6eca8a98d5c79389c427f.
- Owner staging مهيأ ومتحقق:منحة واحدة/حدث واحد، 8capabilities ، live401/403/400/404.
  لا حذف حسابات أو تغيير كلمات مرور. الحساب والبريد و JWT و DB URI خاصة لا تدخل Git.
  private owner-bootstrap-staging-report.json و owner-bootstrap-staging-verification.json.
- production بقي baseline42b04fd ؛ لا EnterpriseSQL أو ownergrant أو promotion.
- trusted availability/grant history مفحوصان؛ محتوى/source/retention approvals
  و atomic export pinning و management UI لم تنفذ بعد. SourcesdisabledCHECKs باقية.

## حد DDL وحسابات runtime

PR34 لحدود DDL التشغيلية مدموجة في main@`db6d67de2507a9a0e6afa765a88a9ca68b08ff1f` وغير منشورة. الفرع المحلي التالي `codex/ayahx-runtime-db-grants` يضيف provisioning للحسابات الجديدة فقط؛ PR35 لم يُنشأ. حالة staging لم تتغير: API على8618dcb مع owner/audit1/1، والعمال على baseline. كل خدمات Node ما زالت على حساب DB الحالي؛ preDeploy لم يتغير.

خطة grants صريحة على31 جدولًا:24 legacy tables كاملة DML كحد توافق أعلى لا كحد أدنى لكل خدمة؛5 inactive catalog SELECT فقط؛ API يضيف audit append-only ويحدّث حقلي الإلغاء المحددين فقط في جدول المنح؛ Skia/control يقرآن authority فقط. تتطلب CLI بيئة موثوقة وURI مشغل منفصلًا، هدفًا ماديًا مطابقًا، اسم مستخدم جديدًا وmandatory_roles فارغة، وملفات خاصة جديدة؛ بعد التطبيق تتحقق من login حقيقي وSHOW GRANTS بدقة. MySQL يحتفظ ببيانات المشغل المنفصلة؛ المسار المقصود حقن URI إلى عملية SSH واحدة بعد تحميله خاصًا، بلا TCP proxy، ولم يُتحقق بعد من التسليم بعد cutover. لا تضعه في متغيرات الخدمات. DDL auto-commit؛ الفشل لا يعاد آليًا ولا يتبعه DROP.

clone مستعاد على مخطط تجريبي معزول داخل MySQL staging وبfixtures اصطناعية اجتاز51/51 تحققًا؛ API107 privilege points وSkia103. اختبرت المنع من DDL/trigger/audit/identity/account/cross-schema، grant/retry/revoke/audit rollback، owner concurrency/deletion races وحماية آخر مالك، وبقاء nonfixture users. التقرير خاص: `tooling/reports/enterprise-baseline/runtime-principal-clone-continuation-result.json`. Astra أصلح مشكلتين متوسطتين في CLI (receipt corruption وفحص physical target) وأكد خلو follow-up من high/medium. فشل clone سابق بسبب audit FOR UPDATE صُحح إلى SELECT locking read ثم نجح القبول.

6 suites/118 tests PASS، app TypeScript وisolated helper/CLI strict TypeScript وtargeted lint و`npm run build` PASS؛ CI enterprise-foundation أضيفت إليها خطوة المحدودية الجديدة لكن لم تُسجل نتيجة CI لعدم إنشاء PR35 بعد. لا provisioning حقيقي أو live secret change أو production action حاليًا. الخطوة التالية: راجع diff ثم commit وPR35/CI؛ بعد الدمج أزل preDeploy `npm run db:setup` بمسار ترحيل صريح محافظ على DDL القديمة، ثم انشر runtime boundary للخدمات الثلاث قبل أي principal/credential switch. دليل التشغيل: `docs/runtime-principals.ar.md`.

## الموارد والأدلة الخاصة

- Railway project6394b364-57bc-4736-8ce1-10dcf382c1e5.
- staging e726848b-49ec-45ab-bce8-a1462dd85bc8 ؛ production c8224c72-2cb3-4c1b-bf4e-85fe5e5309c6.
- API1ff57ef9-b793-4130-ae60-ce8392172cf8 ؛ Skia18de6ea4-108a-4346-8474-c7b05b81943b ؛
  control68eea2bb-ae45-4af7-8962-ba9e16e466fc ؛ alignmentd8558eff-68f5-4c63-b744-a103ddd743f6.
- staging MySQL UUID6e077998-c7b7-11f1-8cb6-a2aac0196f86 ، version9.7.2 ، schema railway.
- private tooling/reports/enterprise-baseline/ يحوي backups/receipts/ownerinputs ؛
  backup freshness24h. أي مهاجرة لاحقة تحتاج backup حديث/rehearsal مناسبين.
- scratch ayahx_rehearsal_20261015_authority أصبح يحوي syntheticfixtures ملتزمة
  لاختبار 23check ؛ لا تعِد استخدامه كقاعدة bootstrap فارغة. لا حذف scratch أوبيانات.
- SSHcopy كرر سابقًا maximumconnections ؛ API بلا volume أعيد نفس deployment فيمكانه
  ثمنجح gzipbundle بدلجلسات كثيرة. لا DBrestart. تحقق marker/JSON/runtimecommit ،
  لا exit0 أو source metadata وحدهما. الحاويةقدتُحذفوملفاتها مؤقتة؛ التقاريرمحفوظةمحليًا.

## بقية الهدف

عزل DB ثم sourceattemptledger/strictresolver/cache/adapters بمراجعةالحقوق والهوية،
Quran profile/count/font canonical و shaping QA ؛ AI draft/consent/adminapproval ؛
9Admin/5Studio/36presets ؛ Browserlocalexport و Skia/FFmpeg MP4 حقيقي معصوت/توقيت/logs ؛
R2 privateintegration و 48hexpiry ؛ ثم staging قبولكامل/production. لاقبولرندرجديدحتىالآن.
راجع SOURCE_REVIEW/TEXT_SOURCE_REVIEW/AUDIO_SOURCE_REVIEW/ADDITIONAL_SOURCE_REVIEW.
Audit26finding باقية؛ productionrouter6→7majorcheck ، devtools بعضهداخل runtime لل tsx ؛
concurrentlypatch/Vitest/Vite/Tailwindupgrade عملمنفصل. لا source/modelfallback صامت.

الملكية: parent للربط/index/worker/control/setup/docs/CI/external ؛ Sol أنهى settings
و queue lifecycle ؛ Astra أنهى follow-up. لاكتّابنشطون. حدأقصى 2children/لا recursive.
السجل VERIFICATION/DECISIONS/COVERAGE ؛ لا تعتمد health/build لقبولالرندر.
