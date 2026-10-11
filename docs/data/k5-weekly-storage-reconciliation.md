# K5 — المصالحة الأسبوعية، 2026-10-10

`CatalogWeeklyStorageReconciliation` خدمة خادم مستقلة، لم تُربط هنا بـ`catalogRuntime.ts` لأن الجذر يملك التشغيل والإغلاق. واجهتها `start()` و`runOnce()` و`close()` و`status`. يبدأ `start` فحصًا واحدًا عند التشغيل ثم كل سبعة أيام، ولا يبقي timer العملية حيّة. يمنع التداخل داخل العملية؛ وعند كتابة التقرير يعيد فحص آخر audit تحت القفل المشترك في `catalogDatabaseFromPool` لمنع تكرار تقرير replicas أو إعادة التشغيل خلال الأسبوع نفسه.

أول قراءة هي `system_settings.storage_adapter`. القيمة الغائبة تعني `url_reference`، وتلك الحالة لا تستدعي مصنع التخزين أو تقرأ credentials أو `storage_objects` أو تكتب ملفًا/تقريرًا. القيم غير المعروفة والإعداد المعلّم secret تُرفض بفشل معلن. عند `r2` يستدعي `storageProvider({adapter:'r2',access:'read_only'})` فقط؛ عقده لا يتيح تنزيل صوت أو توقيع روابط أو رفع أو حذف. الجذر يحقن مصنع القراءة المنفصل `catalogStorageFromEnvironment` بعد قراءة الإعداد، ولا يستعير رمز الكتابة.

القراءة تحدد أعمدة metadata المطلوبة فقط من `storage_objects` للمحول والـbucket الفعليين، وتستبعد deleted. تطابق LIST مع تلك الصفوف وتُبلغ عن الأيتام والمفقود وفروق الحجم؛ pending/rejected لا يُعتبر غيابها فقدًا. لا تغير الصفوف أو حالة الرفع ولا تحذف كائنًا. أسماء الأيتام تُحفظ hashes فقط حتى لا ينسخ اسم مجهول token أو مادة أخرى في التقرير. المفاتيح القانونية للـmanifest محددة بنمط licensed/slug/surah/SHA، والقيم والأحجام والبصمات تُتحقق قبل الكتابة. هذا فحص metadata، وليس إعادة حساب SHA لمحتوى الصوت الموجود في R2.

`writeReport` dependency إلزامية، ويُصدّر `privateStorageReportWriter(directory)` ملف JSON جديدًا باسم UUID مع `wx` وmode600 في مجلد مطلق خاص غير tracked، دون إزالة ملفات. الملف يتضمن manifest metadata وSHA والتقرير فقط، بلا صوت أو روابط موقعة أو حقوق/ملاحظات/offset evidence/upload IDs أو credentials. يكتب بعد إعادة فحص due داخل المعاملة وقبل audit؛ إذا فشلت معاملة audit بعد الملف يبقى ملف التقرير محفوظًا ولا يُعد الأسبوع ناجحًا، ويعلن الفشل. لا يصدر مسار الملف في logs. audit action=`storage.weekly_reconciled` يتضمن نسخة التقرير والبصمة؛ لا نجاح في اللوج قبل commit. أي فشل يعلن state=failed ورمزًا ثابتًا في اللوج، دون نص خطأ SDK/DB قد يحمل أسرارًا، ولا إعادة محاولة متسارعة.

عقد ربط الجذر:

```ts
const weekly = new CatalogWeeklyStorageReconciliation({
  db: catalogDatabaseFromPool(pool),
  storageProvider: ({adapter, access}) => catalogStorageFromEnvironment(adapter, access, []),
  writeReport: privateStorageReportWriter(privateUntrackedReportDirectory),
});
weekly.start();
// قبل إغلاق MySQL عند shutdown:
await weekly.close();
```

لا يُنشئ الربط خدمة Railway جديدة، ولا يغير storage_adapter، ولا يشغل R2 عند url_reference. مسار التقارير يجب أن يحدده الجذر ضمن مجلد خاص خارج المستودع. لنسخة مرجعية تدوم خارج إعادة نشر الحاوية، يحقن الجذر sink خاصًا مستديمًا أو يستخرج JSON من audit_logs إلى ملف؛ المجلد المؤقت وحده لا يضمن ذلك. قفل المعاملات المشترك شرط استخدام DB adapter الحقيقي، وليس افتراضًا عن أي fake أو pool غير محول.

الأدلة في الاختبارات الجديدة: 14 حالة ناجحة تشمل الخمول، default/رفض الإعداد، التقرير والبصمة، checkpoint أسبوعي، سباق replicas، تغيير الإعداد أثناء الفحص، الأخطاء بلا أسرار، فساد metadata/audit، فشل كتابة الملف بلا نجاح وهمي، إسقاط محتوى DB غير المختار، التداخل والإغلاق، timer أسبوعي، وكتابة/قراءة ملف JSON حقيقي تحت TEMP بقي محفوظًا. مع وحدات التخزين والـlink checker: 54/54 ناجحة، strict TypeScript وlint للملفين الجديدين ناجحان. الـDB والتخزين في هذه المجموعة محاكاة وحدات؛ **لم يُنفذ MySQL أو R2 حي لهذه الخدمة في مهمة الوكيل الفرعي**، ولم يُطلق أي S3 helper ولم تُحذف ملفات. يلزم الجذر إثبات الربط والخمول على الإعداد الفعلي؛ قبول R2 الحقيقي ما زال غير مكتمل وفق التقرير السابق.
