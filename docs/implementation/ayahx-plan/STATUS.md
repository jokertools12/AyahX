# حالة تنفيذ خطة AyahX

آخر تحديث: 2026-10-15. التنفيذ الكامل مفعل بطلب المالك المرفق في هذه الجلسة.
يشمل التفويض GitHub وRailway staging ثم production وR2 والمهاجرات الآمنة بعد
التحقق والمراجعة. انتهى تأجيل التنفيذ السابق؛ لا يعني ذلك اكتمال أي ميزة.
المطابقة التفصيلية: COVERAGE.md. المنسق Sol؛ Luna يملك مصفوفة المطابقة فقط.

Baseline: `42b04fd98912081d6c967ac7ec7cb931ce4519ab`، الفرع
`codex/ayahx-enterprise-plan`، remote `jokertools12/AyahX`.
حُفظت تغييرات الإعداد السابقة في `tooling/reports/enterprise-baseline/` محليًا.
الحزمة المرجعية محفوظة دون تعديل ولا تضاف وسائطها إلى commits التنفيذ.

قيد التنفيذ: preflight و0.1–0.3. لم يحدث نشر جديد أو migration حية بعد.

المرجع: `AyahX_Enterprise_Plan_Package_2026-10-14/00_PLAN/IMPLEMENTATION_TASKS.md`.
قبل التنفيذ، اربط كل صف في `FEATURE_COVERAGE.ar.md` بالمصدر والاختبار والدليل؛
هذا الجدول فهرس مهام، وليس بديلًا لمصفوفة الميزات أو معايير قبولها.

| Task | النطاق | حالة مطابقة المصدر/القبول |
| --- | --- | --- |
| 0.1 | Provider/source registry والترخيص | سجل المرشحين + GET للأدمن متحقق محليًا؛ مراجعات المصادر الفعلية باقية |
| 0.2 | Riwayah/numbering/font map | runtime binding schema متحقق محليًا؛ بيانات canonical/font QA باقية |
| 0.3 | Recording coverage contract | guard + fresh-loader boundary و33 tests محليًا؛ repository/export integration باقٍ |
| 1.1 | MySQL additive migration | لم يُقيّم |
| 1.2 | RBAC وAudit | لم يُقيّم |
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
