# مصفوفة ربط الأدمن — A1 وA2a والدفعة 5

حالة13 أكتوبر: الربط المحلي واختبارات المهام لا تعني تسليمًا إنتاجيًا. الفحص البصري2176 حالة متوقف وغير مقبول؛ production008 والقبول القرائي والنشر ولقطات «بعد» معلّقة. PR24 مسودة. [تقرير التوقف](data/batch5-visual-stop-report.ar.md).

المرجع الفعلي: `server/routes/admin/adminA1Endpoints.ts` و`adminA2bEndpoints.ts` و`adminMediaEndpoints.ts` و`adminRenderLab.ts` و`server/routes/adminCatalog.ts` و`server/routes/catalog.ts` وخدماتها، مع `src/admin/pages` و`src/admin/pages/catalog`. المسارات في الجدول تبدأ بعد `/api/admin` إلا حين يُذكر خلاف ذلك. كل mutation مأذون يسجل `audit_logs` داخل معاملته؛ منع UPDATE/DELETE للسجل على مستوى MySQL. الأذونات الفعلية محفوظة في `admin_roles` و`admin_permissions` مع توسيع `user_roles`؛ لا يُفترض وجود جداول جديدة باسم `roles` أو `role_permissions`.

الحالات: **موصول ومتحقق HTTP محليًا** تعني تنفيذ الطلب الفعلي على القاعدة المحلية، وليست إثباتًا لنشر production. **واجهة موصولة؛ E2E معلّق** تعني أن المكون يستدعي العقد الفعلي وأن نتيجة تدفق المتصفح النهائي لم تُثبت بعد. نتائج اللقطات وaxe تخص عرض الصفحات، ولا تحوّل كل زر تلقائيًا إلى تدفق ناجح.

أقسام A1 وA2a وD7 أدناه تحتفظ بأدلتها التاريخية. **منفذ في الكود؛ قبول الدفعة 5 معلّق** في القسم الجديد يصف الربط الحالي فقط؛ القبول المحلي الحقيقي ومهام المالك الإنتاجية والنشر لا تُستنتج من وجود المسار أو نجاح الوحدات.

## A1

| الصفحة/الإجراء | الطلب والصلاحية | مصدر التخزين أو المستهلك الفعلي | الأثر والقبول |
|---|---|---|---|
| الدخول والهوية والخروج | `/auth/login`؛ GET `/auth/me`؛ POST `/auth/logout`، `security.self` للجلسة | `AdminAccessService`، `users` و`user_roles` و`admin_sessions` | دخول حقيقي وجلسة HttpOnly؛ قبول A1 محلي، والظهور يتبع RBAC |
| الرئيسية | GET `/dashboard`، `dashboard.read` | `AdminDashboardService`: جداول المستخدمين/التلاوات/المراجعات، probes MySQL/Redis/R2/storage وسعة العمال | بيانات فعلية ومحدودية probes ظاهرة؛ قبول HTTP ولقطات |
| مصفوفة الأدوار | GET `/roles`,`/permissions`؛ PUT `/roles/:slug/permissions`، `roles.manage` وsuper_admin | `admin_roles`,`admin_permissions`؛ يفحص `AdminAccessService` المنح الفعلية | تغير وصول كل أعضاء الدور؛ حماية super_admin؛ تأكيد slug وسجل قبل/بعد |
| أدوار المستخدم | GET `/users`، `users.read`؛ PUT `/users/:id/roles`، `roles.manage` وsuper_admin | `user_roles`؛ يستعملها تسجيل الدخول وRBAC | تخص الأدوار فقط؛ حماية حسابات المدير الأعلى؛ قبول A1 محلي |
| سجل التدقيق | GET `/audit`، `audit.read` | `audit_logs` عبر `AdminAuditService` | قراءة فقط، diff وrequestId؛ مفاتيح التصفية `entityType/entityId/action` |
| الإعدادات العادية | GET `/settings`، `settings.read`؛ PATCH `/settings/:key`، `settings.write` | `system_settings` و`AdminSettingsService` وسجل `ADMIN_SETTINGS` | يقبل النوع المحدد ويُبطل ذاكرة السجل؛ المجهول بلا مستهلك readOnly |
| أسرار AI | PATCH `/settings/:key`، `settings.write` | `secretSettingsCrypto` ثم `aiService` أو `openRouterService` حسب التعريف | تشفير على الخادم؛ القراءة value=null وmasked؛ التدقيق isSet فقط. لا نموذج AI يُستدعى ضمن هذه البروفة |
| علم الكتالوج | GET `/flags`، `flags.read`؛ PATCH `/flags/quran_catalog_v2`، `flags.write` و`launch.manage` | `AdminSettingsService` ثم `readCatalogSettings` | في الدفعة 5 الفتح مرفوض حتى محليًا: `PUBLIC_FLOW_V2_NOT_READY`؛ `public_flow_v2_ready=false` ثابتة بالخادم حتى D8. `/settings/quran_catalog_v2` للقراءة فقط |
| TOTP والاسترداد | GET `/security/totp` وPOST enroll/confirm/disable/recovery، `security.self` | `AdminSecurityService`,`admin_user_extensions` | AES-GCM ورموز مجزأة والتحقق ضد إعادة الاستخدام؛ قبول A1 محلي |
| الجلسات | GET `/security/sessions`؛ DELETE `/security/sessions/:id`، `security.self`؛ all يتطلب `security.sessions.manage` وsuper_admin | `admin_sessions` | إنهاء الجلسة مع قيود الملكية؛ يسقط وصولها الحقيقي، مع audit |

## A2a

| الصفحة/الإجراء | الطلب والصلاحية | التخزين/المستهلك | الحالة والأثر العام |
|---|---|---|---|
| قائمة القارئ وتفاصيله | GET `/catalog/reciters` و`/:id`، `reciters.read` | `reciters` والتلاوات والفصول عبر `AdminCatalogService` | HTTP محلي ناجح؛ أسماء وأعداد فعلية، أسباب الظهور محسوبة |
| تعديل الملف | PATCH `/catalog/reciters/:id/profile`، `reciters.write` | `reciters`؛ قراءة الأسماء في `/api/catalog/reciters` والتلاوات | HTTP محلي ناجح؛ صورة URL متحققة، بلا upload |
| إظهار قارئ/تحديد | POST `/catalog/reciters/:id/visibility` أو `/reciters/visibility`، `reciters.visibility` | `reciters.is_visible`؛ `publicCatalogSql` | HTTP محلي ناجح؛ إخفاء القارئ يمنع الظهور العام؛ audit مجمّع للتحديد |
| ترتيب القراء | POST `/catalog/reciters/reorder`، `reciters.write` | `reciters.sort_order` | يستبدل مواقع IDs المحددة فقط ويحافظ على صفوف أخرى، ويرفض عبور featured؛ Undo واجهة موصول |
| دمج القارئ | POST `/catalog/reciters/:id/merge`، `reciters.merge` | القارئ المصدر والتلاوات وخريطة صريحة وسجل واحد | HTTP محلي ناجح؛ يعيد صوت المنقول إلى unverified ويصفّر الظهور/الافتراضية، المصدر مخفي |
| قائمة التلاوات وتفاصيلها | GET `/catalog/recitations` و`/:id`، `recitations.read` | `recitations`,`reciters`,`audio_providers`,`riwayat`,`recitation_chapters` | HTTP محلي ناجح؛ الحالة التقنية منفصلة عن الظهور؛ المصدر والقناة والرواية فعلية |
| الاسم والملاحظات | PATCH `/catalog/recitations/:id/presentation`، `recitations.write` | `recitations.display_label_ar/en`,`quality_note`,`source_note`,`sort_order` | يصل إلى `/api/catalog/reciters/:slug/recitations`؛ HTTP ناجح، Enter والاسم العام مثبتان بـ E2E محلي |
| الافتراضية | POST `/catalog/recitations/:id/default`، `recitations.write` | `is_default_for_reciter`؛ ترتيب `RecitationCatalogService.listRecitationsForReciter` | واحدة لكل قارئ؛ لا تفتح العلم ولا تتجاوز بوابات الجمهور؛ HTTP وUI E2E محلي ناجحان |
| الظهور | POST `/catalog/recitations/:id/visibility`، `recitations.visibility` | `is_public` وحقوق المزوّد/هوية الصوت وسياسة الكتالوج | HTTP محلي ناجح؛ إظهار تلاوة يحتاج البوابات، والإخفاء لا يمحو بياناتها |
| ترتيب التلاوات | POST `/catalog/recitations/reorder`، `recitations.write` | `sort_order` بقواعد subset | HTTP وE2E كيبورد/Undo محلي ناجحان؛ السحب المكتبي ناجح |
| النقل | POST `/catalog/recitations/:id/move`، `recitations.move` | `reciter_id` وdefault/public/voice | HTTP محلي ناجح؛ سبب وتأكيد slug وإعادة مراجعة الصوت، بلا اعتماد صوت تلقائي |
| إعادة حساب الإتاحة | POST `/catalog/recitations/:id/recalculate`، `recitations.write` | `admin_catalog_tasks` ثم `CatalogAvailabilityService` و`recitation_chapters` | يسجل intent قابل لإعادة المحاولة، نتيجة حقيقية وتقدم؛ لا Aligner أو تعديل توقيت |
| فحص الروابط | POST `/catalog/recitations/:id/check-links`، **`sources.write`** | `admin_catalog_tasks` وsource checker وسجلات الفصول/المصادر | الواجهة تحترم الإذن المستقل؛ قبول enqueue/progress محلي، لا HEAD خارجي في اختبار HTTP الموثق |
| متابعة المهمة | GET `/catalog/tasks/:id`، `recitations.read` | `admin_catalog_tasks` | حالة/progress/total/result_json/error_code مستديمة؛ خطأ المهمة ظاهر، بلا نجاح مصطنع |
| روابط القارئ | GET `/catalog/sources`، `sources.read`؛ POST `/sources/:id/active`، `sources.write` | `recitation_chapters.is_enabled` أو `recitation_source_urls.is_active` حسب kind | HTTP محلي ناجح؛ تعطيل فصل يغيّر إتاحته؛ لا إضافة URL ولا استضافة صوت جديدة هنا |
| مصفوفة الفصول | GET `/catalog/recitations/:id/chapters`، `recitations.read` | `quran_surahs` و`recitation_chapters`؛ جميع السور مع ملخص الحالات | بيانات HTTP ناجحة؛ coverage/expected/runs/missing/audio حقيقية؛ E2E الكيبورد وفتح التوقيت ناجح محليًا |
| المزوّد والشروط | GET `/catalog/providers` و`/:id`، `providers.read` | `audio_providers` وaudit للمضيفين وإحصاءات links | HTTP محلي ناجح؛ قراءة الحقوق والشروط والإسناد وقاعدة المعدل المخزنة |
| قرار الترخيص | PATCH `/catalog/providers/:id/license`، `providers.license.decide` وsuper_admin | `HumanReviewService` و`audio_providers.license_status` وaudit | HTTP محلي ناجح؛ permitted يتطلب مرجع الحقوق والملاحظة والتأكيد، بلا اعتماد صوت أو فتح flag |
| القرآن والتكامل | GET `/catalog/quran/surahs`,`/integrity`,`/surahs/:surah/ayahs`، `quran.read` | `quran_surahs`,`quran_ayahs`,`quran_words`,`quran_text_versions` | قانوني للقراءة فقط؛ checksum يعاد حسابه ويقارن بالإصدار الفعّال؛ خطوط D1 الستة |
| الروايات | GET `/catalog/quran/riwayat`، `quran.read`؛ PATCH `/:code`، `quran.riwayah.write` | `riwayat.is_active`؛ `publicCatalogSql` | HTTP محلي ناجح؛ تأكيد code، تعطيل الرواية يخفي تلاواتها ولا يغير النص |
| عارض التوقيت | GET `/catalog/timings?recitation_id&surah&from&to`، `timings.read` | `ayah_timings` و`quran_words` والمدققات الحالية | لا mutation. SVG/JSON يقرآن source ms، فهرس idx_timing_ready_range وزمن 0.383–0.484ms محليًا |

## D7 — render lab، متحقق إنتاجيًا

|الإجراء|العقد والصلاحية|المستهلك الفعلي|الدليل والحدود|
|---|---|---|---|
|إنشاء QA|POST /render-lab/jobs،render.test ودورadmin/super_admin|RenderLabService→manifestv2→render_jobs→BullMQ→Skia|HTTP محلي حقيقي202 معOrigin/rate/schema/audit،و9فيديوهاتproductionعبرCLI؛90s وتزامن1|
|قراءة الحالة|GET /render-lab/jobs/:id،نفسالصلاحية|render_jobs وqa_report_json|مقاييس حقيقية؛anonymousproduction401/no-store؛لا روابط مزود أوأسرار|
|مشغّلSSH|renderLabCli.cjs --root-operated|الخدمة نفسها وهويةsuper_adminالقائمة|dry-run/create/status وownedfixtureمحدود؛لاجلسةمصطنعةأوكتابةكتالوج. انتظارداخلجلسةواحدةواستئناففحصببصمتين|
|تعريف ومنح|007 ثمactivateRenderV2Access|permissions/admin_permissions|تعريف ثمgrantللدورينبعد4SUCCESS،بصماتالحساباتثابتة؛لاstartupseed أوتعديلuser_roles|

[RBACHTTP الحقيقي محليًا](data/d7-render-lab-rbac-proof.json)،[مصفوفةproduction](data/d7-production-matrix-proof.json)،[التفعيل](data/d7-render-lab-activation-proof.json)،[التقرير](data/render-verification-report.md). quran_catalog_v2=OFF. قصRangeفيQAيستخدمmetadataمنالمرجعالكامل؛ليس مسارًاعامًامستقلًا. هذه أدلة D7 قبل إضافة واجهات A2b في الدفعة 5؛ لا تثبت قبول واجهاتها الجديدة ولا تنفّذ D5 أوD8.

## الدفعة 5 — أدوات المالك وA2b

الحالة لجميع صفوف هذا القسم: **منفذ في الكود؛ قبول الدفعة 5 معلّق**. العقود JSON تعيد `data` و`meta.requestId`؛ المشاهدة تعيد الفيديو عبر جلسة الأدمن نفسها. كل قراءة تمر بالمصادقة وRBAC وOrigin وحد المعدل، وكل كتابة تمر أيضًا بمخطط حقول صارم وتدقيق. عناوين URL الموقّعة وبيانات الدخول ممنوعة في الأدلة وبيانات المسودات والمهام المحفوظة.

| الصفحة/الإجراء | الطلب والصلاحية | التخزين أو المستهلك الحقيقي | الأثر والحدود |
|---|---|---|---|
| ابدأ من هنا | GET `/workspace`، `dashboard.read` | `AdminOwnerWorkspace`؛ المراجعات والكتالوج وقائمة عوائق الإطلاق | أعداد حقيقية وأولويات وتنبيه تجديد R2 وماذا يرى الزوار؛ لا اعتماد تلقائي |
| حالة المشروع والمساعدة | GET `/project-status`، `dashboard.read` | `docs/roadmap.json` بعد التحقق من مخططه و`docs/admin-guide.ar.md` | مراحل وأسباب حجب وخطوات للمالك؛ الوثيقة لا تُغلق مرحلة بمجرد عرضها |
| تفضيلات القراءة | GET وPATCH `/preferences`، `security.self` | `admin_preferences` حسب هوية الجلسة، مع audit عند التغيير | مريح/مضغوط وحجم 1 أو1.1 أو1.2؛ GET لا ينشئ صفًا، ولا يُعدّل مستخدمًا آخر |
| مركز المراجعة | GET `/reviews` و`/reviews/:id`، `review.read` | `human_review_items` وربط التلاوة/القارئ/المزوّد و`audit_logs` | بحث وفلاتر وعدّادات وتاريخ؛ `recitation_id` يقبلUUID ويطابق الهدف الفعّال حتى بعد إعادة الفتح. تبدأ الأولوية بالتلاوات المنشورة التي اجتازت offset؛ الأدلة مقروءة بلا منح موافقة |
| قرار بند | POST `/reviews/:id/decision`، `review.decide` | `AdminReviewWorkspace` و`HumanReviewService` | موافقة/رفض/تأجيل وملاحظة؛ الصوت يغيّر حالة هوية الصوت، والاسم يعدّل العرض. الترخيص يحتاج `providers.license.decide` ودور`super_admin` وتأكيد رمز المزوّد؛ الحقوق تحتاج `sources.write`. بقية البنود لا تصلح التوقيت أو البسملة تلقائيًا |
| معاينة وقرار جماعي | POST `/reviews/bulk-preview` و`/reviews/bulk`، `review.decide` | الأنواع المعلوماتية الآمنة في `SAFE_BULK_REVIEW_TYPES` وسجل لكل قرار | حتى100 بند فريد، ومعاينة العدد وكتابته؛ ممنوع للصوت والترخيص والحقوق والبسملة والتوقيت. التعارض المتزامن يظهر خطأ بدل طمس قرار آخر |
| إعادة فتح قرار | POST `/reviews/:id/undo`، `review.decide` وصلاحية النوع | `supersedes_id` و`target_subject_type/id` في `human_review_items`، مع audit | ينشئ بندًا معلّقًا ويحفظ التاريخ ويسحب أثر الاعتماد الحالي؛ يمنع إعادة فتح قرار تجاوزه قرار أحدث |
| غرفة الاستماع | GET `/listening/:id`، `review.read` | `recitation_audition_samples` وروابط فصول المزوّد أوIFrame الرسمي، و`recitation_voice_reviews` مع الاسم الظاهر من`profiles` | عينات فعلية ومقارنة تلاوات القارئ وسجل يحوي المراجع والتاريخ والقرار دون بريده، وربط البند والتلاوة التالية؛ قرار الصوت يستخدم endpoint المراجعة، لا زر نجاح محلي وهمي |
| ترخيص المزوّدين | GET `/provider-licenses`، `providers.read` | `audio_providers` و`docs/data/provider-terms-digest.md` | ملخص الوصول والاستخدام التجاري والإسناد والشروط؛ غياب ملخص المزوّد يظهر غير متحقق. القرار يستخدم `/reviews/:id/decision`، ولا تمنح القراءة صلاحية اتخاذه |
| الأسماء الوصفية | GET `/labels`، `recitations.read`؛ POST `/labels/:id/approve`، `review.decide` و`recitations.write` | التلاوات التي تحتاج مراجعة اسم وبندها الفعّال | تعديل الاسم المعتمد مباشرة وتسجيل القرار؛ لا تعديل للنص القرآني |
| قائمة الإطلاق والمعاينة | GET `/launch-readiness`، `review.read` | بوابات `isPubliclyVisible` و`publicVisibilityCodes` وتغطية الفصول ومحلل جاهزية الملفات المرخّصة | تعرض من قد يظهر وسبب كل استبعاد بافتراض فتح الكتالوج؛ `can_open=false` ولا تكتب العلم أو تنشر تلاوة |
| حالة التخزين وخطوات التجديد | GET `/storage`، `storage.manage` | إعدادات المحول و`storage_objects` و`R2_TOKEN_EXPIRES_AT` غير السري | تاريخ غير مسجل يُعلن غير متاح؛ الاستخدام من سجل القاعدة يحمل `database_manifest` ولا يدّعي قياس الحاوية |
| اختبار اتصال التخزين | POST `/storage/test`، `storage.manage` | قراءة فعلية لـR2 عبر `listObjects` مع cache خمس دقائق وaudit | يعرض الحجم وعدد الكائنات بمصدر `r2_list`؛ هذا الاختبار قراءة قائمة، لا يدّعي تجربة رفع كائن |
| التلاوات والملفات المرخّصة | GET `/licensed-audio` و`/:id`، `sources.read` | تلاوات YouTube ومسودات الملفات المرخّصة و`storage_objects` و`recitation_source_urls` | التوافر للريندر يحسب عبر محلل الحقوق وoffset والتغطية، ولا يساوي مجرد عدد الملفات المرفوعة |
| حقوق ملفات التلاوة | POST `/licensed-audio/:id/rights`، `review.decide` و`sources.write` | بند `youtube_rights` أو`storage_rights` الفعّال؛ حقول حقوق YouTube عند انطباقه | موافقة بشرية ودليل وملاحظة. الاعتماد القديم الذي أعيد فتحه لا يجيز الرفع أو المصدر |
| بدء رفع | POST `/storage/uploads`، `storage.manage` | `CatalogStorageAdminService` ثم`storage_objects` ورفع مباشر إلىR2 | recitationId/surah وSHA وحجم ونوع وrightsRef؛ حقوق معتمدة قبل البدء. حاوية ومفاتيح مقيدة بالخادم، لا تنزيل منYouTube |
| الاستئناف وأجزاء الرفع | POST `/storage/uploads/:id/resume` و`/parts`، `storage.manage` | حالة multipart الفعلية وروابط presigned مع تدقيق وصف آمن | يرجع الأجزاء الموجودة ورابط الجزء؛ لا تُحفظ القدرات الموقّعة فيaudit |
| إنهاء الرفع أو إلغاؤه | POST `/storage/uploads/:id/finish` أو`/abort`، `storage.manage` | إكمال أوإلغاء multipart فيR2 وتحديث حالة الملف | finish يعيد «مرفوع» ومعرّف مهمة تحقق، لا«متحقق». abort يرفض الرفع؛ الأخطاء الفعلية ظاهرة |
| تشغيل ومتابعة التحقق | POST `/storage/uploads/:id/verify`، `storage.manage`؛ GET `/storage/tasks/:id`، `sources.read` | `admin_media_tasks` وBullMQ `ayahx-admin-media-v1` وFFmpeg/ffprobe في عملية خارجية | SHA وffprobe فعليان؛ lock120s وتجديد30s وتزامن1. غياب مرجع offset مستقل يبقي المهمة بحاجة مراجعة ويُفشل المهمة صراحةً، لا نجاح صامت |
| مقارنة مصدر مرشح | POST `/licensed-audio/:id/candidate`، `sources.write` | مهمة BullMQ ومقارنة SHA للصوتPCM المفكوك مع التسجيل المرجعي | المضيف مسموح ولا fallback. YouTube يحتاج ملفًا مرجعيًا مرخّصًا ومتحققًا؛ غيابه يعلن `CANDIDATE_REFERENCE_FINGERPRINT_UNAVAILABLE` |
| خيارات المعالج وفحصه | GET `/reciter-wizard/options` وPOST `/reciter-wizard/validate`، `recitations.write` | مزوّدون وروايات ومراجعQUD مستوردة، واختبار روابط البداية/الوسط/النهاية أوoEmbed الرسمي | فحص حي مسجل؛ URL الخاص أوالموقّع مرفوض. لا استعارة نص أوتوقيت ولا نجاح بديل حين يفشل المصدر |
| إنشاء مسودة بالمعالج | POST `/reciter-wizard`، `recitations.write` و`reciters.write` | `reciters` و`recitations` والفصول عند نمط الروابط وبنود مراجعة معلّقة | intent قابل للإعادة دون تكرار؛ غير منشورة، offsetغيرمعتمد، المجهولNULL. QUD يربط `timing_reference_recitation_id` فقط، بلا نسخ توقيت أوإرث اعتماد |
| خيارات تجربة الفيديو | GET `/render-lab/choices` و`/:id` و`/:id/:surah`، `render.test` ودورadmin/super_admin | أهليةD7 ونطاقات التغطية الفعلية عبر منشئmanifest | يعرض المتاح تقنيًا ومدى الآيات الصحيح؛ لا يفتح الكتالوج أويتجاوز سياسة المصدر |
| الإنشاء والحالة والمشاهدة | POST وGET `/render-lab/jobs`؛ GET `/render-lab/jobs/:id` و`/:id/media`، `render.test` ودورadmin/super_admin | `RenderLabService` والطابورالقائم وSkia و`qa_report_json` | القائمة أحدث20 مهمةv2 بحالة آمنة دونmanifest أو مسار التخزين. 202 للإنشاء،≤90ثانية وتزامن1؛ مدة ومزامنة وتظليل وبايتات فعلية. المشاهدة مصادق عليها وتُرفض بعد انتهاء الصلاحية؛ Range للملف المحلي |
| حذف تجربة الفيديو | DELETE `/render-lab/jobs/:id`، `render.test` ودورadmin/super_admin | حذف الناتج الفعلي ثم تفريغ مؤشره معaudit | لا حذف لمهمة نشطة أوتاريخها. نتائجv2 الجديدة وصولها23ساعة وجامع الملفات كل30دقيقة بهامش حتى24ساعة عند سلامة الخدمة؛ سياسةv1 القائمة لا تتغير |

لا يفوّض هذا الربط الوكيل بتأكيد صوت أوترخيص أواسم أوحقوق أوالبسملة. كل بنود الإنتاج البشرية تبقى معلّقة أثناء تحقق هذه الدفعة. يمكن للمالك وحده اتخاذ القرارات لاحقًا من المسارات المأذونة. لا يوجد في هذه الدفعة محاذاةD5؛ الملفات الجديدة التي تفتقر إلى دليل offset مستقل مرتبط بالتلاوة والسورة وبصمة الملف تبقى بحاجة مراجعة (`LICENSED_OFFSET_REFERENCE_UNAVAILABLE`). الفحص الآلي لا يحل محل هذا الدليل أوالمراجعة البشرية.

مرجع البروفة المجهزة: `scripts/a2b-local-acceptance.ts` على استعادة محليةMySQL9.7.2 وRedis فعليين؛ الوكيل الرئيسي وحده يشغّلها. لا تُسجل نتيجة قبول حية هنا قبل خروج تقريرها والتحقق الإنتاجي. حسابQA الإنتاجي المؤقت مخصص للقراءة فقط وتنظيفه مطلوب؛ لا يُستخدم لاتخاذ أي قرار من الصفوف أعلاه.

## الإعدادات ذات المستهلك العام

| المفتاح | المستهلك الحقيقي | ما أثبته اختبار HTTP المحلي |
|---|---|---|
| `availability_mode` | `RecitationCatalogService` و`chapterSql` | complete_only مقابل ayah_ranges يؤثر في الفصول ونطاقات القراءة العامة |
| `voice_gate_policy` | `publicCatalogSql` و`isPubliclyVisible` | require_confirmed يحجب auto_verified؛ allow_auto_verified يقبله عند اكتمال بقية الشروط |
| `show_timing_badges` | إسقاط presentation في `listRecitationsForReciter` | إخفاء timing_level/timing_quality في استجابة التلاوات العامة |
| `default_attribution_text` | نسبة التلاوة ثم المزوّد ثم الافتراضي المسجّل | يصل النص الافتراضي حين لا توجد نسبة أكثر تحديدًا؛ لا سر ولا نص قرآني |
| `storage_adapter` | `readCatalogSettings` وطبقة التخزين التشغيلية | للقراءة فقط في السجل؛ ليس toggle واجهة لتغيير التشغيل |

## الأدلة والحدود

مراجع القبول: [A1 المحلي](data/a1-local-acceptance.json)، [A2a HTTP](data/a2a-http-acceptance.json)، [مراجعة الواجهة](admin-ui-review.md)، [الدليل](admin-guide.ar.md). A2a: 29 endpoint × سبعة أدوار، و43 كتابة ناجحة بسجل مجمّع واحد لكل كتابة؛ اختُبرت القراءات العامة الحقيقية بعد التغيير دون network mocks، والتوقيت تحت 50ms. وحدات mock لا تُستخدم كبديل عن هذه البروفة.

خمسة تدفقات متصفح محلية ناجحة على الجهازين بحسب التشغيل الرئيسي؛ Back المرفوض والمقبول نجحا في إعادة فحص مكتبية محددة بعد تثبيت listener المبكر. إعادة المجموعة الكاملة على الجهازين تنتظر نتيجتها؛ راجع المراجعة للحدود الدقيقة.

حدود الدفعة5: CI/SUCCESS/health/لوج عشر دقائق وsmoke والفوترة ومهام المالك معلّقة حتى يضيف الوكيل الرئيسي أدلتها. أدوات قرار A2b منفذة ولا تتخذ بها جهة التنفيذ أي اعتماد بشري علىproduction. لا تنفيذD5 أوD8، ولا استيراد جديد من زر الأدمن، ولا تغيير في الواجهة العامة أوطريقة الريندر. علامة الإطلاق مقفلة في الخادم؛ تعديل مدة احتفاظ تجربةv2 ومسارات مشاهدتها وحذفها خاص بالأدمن.
