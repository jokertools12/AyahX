# حالة تنفيذ خطة AyahX

آخر تحديث: 2026-10-15. هدف Enterprise الكامل نشط وغير مكتمل؛ التفويض يشمل
GitHub وRailway وR2 وstaging ثم production بعد البوابات. الهدف Desktop checkout،
والحزمة المرجعية محفوظة دون تعديل. COVERAGE.md هي المطابقة التفصيلية.

Baseline42b04fd98912081d6c967ac7ec7cb931ce4519ab؛ repo jokertools12/AyahX.
PR26–35 مدموجة؛ main d040e7e11acc2b8c4590b231f4350375acc9055f.
staging API يعمل على8618dcba4cfaeaa827aad74bf56154245cde09c7، deployment
cc650771-ed5c-482e-a7a2-d4f11eed30bc SUCCESS، runtime SHA وملف الخدمة متطابقان،
public UI desktop/mobile10/10.001/002 مطبقان:31tables/2audit triggers، pending0.
تهيئة owner للحساب المحدد staging متحققة:منحة واحدة/حدث تدقيق واحد،8capabilities،
live401/403/400/404 للحدود المقصودة. هوية الحساب والتقارير الخاصة لا تدخل Git.

PR34 لحدود DDL التشغيلية وPR35 مدموجتان؛ main d040e7e11acc2b8c4590b231f4350375acc9055f منشور في staging. API preDeploy فارغ، والحسابات runtime الثلاثة الجديدة تحققت من الهدف المادي والمنح الفعالة؛ API وSkia مستقرتان، API health وE2E العام 10/10 ناجحان، وowner/audit بقيَا 1/1. control غير مستقر بعد SIGTERM/restart رغم SUCCESS؛ اتصال advisory عالق شُخّص وحُرر، والاستقرار التشغيلي باقٍ قبل قبول الرندر. production لم يتغير.
المرجع: `AyahX_Enterprise_Plan_Package_2026-10-14/00_PLAN/IMPLEMENTATION_TASKS.md`.
قبل التنفيذ، اربط كل صف في `FEATURE_COVERAGE.ar.md` بالمصدر والاختبار والدليل؛
هذا الجدول فهرس مهام، وليس بديلًا لمصفوفة الميزات أو معايير قبولها.

| Task | النطاق | حالة مطابقة المصدر/القبول |
| --- | --- | --- |
| 0.1 | Provider/source registry والترخيص | سجل المرشحين + بوابة evidence + GET للأدمن وصفحة `/admin/sources` مدموجة؛ مراجعات المصادر الفعلية باقية |
| 0.2 | Riwayah/numbering/font map | runtime binding schema متحقق محليًا؛ بيانات canonical/font QA باقية |
| 0.3 | Recording coverage contract | guard + trusted injected repository و44 اختبارًا جديدًا محليًا؛ authority store وruntime/export wiring باقيان |
| 1.1 | MySQL additive migration | خمسة جداول خاملة + runner متحقق محليًا وتجربة restore؛ PR29–33 مدموجة و001/002 staging apply متحقق؛ runtime8618dcb وowner bootstrap متحققان؛ assets/templates وغيرها باقية |
| 1.2 | RBAC وAudit | grant/audit persistence وAPI وowner staging متحققة حيًا؛ authority verifier لقراءة `content_approve` append-only أضيف محليًا؛ writers وruntime wiring وUI باقية |
| 1.3 | Source resolution attempts | migration003 وv4 grants وstaging runtime cutover متحققون؛ resolver deployment/API health/control lock evidence موجود؛ adapter invocation/idempotency under live workload باقية |
| 2.1 | Adapter/cache أولي | محول local approved مقيد بالقفل والبصمة مع provenance schema واختبارات fallback/mismatch محلية؛ ربطه بمخزن الإنتاج/الـR2 باقٍ |
| 2.2 | Adapters خارجية تدريجية | متحقق محليًا للمصادر المثبتة QUA وquran-align مع checksum/riwayah/host guards؛ live provider acceptance باقية |
| 2.3 | Phonemizer وAI alignment | حدود QUD/HF وalignment review موجودة ومختبرة محليًا؛ لا HF call أو private upload أو اعتماد تلقائي |
| 2.4 | Strict fallback | متحقق محليًا عبر lock/policy identity وledger resolver tests؛ workload حي متعدد المصادر باقٍ |
| 3.1 | Browser live preview/local export | لم يُقيّم |
| 3.2 | Skia server renderer | attested staging `skia_canvas` MP4 accepted with R2/DB/download/ffprobe reconciliation; visual inspection beyond ffprobe remains |
| 3.3 | FFmpeg encoder/muxer | متحقق محليًا: H.264/AAC MP4، 60fps/320kbps، ffprobe، أبعاد 16:9، effects، cleanup؛ القبول الحي الكامل ما زال مرتبطًا بمسار render lifecycle |
| 3.4 | Server render lifecycle | staging job succeeded with R2-backed output path, expiry prefix, download, and worker deployment evidence |
| 4.1 | Admin Dashboard | overview منقح لحالة DB/storage/render policy/source review مربوط بصفحة `/admin/sources`؛ بقية لوحة الأدمن باقية |
| 4.2 | Reciters/Riwayat/Sources | لم يُقيّم |
| 4.3 | Ibtihalat + Sync Studio | لم يُقيّم |
| 4.4 | Typography/Templates/Storage | لم يُقيّم |
| 4.5 | Users/Community | لم يُقيّم |
| 4.6 | Engines/System | policy الخادم تستبعد `browser_cloud` حتى مع flag قديم؛ Browser يبقى قدرة عميل، وإعدادات FFmpeg/Skia التفصيلية باقية |
| 5.1 | الصوت والقارئ والتسجيل | لم يُقيّم |
| 5.2 | السور والآيات المتاحة | لم يُقيّم |
| 5.3 | Typography/ornaments | لم يُقيّم |
| 5.4 | Scene/preview | لم يُقيّم |
| 5.5 | Review/render | لم يُقيّم |
| 6.1 | R2 lifecycle | staging bucket lifecycle/CORS plus real `temp-48h/` object and DB reconciliation verified; timed expiry observation remains |
| 6.2 | Staging evidence | API/Skia/control SUCCESS, readiness 200, attested R2 Skia artifact, ffprobe and worker evidence verified; production gate remains |
| 6.3 | Production gate | مصرح بعد staging والمراجعة؛ لم يبدأ |

عند التشغيل أضف لكل شريحة: IDs/صفوف الميزات، ملفات التغيير، مالك الكتابة،
الحالة، أوامر التحقق وexit codes، روابط الأدلة والعائق والخطوة التالية.
الحالات: قيد التنفيذ، مطبق غير متحقق، متحقق محليًا، متحقق حيًا، أو معطل مع السبب.
لا تنقل شريحة إلى متحقق حيًا بناءً على اختبار محلي.

Fresh v4 runtime principals were provisioned and verified against migration003: API111 privilege points, Skia/control105; no service cutover yet. Existing v1 accounts remain active by design.

## 2026-10-16 — R2 contract preparation (local)

أضيفت `resolveStorageConfig` في `server/config.ts` لتوحيد عقد `OBJECT_STORAGE_*` مع مرادفات `R2_*` الواردة في الخطة، مع إبقاء `local` هو الافتراضي إلى أن يحدد النشر `OBJECT_STORAGE_DRIVER=s3`. يعرِض التشخيص المنقح حالة bucket/endpoint/credentials دون قيم سرية. الاختبار المركز `storageConfig.test.ts` و`objectStorageKey.test.ts` نجحا (6/6)، وTypeScript نجح. لا تغيير خارجي أو production؛ تفعيل R2 الحي ينتظر مفتاحًا محدودًا لـstaging فقط.

## 2026-10-16 — storage readiness guard

أضيف `getStorageReadiness` وفحصه إلى `/api/health/ready` وdiagnostics: local يبقى جاهزًا، بينما S3/R2 يرفض الجاهزية عند غياب bucket أو endpoint أو أحد المفتاحين. لا توجد network calls أو قيم سرية في الفحص. RED ثم GREEN: `storageReadiness.test.ts` (3/3)، `observability.test.ts` (9/9)، TypeScript exit 0، وESLint بلا أخطاء.

## 2026-10-16 — approved template expansion

بموافقة المالك على إضافة 13 قالبًا، توسعت `VIDEO_PRESETS` من 22 إلى 35 قالبًا فعليًا. أضيفت عائلات المسجد والمصحف والشموع وneon والرسوم والصحراء والهلال وminimal والأقواس والهوية الذهبية، مع عقود RTL الحالية ونسب 9:16/16:9. `videoPresets.test.ts` يثبت العدد 35 وفرادة IDs ووجود الإعدادات الأساسية (7/7). الخطة المرجعية تذكر 36 قالبًا؛ بقي قالب واحد فقط كفجوة معلّمة لأن الموافقة كانت محددة بـ13 إضافة.

## 2026-10-16 — R2 credential creation attempt

بعد موافقة المالك على مفتاح staging المقيّد، فشل Computer Use قبل فتح المتصفح مرتين بعد reset بنفس الخطأ `failed to write kernel assets` (os error 3). Cloudflare API integration نجحت في القراءة السابقة لكنها رفضت permission-group/token creation بالخطأ 9109 Unauthorized. لذلك لم يُنشأ أي credential ولم تُغيّر Railway variables؛ R2 live wiring بقيت غير مفعلة عمدًا. `npm run build` بعد توسيع القوالب نجح (3042 modules).

## 2026-10-16 — source activation gap diagnostics

أضيفت `getQuranSourceActivationGaps` وربطها بـ`GET /api/quran/sources`. كل سجل يعيد `activationReady` وcodes ثابتة مثل `production_disabled` و`license_unverified` دون كشف references أو أسرار. هذا يحسن Admin inventory ويجعل سبب بقاء المصدر معطلاً قابلًا للتدقيق، من دون تفعيل adapters أو network fallback.

## 2026-10-16 — admin source blocker visibility

حدّثت `/admin/sources` لعرض أسباب منع التفعيل المترجمة من `activationGaps` مع حالة وصول قابلة للقراءة عبر لوحة المفاتيح؛ لا تعرض الصفحة credentials أو references الحساسة. الاختبار يثبت الحالة المعطلة ورسالة الترخيص.

## 2026-10-16 — lock-pinned source cache

أضيف كاش process-local محدود العمر لنتائج المصدر بعد التحقق، ومفتاحه يضم `sourceId@revision` و`lockHash`؛ لذلك لا يمكنه عبور الرواية أو المصحف أو النطاق أو بصمة الصوت. resolver يعيد التحقق من المرشح عند cache hit ويسجل محاولات ledger كالمعتاد؛ الكاش تسريع مؤقت ولا يحل محل persistence أو approval.

## 2026-10-16 — staging deployment after explicit approval

بعد موافقة المالك على staging فقط، طُبّق مصدر `main` وإزالة `db:setup` من pre-deploy لـ API على API/Skia/control. النشرات الحالية على commit `8437a30d77b8da1856523eaff5508dc6c0ba5091` هي SUCCESS: API `5aa5c0d5-ea60-44f8-b9ac-2248de9477e6`، Skia `9894a89f-7a2a-41d1-b908-61b5179758d5`، وcontrol `7b285628-2ca0-434f-9aa6-6f9d2b34a99f`. حالة البيئة تعرض الخدمات الست Online ولا توجد pending changes. فحص `/api/health/ready` أعاد HTTP 200 و`database=connected`، مع `storage.driver=local`. production لم يتغير.

تبقى بوابة R2 والرندر الحي الكامل مفتوحة: لم يُنشأ مفتاح Cloudflare staging بسبب فشل Computer Use قبل تشغيل المتصفح ورفض Cloudflare API إنشاء permission group/token بـ `9109 Unauthorized`. لا تُضبط متغيرات R2 ولا يُقبل artifact النهائي قبل توفير مفتاح محدود لـ `ayahx-audio-staging` ثم مطابقة R2/DB/download/worker logs.

## 2026-10-16 — explicit Hugging Face QUD adapter boundary

أضيف موصل اختياري صريح `huggingface_qud_aligner` خلف متغيرات الخادم `HF_QUD_ALIGNER_API_URL`/`HF_QUD_ALIGNER_URL` و`HF_TOKEN`. يظهر الموصل كـ external review required، ويتطلب endpoint مهيأً ومراجعة بشرية؛ لا يوجد fallback صامت أو رفع وسائط خاصة أو تفعيل فعلي في Railway. الاختبار يثبت أنه غير مهيأ افتراضيًا، بينما تبقى نتيجة QUD provisional ولا تصبح canonical أو approved تلقائيًا.

## 2026-10-16 — PR61 merge and staging rollout

PR61 دُمج بعد نجاح `Enterprise foundation` و`AyahX E2E` على إصلاح fixture الخاص بـTypeScript. `main` الحالي هو `d268d9a55568f00802ad2946939aaae758455e67`.

نشرات staging الثلاث على نفس revision وبحالة SUCCESS: API `3dca7786-5876-4b52-9ee6-7ff62a4ca6ab`، Skia `7c7a9fa1-97f7-48d3-b98b-d2c20720da12`، control `6eae3bff-bb0a-417b-8236-0f7988447d3e`. فحص `https://ayahx-staging.up.railway.app/api/health/ready` أعاد HTTP 200، `database=connected` و`storage.driver=s3`. production لم يتغير.
