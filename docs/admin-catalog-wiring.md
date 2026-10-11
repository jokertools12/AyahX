# ربط A2a الفعلي

هذه طبقة A2a فقط. لا تحرير للتوقيت، ولا تأكيد صوت، ولا استيراد طابور، ولا معالج مصادر جديدة، ولا زر نشر قسري. جميع المسارات تُسجل في router الأدمن المشترك، بصلاحيات دقيقة وOrigin وRedis rate limit وZod و`no-store`، وتعيد `{data,meta}`.

## تركيب runtime بواسطة root

```ts
const catalogAdmin = new AdminCatalogService(
  db, new RecitationAdminService(db, source), new AdminCatalogImageValidator(),
  row => catalogService.publicVisibilityReasons(row),
);
registerCatalogAdminEndpoints(register, {
  db, catalog: catalogAdmin, read: new AdminCatalogReadService(db),
  tasks: new AdminCatalogTaskService(db), reviews: new HumanReviewService(db),
});
const catalogTasks = new AdminCatalogTaskWorker(
  db, (id, context) => access.actorForUser(id, context),
  new CatalogPeriodicLinkChecker(db, undefined, source),
);
catalogTasks.start(); // lifecycle التطبيق الحالي فقط
await catalogTasks.close(); // قبل إغلاق pool
```

تُحقن `publicVisibilityReasons` إلزاميًا في runtime الحقيقي حتى يعرض الأدمن بوابة الملف المرخص نفسها المستعملة في القراءة العامة. يمكن تركها في اختبارات الوحدات المعزولة فقط. لا خدمة Railway جديدة ولا DDL عند التشغيل.

| إجراء الأدمن | الكاتب الفعلي | الجداول | المستهلك والدليل المطلوب |
|---|---|---|---|
| ملف القارئ والتمييز | AdminCatalogService.profile | reciters + audit_logs | listReciters للاسم/الصورة/التمييز؛ HEAD صورة HTTPS مثبتة DNS/TLS؛ لا تغيير slug |
| ظهور القارئ | readerVisibility | reciters.is_visible | publicCatalogSql وisPubliclyVisible وقراءة التلاوة المباشرة |
| أسماء التلاوة والملاحظات | RecitationAdminService.updatePresentation | recitations | listRecitationsForReciter |
| الظهور العام | RecitationAdminService.setPublic | recitations.is_public | القاعدة الواحدة publicVisibilityCodes؛ لا تعديل status |
| الافتراضي | RecitationAdminService.setDefault | recitations.is_default_for_reciter | الافتراضي الوحيد للقارئ، ترتيب قراءة التلاوات |
| ترتيب/تراجع | reorderSlots + transaction | reciters/recitations.sort_order | استبدال مواقع الصفوف المختارة فقط؛ غير المختارة لا تُنقل لآخر القائمة؛ فصل featured |
| نقل/دمج | moveRecitationInTransaction | recitations + recitation_voice_reviews + reciters.is_visible | دمج بتغطية صريحة لكل تلاوة؛ معاملة واحدة؛ default/public صفر والصوت unverified |
| تعطيل رابط | sourceActive | recitation_chapters.is_enabled / recitation_source_urls.is_active | chapterSql وgetAvailability وresolver؛ لا مساس بالتوقيت أو النص أو الرابط |
| ترخيص المزوّد | HumanReviewService.reviseProviderLicense | audio_providers + human_review_items + audit_logs | super_admin + providers.license.decide، تأكيد code ودليل permitted؛ لا تغيير قرارات تاريخية |
| تعطيل رواية | endpoint audited transaction | riwayat.is_active | publicCatalogSql + القراءة المباشرة؛ النص القانوني لا يتغير |
| شارات التوقيت | A1 settings registry | system_settings.show_timing_badges | presentationSettings وحقول شارات قائمة التلاوات الفعلية |
| الإسناد الافتراضي | A1 settings registry | system_settings.default_attribution_text | record attribution ثم provider attribution ثم النص الافتراضي؛ لا تغيير روابط الصوت |
| إعادة الإتاحة | persisted leased task | admin_catalog_tasks + أعمدة إتاحة الفصول + audit_logs | computeChapterAvailability نفسه، حساب 100% محفوظ، لا force status |
| فحص الروابط | checkRecitation | chapter/source health + tasks + immutable audit + conflict reviews | فحص HEAD/Range الحالي وRetry-After والتعارض العالمي؛ لا تنزيل/استضافة/تأكيد صوت |

## القراءة وحالات التعذر

قوائم ≤100 ببحث literal وsort allowlist. مصفوفة الفصول LEFT JOIN على quran_surahs الحي؛ لا عدد ثابت في كود المصفوفة. المصادر تعرض الرابط العام الدائم فقط، أو `url_state=private/absent`. provider detail يعرض أدلة المضيفين الفعلية من audit، وصحة الروابط وحد المعدل الموجود في CatalogAudioSource.

Quran integrity يعيد حساب SHA من النص القانوني المرتب نفسه، مقارنةً بنسخة النص الفعالة؛ النص والآيات والكلمات readonly. الخطوط الستة مقررة بدليل corpus D1، ومسارها `/fonts/*.ttf` مع حالة وجود الأصل الفعلية. لا تغيير في picker العام. التوقيت يعرض JSON المخزن والكلمات القانونية ونتيجة normalizeTiming، ويعلن مخالفات المخزن دون إصلاحه.

## المهام والاستئناف

المفتاح `intent_id` يُنشأ مرة لكل إجراء من الواجهة. إعادة نفس النية تعيد نفس الصف، وتغيير actor/type/recitation بنفس ID يرفض409. المهمة لا تعتمد على flag الإنتاج؛ تفويضها صريح ومحدود. periodic checker المعتاد يبقى محكومًا بالـflag.

الادعاء بمعاملة وlease120s؛ stale lease قابل للاستئناف. فحص الروابط يعمل دفعات20 ويحفظ completed_keys بعد كل دفعة، مع إعادة فحص RBAC قبل الكتابة. إعادة الإتاحة تُحسب من البيانات الفعلية لكل سورة، وتحفظ checkpoint حقيقيًا وتعيد حساب الفصول السابقة بأمان بعد الانقطاع. تتأكد من ثبات مصدر التوقيت داخل معاملة قبل أي تغيير إتاحة. العمليات الثقيلة تُرجع للـevent loop؛ خطأ أو صلاحية مسحوبة يظهر failed/error_code وله audit ولوج منقح. لا try/catch صامت.

## قبول محلي — ينفذه root وحده

`scripts/test-admin-catalog-local.ts` يرفض أي host خارج localhost/127.0.0.1/::1 وأي إصدار غير9.7.2. يحتاج `A2A_MYSQL_URL` خاصًا و`--allow-local-fixture-writes`. ينشئ fixtures من مصدر منشور كامل حقيقي في النسخة المحلية، دون صوت أو تعديل النص القانوني. عبارة ترخيص الاختبار معلنة بأنها fixture وليست موافقة قانونية للمزوّد الأصلي. يستعمل RBAC المحفوظ الحقيقي وaccount الموجود دون تعديله؛ يعيد الإعدادات والرواية والترتيب، ويحذف fixtures الخاصة به فقط. يبقى audit append-only؛ لا يمحوه.

يقيس: الملف/الظهور/الافتراضي/الرابط/الرواية/ترتيب مع تراجع/نقل/دمج/بوابة الترخيص/الطابور المحلي الفعلي المحفوظ/المصفوفة/validator/consumer الشارات/بصمة النص وحماية حسابات الأدمن. اختبارات HTTP/RBAC/Origin/Redis/Chromium والنشر من اختصاص harness root؛ لا يُقدّم اختبار الخدمة وحده كبديل لها. يجب تسجيل نتيجته الحقيقية في التقرير النهائي، ولم ينفذه الوكيل الفرعي.
