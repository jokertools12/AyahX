# قبول مهام المالك M1–M12

يشغّل الجذر وحده `node scripts/admin-human-acceptance.mjs --manifest ABS_PRIVATE_JSON --output ABS_PRIVATE_DIRECTORY`. الخيار `--production-read-only` إلزامي للإنتاج، و`--headed` يعرض المتصفح. الاختبار لا يحتوي عميل MySQL أو طلبات قرار من Node؛ كل انتقال وقرار محلي ورفع وإنشاء فيديو يمر بالواجهة الفعلية. لا mocks ولا تعبئة cache للنجاح. `--tasks M1,M2` للتشخيص فقط ويُنتج تقريرًا جزئيًا لا يُقبل بوصفه نجاح الدفعة.

قبل كل مهمة تُفتح صفحة «ابدأ من هنا» خارج القياس. ثم تُحسب نقرات المؤشر وتفعيلات لوحة المفاتيح بالتساوي، بما فيها اختيار القوائم، وفق الحدود الأصلية 4/4/3/3/2/5/10 خطوات/6/2/3/4/2. تُملأ الحقول بعد الوصول إليها بـTab الحقيقي، ويُسجّل عدد Tab والحقول والاختيارات منفصلًا؛ لا focus برمجي ولا انتقال URL أثناء المهمة. معالج الإضافة يُقاس بخطواته كما طلب المالك، مع إظهار النقرات أيضًا. انتهاء طلب ناجح لا يكفي للصوت أو الفيديو: يشترط التشغيل الحقيقي وتقدم currentTime، كما يُقرأ دليل النقص ويطابق عدده.

في المحلية تُستعمل أهداف قابلة للحذف موسومة `BATCH5_HUMAN_QA` في النسخة المستعادة. يبدأ قرار حقوق صوت الاختبار pending، ثم يُنفّذ محليًا عبر الواجهة قبل اختيار الملف ورفعه؛ لا اعتماد لحقوق أو صوت حقيقيين. البصمة والملف يخصان صوت اختبار مملوكًا، ولا استخراج من YouTube. لا يعيد الاختبار تشغيل قرار سابق أو يصطنع هوية مزوّد عند غياب fixture؛ التحضير والتنظيف للجذر. مهمة الإخفاء تعيد حالة القارئ الأصلية داخل ميزانية الثلاث نقرات.

في الإنتاج يمنع معترض الشبكة كل كتابة للتطبيق عدا الدخول والخروج لحساب QA نفسه. المهام تُسجَّل صراحة باعتبارها نسخ قراءة: فتح الأدلة وتشغيل العينة ومشاهدة فيديو موجود وقراءة المعالج، بلا تأكيد أو حفظ أو رفع أو إنشاء. يحتاج عرض الفيديو إلى مسار UI حقيقي لنتيجة إنتاج موجودة؛ غيابه يفشل M8 ولا يُستبدل بفيديو وهمي أو طلب إنشاء. المواقع الخارجية تُسمح من قائمة origins صريحة؛ PUT للتخزين مسموح فقط محليًا إلى origins المفوّضة، وطلبات دورة الرفع مرتبطة بمعرّف عاد فعلًا من prepare الخاص بالهدف الموسوم.

الـmanifest الخاص خارج Git: `version:1`، `fixtureTag:"BATCH5_HUMAN_QA"`، `mode:"local-mutations"|"production-read-only"`، `baseUrl` أصل بلا مسار، `authFile` مطلق لملف `{email,password}`، و`tagAttestation` بالمفتاح المناسب `localTargetsAreDisposable:true` أو `productionTargetsReadOnly:true`. يوجد `allowedReadOrigins` و`allowedUploadOrigins` كقائمتين صريحتين لأصول HTTPS دون مسارات أو أسرار. حقول targets:

| الهدف | الحقول |
|---|---|
| voice | recitationId, reviewId, reciterNameAr |
| provider | providerId, reviewId, code, name |
| label | recitationId, reciterNameAr, labelArBefore, labelArAfter |
| reader | id, nameAr, visibleBefore |
| hidden | recitationId, labelAr, reasonText |
| youtube | recitationId, labelAr, surah, rightsReviewId, rightsEvidenceRef, audioFile, sha256 |
| wizard | nameAr, nameEn, country, photoUrl, displayLabelAr, slug, providerId, riwayahCode, pattern, reference |
| render | reciterId, recitationId, surah, ayahFrom, ayahTo, existingJobId للإنتاج |
| nearComplete | recitationId, labelAr, surah, missingWords |

حقول الإنشاء وملف الصوت غير مطلوبة في نسخة الإنتاج القرائية، لكن معرّفات الأهداف القرائية مطلوبة. يجب أن تظهر أهداف القارئ والتلاوة في أول صفحة محلية بترتيب التحضير؛ لو احتاج الوصول نقرات إضافية تفشل المهمة، ولا يغيّر الاختبار ترتيب القاعدة من نفسه.

تقرير JSON وصورة كل مهمة خارج Git، ولا تُرفع في CI العامة. لا يخزن values للحقول أو cookies أو traces أو URLs موقعة أو أخطاء Playwright الخام؛ أخطاء المصادقة تُحوَّل إلى أكواد ثابتة لأن call log قد يحمل كلمة المرور. هذه الشريحة تحضّر الاختبار فقط؛ نتيجة القبول الفعلية تتطلب تنفيذ الجذر على المحلية والإنتاج وتوثيق ما نجح وما أخفق.
