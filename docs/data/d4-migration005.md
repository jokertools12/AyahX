# migration005 — المراجعة البشرية والمصادر المرخصة

تستدعى صراحة من الجذر فقط ولا تدخل startup. المصدر: `server/db/migrations/005_addHumanReviewsAndLicensedSources.ts`. يخرج `humanReviewMigrationSql()` SQL حتميًا، ويطبقه `upHumanReviewsAndLicensedSources(db)`.

الجداول الجديدة فقط: `recitation_youtube_sources`، `storage_objects`، `human_review_items`. لا FK إلى الجداول القديمة. كل عمود نصي يذكر charset/collation صراحة؛ URLs ومعرفات الفيديو والبصمات ومفاتيح الكائنات وsubject_id تستخدم `utf8mb4_bin`، ونصوص العرض `utf8mb4_unicode_ci`. إضافات recitations/source_urls كلها NULLable، وتوسيع ENUM الصوت يحفظ جميع الحالات القديمة ويضيف auto_verified فقط. لا تنشئ migration تلاوة أو ترخيصًا أو دليل صوت، ولا تنقل flag.

`recitation_source_urls.url` يصبح NULLable لملف مرخص مرتبط بـ storage_object_id دون حفظ presigned URL. الفهرس الفريد `(adapter,bucket,object_key)` يمنع استبدال الكائن؛ السجلات القديمة لمصادر الروابط لا يُعاد تصنيفها بصمت. خدمة البدائل تختار نوعها صراحةً عند الإدراج.

النزول `downHumanReviewsAndLicensedSources(db,'local-rehearsal')` محلي فقط: يتحقق أولًا من عدم وجود auto_verified أو مصدر URL=NULL كي لا يختزل حالة أو يخترع رابطًا؛ ثم يعيد ENUM الصوت وurl NOT NULL، ويسقط الجداول الثلاثة والأعمدة الجديدة. إذا رفض guard فهذا دليل بيانات لا تُفقد؛ تُراجع fixture محليًا قبل النزول، ولا يُخفض الصوت تلقائيًا. DDL implicit commits: النسخة المحلية القابلة للرمي هي مرجع بروفة النزول، ولا يوجد down للإنتاج.

اختبارات الوحدات تقرأ SQL ولا تثبت بروفة MySQL. القبول الفعلي للجذر على MySQL9.7.2: up مرتين، قراءة COLLATION/nullability، enqueue مرتين (الثانية صفر)، قراران متزامنان لنفس review (قرار واحد وسجل صوت واحد)، منع system من confirmed/permitted، قراءة LaunchReadiness مع flag مغلق، down ثم up، وثبات D1/D3/admin. يسجل الجذر أوامر ونتائج البروفة؛ هذه الصفحة لا تدعي تنفيذها.

إعادة تشغيل seeder لا تعيد فتح approved/rejected/deferred ولا تغير أدلتها، وتحدث أدلة pending فقط مع تدقيق. كل قرار human-only ومقفل بـ FOR UPDATE؛ قرارات voice/provider/label تتطلب صلاحية نوعية إضافة إلى reviews.decide. بقية الأنواع تسجل القرار فقط؛ لا تغير التوقيت أو بسملة الصوت أو catalog guard وراء المستخدم.
