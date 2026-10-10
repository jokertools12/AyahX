# migration004 — نطاق الإضافة وخطة الرجوع

T1 تضيف أعمدة nullable إلى recitations/recitation_chapters/audio_providers، والجداول recitation_audition_samples/recitation_voice_reviews/recitation_source_urls، وأربعة فهارس. لا FK جديد، ولا تشغيل عند startup، ولا تعديل أعمدة D1/D3 أو status/offset/البسملة في T1. كل النصوص utf8mb4_unicode_ci؛ روابط المصادر وterms_url utf8mb4_bin لحفظ دلالة المسار والحالة.

الحقول verification_method وpublished_by/published_at تدعم قرار v2 والنشر التقني، وlicense_status/terms_url تدعم قرار ترخيص المزوّد المستقل. لا حقل سري. رابط البديل لا يصبح فعالًا دون قرار الأدمن ودليل نفس التسجيل؛ identity_evidence وrecording_sha256 وapproved_by لحفظ ذلك القرار. المعاينة كاملة السورة تسمح duration_ms=NULL بدلالة whole chapter، لأن مدة الصوت لم تُقَس بعد؛ لا مدة مختلقة.

`catalogServiceMigrationSql()` حتمية وتفحص information_schema قبل كل ADD؛ تشغيلها مرتين لا يغيّر الأعمدة أو القيم. `downRecitationCatalogServices(...,'local-rehearsal')` تسقط جداول T1 الثلاثة والفهارس الأربعة ثم الأعمدة المضافة فقط، وتعاد up بنفس schema. لا أمر down للإنتاج. down يفقد بيانات إدارة D4، ويُستخدم فقط في نسخة محلية قابلة للاستغناء؛ لا يعكس نشر rule-v1 المستقبلي أو تغيير قيد نشر D2، وهما خارج T1.

البروفة الفعلية على MySQL9.7.2: نسخة محلية مستقلة من بيانات D3، migration×2/down×2/reapply، nullable/collation والفهارس وصفرFK جديد، ثبات إسقاط الأعمدة الأصلية وبصمات D1/D3/admin، وبقاء422463 صفًا. [القبول](d4-t1-local-migration.json). محاولة الفحص الأولى قارنت CHECKSUM TABLE قبل/بعد إضافة الأعمدة، فأخفقت لأن checksum يتضمن الأعمدة الجديدة؛ حفظت نتيجتها وصححت المقارنة إلى الأعمدة الأصلية دون تغيير معيار الثبات. [الإخفاق والتشخيص](d4-t1-first-rehearsal-failure.json).

تعارض النشر: chk_catalog_publish القديم يشترط بسملة صوتية verified/not_applicable، بينما قرار DECISIONS السابق المعتمد يسمح بقص أول كلمة ويبقي البسملة unverified ويصرّح تعديل القيد في D4. T1 تظل إضافية فقط؛ يُعالج توافق النشر في T6 بعملية مستقلة موثقة وبنسخة مشفرة جديدة متحققة قبل DROP للقيد. لا تعيين تحقق بسملة وهمي. quran_catalog_v2 يظل مغلقًا، والصوت والترخيص قرارات بشرية مستقلة.
