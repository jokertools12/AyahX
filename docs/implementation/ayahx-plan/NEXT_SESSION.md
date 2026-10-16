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

## 2026-10-16 checkpoint — staging deploy accepted and verified

The owner explicitly approved staging deployment to the merged `main` revision. API/Skia/control are SUCCESS on `8437a30d77b8da1856523eaff5508dc6c0ba5091`; all six staging services are Online with no pending work, and `/api/health/ready` is HTTP 200 with MySQL connected. The app still uses local storage. Resume by creating the staging-only R2 key through Cloudflare's authorized UI/API path, set only staging API `OBJECT_STORAGE_*` variables, redeploy, then run one Skia job and reconcile the R2 object, DB output path, download stream, expiry prefix, and worker logs. Do not touch production or add the final 36th preset without a new explicit approval.

## 2026-10-16 checkpoint — Computer Use retry

A fresh Computer Use kernel reset and `cua.getState()` retry failed before browser access with the same `failed to write kernel assets` / OS error 3. Cloudflare API token listing independently returned `9109 Unauthorized`. No credential or Railway variable was changed; the next action still requires restored Computer Use or an authorized Cloudflare token-creation path.

## 2026-10-16 checkpoint — PR60 merged and staging rollout

PR60 was squash-merged after `contracts` and `public-ui` both passed on head `7fdd476`; merge commit is `4ba67bb1b227173fdbec4605789d1e705bc9d5c0`. Railway automatically started staging deployments for API, control, and Skia. API deployment `ec501382-ac6e-4549-b2dd-25eb5187c5ba` and control deployment `3dd156a6-26dc-4679-8901-89f5913b2b47` reached SUCCESS; Skia deployment `18ddb6b1-42c0-4bad-a200-3008d01e4c44` was still BUILDING at the last successful Railway read. Subsequent Railway reads returned a temporary viewer-role error, so Skia SUCCESS and final all-service reconciliation remain unverified. Production is untouched.

## 2026-10-16 checkpoint — R2 is wired in staging

The owner supplied staging-only R2 credentials. They were set on API staging through Railway CLI without printing values; production was untouched. API deployment `6907246f-1451-4b18-938d-ae4c6189e0b1` is SUCCESS and readiness reports `storage.driver=s3`. A real static Skia probe produced job `8b599efd-6650-4965-963a-7d4a834d0df0`; the DB path, R2 object under `temp-48h/`, object size/ETag, and download size reconcile. Do not expose or reuse the credentials; rotate the supplied secret if it was pasted into any external surface.

The remaining gate is a word-by-word timing render: the current staging attestation check returned `ALIGNMENT_ATTESTATION_INVALID` when a freshly issued known-alignment proof was submitted. Investigate same-user/map serialization or replica secret consistency before claiming full render acceptance. Keep the static R2 evidence separate from final timing acceptance.

## 2026-10-16 checkpoint — final staging R2 timing gate passed

The same-process resolve-known plus render flow now passes the attestation gate. Staging produced an approved word-timing Skia MP4 in R2 with reconciled DB path, object size/ETag, download bytes, worker deployment, and ffprobe evidence. The earlier invalid proof was a cross-replica/request-session issue in the probe method, not a production code change. The remaining plan work is broader Enterprise coverage and credential rotation; do not promote production from this staging evidence alone.

## 2026-10-16 checkpoint — production isolation rechecked

Railway production API remains on deployment `de533693-da00-4279-a3ea-b0e1901f465f`, commit `42b04fd98912081d6c967ac7ec7cb931ce4519ab`. No production deployment or variable change was made while R2 was wired and verified in staging.

## 2026-10-16 — next source-resolution increment

- Task 2.1 local slice landed in the working branch: `approvedSourceAdapters.ts` exposes server-owned, lock-pinned adapters with provenance validation; shared candidate schema now accepts explicit provenance.
- Local evidence: focused 94/94, full 891 passed/6 skipped, TypeScript and production build exit 0.
- Remaining: connect the adapter factory to the approved repository/cache boundary, then add one external adapter only after endpoint/license/revision evidence. Do not enable unreviewed sources or promote production.
## 2026-10-16 — admin overview increment

- Added the first operational dashboard slice: `/api/admin/overview` and sanitized status cards on `/admin/sources` for MySQL, storage, render policy, and source review counts.
- Local evidence: focused API/UI tests 3/3, TypeScript and production build exit 0. No Railway or production mutation.
- Next: wait for PR61 CI/review, then connect approved source adapters to the repository boundary before enabling any external provider.
## 2026-10-16 — server engine boundary

- Closed the server-side `browser_cloud` policy path. Legacy browser fixtures remain for compatibility, while Railway policy can expose Skia (and approved FFmpeg muxing) only.
- Next: land the PR after CI, then continue the approved-source repository boundary; no Cloud Browser deployment should be added.
## 2026-10-16 — merged PR and staging checkpoint

- PR61 merged as `d268d9a`; Enterprise foundation and AyahX E2E are green.
- Staging API, Skia, and control deployments all report SUCCESS on the same main revision. Live readiness confirms MySQL and S3/R2 storage.
- Next: connect approved source adapters to the repository boundary, then perform the remaining live render/visual gates. Keep production untouched until those gates and the explicit production review are complete.
## 2026-10-16 — FFmpeg acceptance checkpoint

- Task 3.3 is locally verified by 18 focused tests covering encoding, mux/audio effects, dimensions, ffprobe, and cleanup.
- Remaining gate is live lifecycle evidence with the approved Skia artifact and worker logs; keep production isolated.
## 2026-10-16 — source mesh checkpoint

- Local source mesh evidence is green: pinned QUA/quran-align adapters, explicit HF review boundary, and strict lock-pinned fallback (106 focused tests).
- Remaining gate is a controlled live multi-source workload using approved records; do not enable provider fallback or AI approval implicitly.
## 2026-10-16 — authority verifier contract

- Added a fail-closed catalog approval verifier for immutable `content_approve` audit evidence, with hash/subject/time checks and three focused tests.
- It is intentionally not wired into runtime until an append-only approval writer and migration gate exist; timing-binding evidence remains denied.
## 2026-10-16 — approval writer checkpoint

- Added the append-only content approval writer contract with authorization and idempotent request handling; six focused writer/verifier tests pass.
- Keep it server-side and unexposed until the runtime authorization route and migration gate are reviewed.
## 2026-10-16 — timing evidence checkpoint

- Timing approval evidence now has a concrete fail-closed contract: approved review, document/revision identity, timing hash, and immutable audit context.
- Keep runtime wiring gated until migration and capability checks are verified in staging.
## 2026-10-16 — approval runtime wiring

- Approval writer is now reachable only through authenticated `/api/catalog/approvals`, with capability authorization derived from current MySQL grants.
- Before staging deploy, run the enterprise CI and review the route/migration boundary; no production action is implied.
## 2026-10-16 — browser local checkpoint

- Task 3.1 is locally verified by 19 focused tests for preview, local WebM, MP4 conversion, cancellation, and export settings.
- Remaining is device capability/visual benchmark evidence; server Cloud Browser remains disabled by architecture.

## 2026-10-16 — staging R2 lifecycle rule

- Applied and verified Cloudflare R2 lifecycle on `ayahx-audio-staging`: `temp-48h/` objects expire after 172800 seconds; the existing 7-day multipart-abort rule remains enabled.
- Production bucket and Railway production were untouched. A timed expiry observation on a disposable staging object remains before claiming provider expiry completion.
