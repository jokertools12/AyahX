# حالة تنفيذ خطة AyahX

آخر تحديث: 2026-10-15. التنفيذ الكامل مفعل بطلب المالك المرفق في هذه الجلسة.
يشمل التفويض GitHub وRailway staging ثم production وR2 والمهاجرات الآمنة بعد
التحقق والمراجعة. انتهى تأجيل التنفيذ السابق؛ لا يعني ذلك اكتمال أي ميزة.
المطابقة التفصيلية: COVERAGE.md. المنسق Sol؛ Luna يملك مصفوفة المطابقة فقط.

Baseline: `42b04fd98912081d6c967ac7ec7cb931ce4519ab`، الفرع
`codex/ayahx-enterprise-plan`، remote `jokertools12/AyahX`.
حُفظت تغييرات الإعداد السابقة في `tooling/reports/enterprise-baseline/` محليًا.
الحزمة المرجعية محفوظة دون تعديل ولا تضاف وسائطها إلى commits التنفيذ.

الأساس: PR #26 دُمج في main عند `5b7b04b`؛ staging على `76fa649`، deployment
`40abc3d7-1381-4fb3-b04c-bf688f7cd558` SUCCESS. GET مصادر حي للأدمن +401 للزائر،
و10/10 public UI E2E حية. لا يعني ذلك اكتمال 0.1–0.3 أو أي مسار رندر جديد.
production باقٍ عند baseline؛ تنبيهات الاعتماديات تمنع إعلان الجاهزية.
1.2 شريحة admin-only approval منشورة staging bb773db وlive user403؛ PR27 دُمج
main@92b8f62. باقي RBAC/audit غير مكتمل. PR28 HTTP patches اجتاز CI ونشر staging
SUCCESS عند b628a8b، وتحقق runtime versions وGET gzip200؛ دُمج main@0219c0a.
1.1 الجداول الخمسة الخاملة مطبقة staging؛ PR29/30/31 مدموجة، والكود الحالي staging bb609e4 متحقق runtime و10/10 UI. PR32 مدموج main@8906572؛ authority002 مطبق staging:31 جدولًا و2triggers، pending0 و28nonvolatile tables دون تغير. جداول grants/audit فارغة؛ writer/bootstrap قيد التنفيذ.

المرجع: `AyahX_Enterprise_Plan_Package_2026-10-14/00_PLAN/IMPLEMENTATION_TASKS.md`.
قبل التنفيذ، اربط كل صف في `FEATURE_COVERAGE.ar.md` بالمصدر والاختبار والدليل؛
هذا الجدول فهرس مهام، وليس بديلًا لمصفوفة الميزات أو معايير قبولها.

| Task | النطاق | حالة مطابقة المصدر/القبول |
| --- | --- | --- |
| 0.1 | Provider/source registry والترخيص | سجل المرشحين + GET للأدمن متحقق محليًا؛ مراجعات المصادر الفعلية باقية |
| 0.2 | Riwayah/numbering/font map | runtime binding schema متحقق محليًا؛ بيانات canonical/font QA باقية |
| 0.3 | Recording coverage contract | guard + trusted injected repository و44 اختبارًا جديدًا محليًا؛ authority store وruntime/export wiring باقيان |
| 1.1 | MySQL additive migration | خمسة جداول خاملة + runner متحقق محليًا وتجربة restore؛ PR29–32 مدموجة و001/002 staging apply متحقق؛ runtime الحالي bb609e4، ونشر writer لم يبدأ |
| 1.2 | RBAC وAudit | إصلاح admin-only لاعتماد/رفض التوقيت متحقق محليًا؛ RBAC التفصيلي وaudit العام باقيان |
| 1.3 | Source resolution attempts | لم يُقيّم |
| 2.1 | Adapter/cache أولي | لم يُقيّم |
| 2.2 | Adapters خارجية تدريجية | لم يُقيّم |
| 2.3 | Phonemizer وAI alignment | لم يُقيّم |
| 2.4 | Strict fallback | لم يُقيّم |
| 3.1 | Browser live preview/local export | لم يُقيّم |
| 3.2 | Skia server renderer | لم يُقيّم |
| 3.3 | FFmpeg encoder/muxer | لم يُقيّم |
| 3.4 | Server render lifecycle | لم يُقيّم |
| 4.1 | Admin Dashboard | لم يُقيّم |
| 4.2 | Reciters/Riwayat/Sources | لم يُقيّم |
| 4.3 | Ibtihalat + Sync Studio | لم يُقيّم |
| 4.4 | Typography/Templates/Storage | لم يُقيّم |
| 4.5 | Users/Community | لم يُقيّم |
| 4.6 | Engines/System | لم يُقيّم |
| 5.1 | الصوت والقارئ والتسجيل | لم يُقيّم |
| 5.2 | السور والآيات المتاحة | لم يُقيّم |
| 5.3 | Typography/ornaments | لم يُقيّم |
| 5.4 | Scene/preview | لم يُقيّم |
| 5.5 | Review/render | لم يُقيّم |
| 6.1 | R2 lifecycle | لم يُقيّم |
| 6.2 | Staging evidence | مصرح؛ ينتظر اكتمال الشرائح وبواباتها |
| 6.3 | Production gate | مصرح بعد staging والمراجعة؛ لم يبدأ |

عند التشغيل أضف لكل شريحة: IDs/صفوف الميزات، ملفات التغيير، مالك الكتابة،
الحالة، أوامر التحقق وexit codes، روابط الأدلة والعائق والخطوة التالية.
الحالات: قيد التنفيذ، مطبق غير متحقق، متحقق محليًا، متحقق حيًا، أو معطل مع السبب.
لا تنقل شريحة إلى متحقق حيًا بناءً على اختبار محلي.
