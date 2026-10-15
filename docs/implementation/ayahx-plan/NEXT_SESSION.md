# نقطة الاستئناف — 2026-10-15

هدف Enterprise الكامل نشط وغير مكتمل. التفويض يشمل GitHub/Railway/R2 و staging
ثم production بعد البوابات، والمهاجرات مع backup/restore/rehearsal. Desktop هو
الهدف والحزمة المرجعية untracked دون تعديل. لا credits/reset ؛ آخر استخدام 35%
أسبوعيًا. المالك وافق صراحةً على staging8618dcb وحدد حسابيه؛ لا تسأله مجددًا.

## الحالة المقبولة

- repo jokertools12/AyahX ؛ baseline42b04fd98912081d6c967ac7ec7cb931ce4519ab.
- PR26–35 مدموجة؛ main`d040e7e11acc2b8c4590b231f4350375acc9055f`.
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

## نقطة التنفيذ الحالية

PR35 head acfca12931c1ff531fe15e80e8e8001041a75b9d مدموج؛ CI contracts38728500151
وpublicUI38728500115 SUCCESS confirmed exact-head via Code Review. Patch staging
ac4aa3ee-0a9a-493b-9e0f-d0451c3ae74a يحوي13تغييرًا غيرمدمر: API/Skia/control
مصدر main مثبت على acfca12، وإزالة API preDeploy db:setup. لا تغيير أسرار أوDB.
accept-deploy رفض بدعوى غياب الموافقة؛ فحص patch بعده يؤكد STAGED دون تطبيق.
سؤال موافقة محدد معلق؛ لا تستخدم CLI أو namespaceآخر لتجاوز الرفض. عند الرد،
افحص الحالة الفعلية أولًا ثم طبّق إن بقي التغيير؛ لا تخلط pending مع deployment.

مسار المشغّل اختبر فعليًا: قراءة credentials الخاصة بـMySQL محليًا في الذاكرة
ثم stdin إلى عملية SSH واحدة، وتحقق target بلا استعمال إعداد اتصال التطبيق.
private operator-stdin-verification.json. لا سر في argv أوstdout أوملف دائم.
أعد التحقق بعد cutover مع CLI inspect لتثبت التسليم تحت هوية التطبيق المحدودة.
SSH instance pin7277439a-80b7-47e6-b35f-c216ff0a7576 حل ردaccountdiscovery؛ حدّث
المعرف بعد النشر باستخدام ssh config --dry-run، وتحقق marker مستقل.

الفرع المحلي الجديد codex/ayahx-source-resolution-contract يبدأ من mergedmain.
SOURCE_RESOLUTION_SPEC.md تصميم فقط لـTasks1.3/2.4 قيد مراجعة Astra؛ لا migrations
أوsourcesأوnetworkcalls. Staging patch applied after explicit approval. API/Skia/control now use new runtime accounts and API preDeploy empty; API/Skia are stable, public E2E10/10 passes, but control gets SIGTERM after startup despite SUCCESS. Stale advisory connection was diagnosed/killed; repeat control restart and inspect logs before any render gate. Do not promote production or call isolation complete until control is stable and a real render artifact is accepted.

## حد DDL وحسابات runtime — الحالة الحالية

PR34 وPR35 مدموجتان؛ main عند d040e7e11acc2b8c4590b231f4350375acc9055f. Staging patch applied after explicit approval: API/Skia/control run this code, API preDeploy is empty, and three dedicated runtime accounts are active. Fresh physical checks match the staging MySQL target and authority counts remain 1/1; API health and public E2E10/10 pass. Skia is stable. Control is still operationally unstable after SIGTERM/restart; stale advisory connection19953 was diagnosed/killed without row changes, but a real render gate and production promotion remain blocked until control stabilizes.

The 24-table DML plan remains a compatibility upper bound; inactive catalog tables are SELECT-only; API authority writes are limited to audited grant/revocation fields and workers read authority only. Keep operator credentials private and separate from service variables. Production has no runtime principal or credential change.

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

## Latest migration evidence

Migration003 source-resolution ledger was rehearsed and applied on staging. It created two tables and four immutable triggers; post-apply dry-run pending0, ledger rows0/0, authority1/1. Do not wire runtime accounts yet: update the explicit privilege plan for ledger access, provision fresh v2 principals or a reviewed grant transition, then test the repository against real MySQL. Production remains untouched.

## Checkpoint 2026-10-15 — source resolver service

PR43 (`36c81697276e26ed85bcf94ee5c519ca18fd096e`) مدموج بعد نجاح Enterprise
foundation و AyahX E2E على exact head `3eeb8949e28620f6c674c6b53ffbdd9193ffacf6`.
الخدمة النقية `server/services/sourceResolutionService.ts` تسجل started/terminal
بترتيب المصادر، تفرض قرارات license/consent، تتحقق من المرشح، وتسمح fallback
فقط للأخطاء المؤقتة المسموح بها. اختبارات الخدمة الستة و typecheck التطبيق ناجحة.
لم تُربط الخدمة بعد بمسارات API أو مزودات الشبكة، لذلك لا يوجد تغيير نشر أو قبول
رندر جديد. الخطوة التالية هي ربطها بحدود المزود مع حفظ الهوية والـ hashes، ثم
إعادة اختبار staging قبل أي ترقية.

PR46 وPR47 مدموجتان بعد نجاح Enterprise foundation وAyahX E2E. PR46 أضاف
بوابة تفعيل المصدر التي تتطلب revision وأدلة endpoint/license/storage/CORS/rate
limits/identity مكتملة؛ كل المرشحين الحاليين ما زالوا disabled. PR47 أضاف
`validateResolutionCandidate` لاختيار نتيجة المصدر فقط بعد مطابقة الرواية
والمصحف والعد والنطاق وبصمات النص/الصوت والقارئ والتسجيل وحالة الاعتماد.
تشغيل الاختبارات المحلي الكامل: 103 ملفات، 869 اختبارًا ناجحًا، 6 متخطاة.
لم تُربط النتيجة بمسار API أو مزود خارجي بعد، ولم يُنشر هذا التغيير إلى Railway.

## 2026-10-16 checkpoint — R2 wiring ready, credential gate remains

The application now accepts the plan's `R2_*` vocabulary as aliases while preserving the canonical `OBJECT_STORAGE_*` contract and local default. Focused tests and TypeScript passed. Next action, after action-time confirmation for Cloudflare key creation, is to create a staging-bucket-only R2 key, set staging API variables without printing values, redeploy staging, and rerun the real Skia artifact with R2 object/DB/download reconciliation. Production remains untouched.

## 2026-10-16 — verification refresh

The current branch is clean apart from the two preserved untracked plan directories, and local HEAD matches the pushed remote branch at `888311c`. Production and Railway resources were not changed in this checkpoint. The full local build and test suite pass; next implementation remains gated by template-design approval and the separate action-time R2 key confirmation.

## 2026-10-16 checkpoint — fail-closed storage readiness

Before setting R2 credentials, staging will report local readiness. After credentials are entered, the same readiness response must show `driver: s3` and `ready: true` before the real render/R2 reconciliation gate.

## 2026-10-16 checkpoint — template library

The approved 13-template increment is complete at 35 total presets. One additional preset is still required to match the reference plan's 36 count and will be added only after explicit approval for that extra item.

## 2026-10-16 checkpoint — external credential tool failure

The next safe action is to restore Computer Use kernel access or have the owner create the scoped staging R2 token in Cloudflare's R2 API Tokens screen, then provide only the generated credentials through the approved secure Railway variable path. Do not paste secrets into chat or files. Once available, verify `/api/health/ready`, deploy staging, run a real Skia job, and reconcile the R2 object, DB path, download stream, expiry prefix, and worker logs.

## 2026-10-16 checkpoint — source review visibility

The source inventory API now makes activation blockers machine-readable for the future admin UI. The next source work still requires evidence-backed endpoint/license/identity review; do not mark a candidate verified from this diagnostic alone.

## 2026-10-16 checkpoint — source inventory UI

Admin source inventory now explains why a candidate remains disabled. This is review visibility only; evidence review and adapter activation remain separate gates.

## 2026-10-16 checkpoint — cache layer

The cache layer is available to the resolver but remains best-effort and process-local. Durable attempts, source evidence, approval, and final export revalidation remain authoritative.

## 2026-10-16 checkpoint — full suite green

The local integration checkpoint is green after the lock-pinned source cache and admin inventory changes. Live R2 wiring, staging re-render reconciliation, one remaining plan preset, and later production gates remain open; no production action is implied by this local result.
