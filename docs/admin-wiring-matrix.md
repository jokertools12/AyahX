# مصفوفة ربط الأدمن — A1 وA2a

المرجع الفعلي: `server/routes/admin/adminA1Endpoints.ts` و`server/routes/adminCatalog.ts` و`server/routes/catalog.ts` وخدماتها، مع `src/admin/pages` و`src/admin/pages/catalog`. المسارات في الجدول تبدأ بعد `/api/admin` إلا حين يُذكر خلاف ذلك. كل mutation مأذون يسجل `audit_logs` داخل معاملته؛ منع UPDATE/DELETE للسجل على مستوى MySQL. الأذونات الفعلية محفوظة في `admin_roles` و`admin_permissions` مع توسيع `user_roles`؛ لا يُفترض وجود جداول جديدة باسم `roles` أو `role_permissions`.

الحالات: **موصول ومتحقق HTTP محليًا** تعني تنفيذ الطلب الفعلي على القاعدة المحلية، وليست إثباتًا لنشر production. **واجهة موصولة؛ E2E معلّق** تعني أن المكون يستدعي العقد الفعلي وأن نتيجة تدفق المتصفح النهائي لم تُثبت بعد. نتائج اللقطات وaxe تخص عرض الصفحات، ولا تحوّل كل زر تلقائيًا إلى تدفق ناجح.

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
| علم الكتالوج | GET `/flags`، `flags.read`؛ PATCH `/flags/quran_catalog_v2`، `flags.write` و`launch.manage` | `system_settings` ثم `readCatalogSettings` و`RecitationCatalogService` | تأكيد مكتوب؛ فتح محلي للاختبارات فقط، يبقى production مغلقًا |
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

حدود التشغيل: production/CI/SUCCESS/health/لوج عشر دقائق وsmoke والفوترة معلّقة حتى يضيف الوكيل الرئيسي أدلتها. لا اعتماد صوت A2b، لا تنفيذ D5، لا استيراد جديد من زر الأدمن، ولا تغيير في الواجهة العامة أو الريندر. علامة الإطلاق لا تُفتح في production في هذه الدفعة.
