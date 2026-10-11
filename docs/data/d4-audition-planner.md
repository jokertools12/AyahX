# مخطط عينات الاستماع النقي — D4 / T5

`server/services/recitationAuditionPlanner.ts` يختار ثلاث عينات من metadata الفصول ونتائج فحص الرابط التي يمررها المستدعي. لا اتصال شبكة أو قاعدة، ولا تنزيل صوت أو تحويل توقيت أو قرار هوية/ترخيص. لا يستدعيه تشغيل التطبيق تلقائيًا. الجذر وحده يبني SQL الحتمي والتدقيق ويكتب الصفوف.

الإدخال: `recitation_id` الحقيقي، و`chapters` بالشكل `{surah,audio_url,chapter_offset_ms}`، و`allowed_hosts` من مزوّد التلاوة، و`link_checks` مفهرسة بالرابط الأصلي. نتيجة الرابط تستخدم حقول خدمة الفحص الحالية `status/httpStatus/contentType/finalUrl`. فحص DNS وSSRF الشبكي من مسؤولية خدمة الفحص قبل تمرير الدليل؛ هذا المخطط لا ينفذ DNS.

| sample_key | السورة المطلوبة | start_ms | duration_ms |
|---|---|---|---|
| fatiha_25s | 1 | 0 | 25000 |
| ikhlas_full | 112 | 0 | NULL |
| yasin_25s | 36 | 0 | 25000 |

25000 حد معاينة مطلوب، وليس ادعاء مدة مقاسة. NULL يشغّل ملف السورة الأصلية كله، دون اختلاق مدة. إذا غابت المطلوبة أو فشل رابطها، يختار أقرب رقم سورة لها ملف مستقل سليم؛ التعادل يُحسم للأصغر. يحتفظ المفتاح بطلب العينة، وتحدد `surah` السورة الفعلية المختارة: يجب أن تظهر الواجهة المستقبلية اسم السورة الفعلية وسبب الاستبدال، حتى لا تسمي سورة بديلة «الإخلاص» خطأً.

المصدر المستقل يشترط offset NULL أو صفر، وألا يتشارك الرابط/معرّف Drive أو الرابط النهائي مع سور أخرى. offset غير صفري أو رابط مشترك يستبعد المصدر؛ لا يحول start إلى موضع داخل ملف مجمع ولا يستعير source_offset_ms. معرّف Drive يحافظ على حالة الأحرف، مع توحيد `/file/d/ID/view` و`uc?id=ID` لنفس الملف. ترتيب query parameters لا يصنع مصدرًا مستقلًا جديدًا.

سلامة المصدر: HTTPS بلا credentials/fragment/IP literal/port غير443، host ضمن القائمة الدقيقة، منع YouTube حتى لو أدرج في القائمة، ومنع query التوقيع/الرمز/المفتاح. الفحص الممرر يلزم status=available وHTTP200/206 ونوع audio أو octet-stream، والرابط النهائي يمر بنفس الحارس. لا يحفظ الإخراج روابط مرفوضة أو موقّعة.

كل slot مطابق لأعمدة migration004: `recitation_id/sample_key/surah/start_ms/duration_ms/selection_details`. إذا لم يوجد مصدر مستقل سليم يبقى slot غير قابل للتشغيل: `selection_details.status=unavailable` وreason واضح ورابطا original/playback بقيمة NULL. لا يُفهم وجود صف slot على أنه وجود صوت. عند الاستبدال السليم يحفظ `requested_unavailable_reason` سبب رفض الأصل و`selection_reason=NEAREST_AVAILABLE_INDEPENDENT_SURAH`. لا تعتمد `unavailable_reason` وحده لإخفاء سبب الاستبدال.

تكرار رقم سورة أو offset سالب/غير صحيح يفشل صراحةً بـ `AUDITION_INVALID_CHAPTER_METADATA`؛ لا تصحيح صامت. المدخلات لا تتغير، والناتج حتمي دون ساعة أو UUID أو randomness. معرّف الصف والتدقيق والتخزين والإعادة idempotent مسؤولية أمر الجذر؛ المخطط لا يولدها.

## الدليل المحلي

- 16 اختبار وحدة نجح: المصادر المطلوبة، أقرب بديل/التعادل، NULL للملف الكامل، offset غير صفري، ملفات مشتركة وروابط نهائية مشتركة، Drive case/alias، رفض blob/HTTP/IP/توقيع/host/YouTube، روابط unchecked و404 وHTML وredirect غير مسموح، غياب كل المصادر، فساد المدخلات، وعدم تعديل المدخل.
- TypeScript strict للملفين ناجح، وlint لهما صفر تحذير/خطأ، و`git diff --check` ناجح.
- محاولة Vitest الأولى بإعداد المشروع العادي تعثرت قبل تنفيذ الاختبارات بسبب غياب node_modules في worktree (`tailwindcss` من PostCSS). لم يتغير ملف tracked لمعالجة البيئة. شُغلت الاختبارات بواسطة Vitest3.2.4 الموجود في checkout الأصلي وإعداد Node مؤقت مع PostCSS فارغ؛ المخطط لا يستعمل CSS أو DOM. اختبار المشروع الشامل والقبول الفعلي وإدراج production على الجذر بعد التقاط commit.

هذه اختبارات وحدات بمدخلات اختبار معلنة، لا تدعي روابط إنتاج أو معاينة صوت فعلية. لا قياس T7 أو تعيين voice confirmed أو license permitted.
