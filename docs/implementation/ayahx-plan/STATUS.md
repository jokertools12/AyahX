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

PR34 لحدود DDL التشغيلية مدموجة في main@db6d67de2507a9a0e6afa765a88a9ca68b08ff1f
لكنها غير منشورة. الإعداد المحلي في codex/ayahx-runtime-db-grants يضيف CLI لحسابات
runtime جديدة فقط وخطة 31 منحة. مخطط clone معزول على MySQL staging وبيانات اصطناعية:
51/51 تحققًا PASS، بما فيها
منع DDL وتغيير التدقيق والهوية، واختبارات التراجع والتزامن/الحذف. لا توجد حسابات
runtime حقيقية أو تغييرات أسرار/preDeploy. staging API ما زال 8618dcba (owner/audit
1/1) والعمال على baseline. لا إجراء production أو قبول رندر جديد.
PR35 head acfca12931c1ff531fe15e80e8e8001041a75b9d اجتاز CI العقود والواجهة.
تغيير staging مجهز لـAPI/Skia/control إلى هذا الرأس مع preDeploy فارغ للـAPI؛
رفضت بوابة accept-deploy الموافقة ولم يُطبق، والموافقة المحددة معلقة.
المرجع: `AyahX_Enterprise_Plan_Package_2026-10-14/00_PLAN/IMPLEMENTATION_TASKS.md`.
قبل التنفيذ، اربط كل صف في `FEATURE_COVERAGE.ar.md` بالمصدر والاختبار والدليل؛
هذا الجدول فهرس مهام، وليس بديلًا لمصفوفة الميزات أو معايير قبولها.

| Task | النطاق | حالة مطابقة المصدر/القبول |
| --- | --- | --- |
| 0.1 | Provider/source registry والترخيص | سجل المرشحين + GET للأدمن متحقق محليًا؛ مراجعات المصادر الفعلية باقية |
| 0.2 | Riwayah/numbering/font map | runtime binding schema متحقق محليًا؛ بيانات canonical/font QA باقية |
| 0.3 | Recording coverage contract | guard + trusted injected repository و44 اختبارًا جديدًا محليًا؛ authority store وruntime/export wiring باقيان |
| 1.1 | MySQL additive migration | خمسة جداول خاملة + runner متحقق محليًا وتجربة restore؛ PR29–33 مدموجة و001/002 staging apply متحقق؛ runtime8618dcb وowner bootstrap متحققان؛ assets/templates وغيرها باقية |
| 1.2 | RBAC وAudit | grant/audit persistence وAPI وowner staging متحققة حيًا؛ PR34 DDL boundary مدموجة غير منشورة؛ clone صلاحيات 51/51 على مخطط staging معزول؛ provision حقيقي وcredential cutover وcontent/source/retention writers وUI باقية |
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
