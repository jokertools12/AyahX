# K5 — مسار الصوت المرخّص والتخزين، 2026-10-10

هذه خدمات وعقود خادم فقط؛ لا routes أدمن قبل A1 ولا واجهة A2 ولا تغيير في الواجهة أو الريندر الحالي. `objectStorage.ts` القديم الخاص بفيديو المستخدم لم يتغير. لا كتابة قاعدة بيانات أو Railway أو Cloudflare من مهمة الوكيل الفرعي؛ migration005 عند الجذر ووكيل المراجعات.

## ما نُفذ

`AudioObjectStorage` بمحول `url_reference` افتراضي لا يرفع ولا ينسخ صوت مزوّد، ومحول `S3LicensedAudioStorage` لـR2 فقط على نطاق الحساب الدقيق. استثناء HTTP/loopback صريح `localTestOnly` للاختبار المحلي فقط. لا تنشيط بناء على وجود credentials. محول القراءة لا يقبل كتابة، والمصنع يطلب رمزي القراءة المنفصلين `R2_READ_ACCESS_KEY_ID` و`R2_READ_SECRET_ACCESS_KEY`، دون استعارة رمز الكتابة. رموز التشغيل تبقى على السيرفر ولا تدخل الاستجابات أو الأخطاء أو Git.

المفتاح `licensed/{recitation_slug}/{surah:03d}/{sha256}.{ext}`، حد الكائن 1,000,000,000 بايت، expiry ≤900 ثانية، multipart بأجزاء 8MiB. PUT وCompleteMultipartUpload يستخدمان `If-None-Match: *`، والرابط يوقع Content-Length المتوقع (لكل جزء أيضًا)، فيرفض الكتابة فوق كائن حتى عند التزامن؛ قابلية مزوّد S3 لهذه الترويسة جزء من القبول الحقيقي ولا يُزال الشرط لتعويض عدم دعمه. أجزاء ListParts والحجم/الترتيب/ETag تتحقق قبل complete. استئناف ببيانات upload_id في DB وبأجزاء الخادم، واستئناف crash بعد complete وقبل commit عبر HEAD. capabilities استجابة مؤقتة فقط، لا URL موقّع في DB أو audit.

`CatalogStorageAdminService` يتطلب actor بشري وpermission `storage.manage`، ومحدد معدل مشترك إلزامي يُحقن من A1، ومرجع حقوق **مقبول بشريًا** يخص التلاوة قبل بدء الرفع. يحفظ pending/uploaded ثم عامل `storage.verify` يحسب SHA بالتدفق ويقارن HEAD والحجم، يتحقق magic bytes وffprobe (قائمة حاويات/codecs وصوت واحد فقط ورفض أي video/صورة مرفقة)، ويحفظ rejected بسبب ثابت عند الفشل. الملفات الكاملة الخاصة بالتحقق تُحفظ مؤقتًا في scratch خاص، لا Git ولا إعادة استضافة لصوت المزوّدين. لم يُحذف أي ملف محلي بعد رفض التنظيف السابق.

`LicensedOffsetVerifier` dependency إلزامي لمحرك خادمي: ≥5 آيات فريدة، ≥3 سور مختلفة الطول، نوافذ داخلية 300ms، NCC الخام ≥0.95 أو v2 ≥0.90 مع أدلة codec/VAD وقبول استثناء بشري، |lag| وفرق المدة ≤30ms. sourceSha256 وrecitationId وsourceSurah وsourceChapterOffsetMs المقاس تُطابق الملف، ولا يُفترض offset=0 أو يُستعار offset الفيديو المركب في YouTube. v2 يحتاج human_review_items offset_exception approved للتلاوة نفسها ويُعاد التحقق من ذلك عند القراءة. التحذير >5% يحسب مقابل نهاية الكلمة في إحداثيات الملف المقاسة. خدمات K5 لا تختلق محرك offset أو نتيجة نجاح؛ غياب المحرك يرفض التحقق ولا يصير الملف جاهزًا.

نجاح التحقق يستبدل مؤشر نفس التلاوة/السورة فقط، يعطّل المصدر القديم ويجعله soft_deleted ويسجل audit ويستدعي hook إلزاميًا لإعادة فحص K4 في المعاملة. `CatalogLicensedHostedSourceService` يقبل رابط استضافة مملوكة/مرخصة بمرجع حقوق، عبر allowlist/SSRF الخادمي ومحرك تحقق مُحقن؛ لا يحمل صوت YouTube ولا يبحث فيه ولا ينسخ روابط المزوّدين. عند عدم السماح للمضيف يلزم قرار أدمن ومراجعة، لا fallback.

`CatalogLicensedSourceResolver.resolveLicensedSource(recitationId,surah)` يعيد `StorageAudioPlan` دون URL: objectKey/bucket/SHA/durationMs/sourceChapterOffsetMs/offsetEvidence. يقرأ صفًا verified فقط للتلاوة نفسها مع حقوق ما زالت approved ويقارن HEAD، ثم الجذر يحوّل التوقيت مرة واحدة بـtoRenderTimeline ويصدر presigned GET وقت الطلب أو يستخدم عميل read-only. YouTube بلا ملف متحقق يبقى غير قابل للريندر. خدمات الاستضافة المرخصة لها عقد تحقق خارجي إلزامي؛ لا تمثل نتيجة وهمية لمصدر غائب.

`reconcileAudioStorage` تقرير فقط للأيتام والمفقود والحجم، و`audioStorageManifest` يصدر metadata/SHA بلا صوت. الحذف عبر إجراء أدمن فقط: soft_deleted منذ30 يومًا، تأكيد معرف الكائن وبصمته، لا مرجع نشط، audit. تقدير التكلفة من أسعار مسجلة ومدخلة صراحة، مع تنبيهات 70% من الطبقة المجانية و>1$ و>5$؛ لا يدعي فاتورة فعلية. جدولة weekly ومركز التخزين يُربطان في التشغيل/الأدمن لاحقًا؛ هذه الدفعة لا تشغّل حذفًا آليًا أو timer غير مستهلك.

## الأدلة الفعلية والحدود

- اختبارات الوحدات: عقود الحجم/المفاتيح/expiry/مجموعات الملفات، الحساب والنطاق، القراءة فقط، عدم تفعيل credentials، Content-Length الموقع، magic/ffprobe/video، offset الخام .949999997، سور العينة وSHA، no cross-recitation، مراجعات الحقوق، الحذف والتقرير والتكلفة. القيم الصوتية synthetic داخل الوحدات فقط، لا يُعتمد بها offset إنتاج.
- دليل ffprobe حقيقي: `scripts/test-licensed-audio-probe.ts` في2026-10-10T13:53:52.091Z ولّد ملف sine مملوك32,044bytes؛ ffprobe=1000ms/16000Hz/mono/pcm_s16le/256000bps، SHA `2720c50ccc3bceb00d37a9dd9cc8134701601a0cd412ff5091d205e6c98cd26c`. رفض stream مبتور وSHA مخالف ومحرك offset غائب فعليًا. الدليل الخاص `%TEMP%/ayahx-k5-probe-acceptance.json`. ليس اختبار S3/R2 ولا تلاوة قرآن.
- R2 الحقيقي غير متحقق: أُزيلت أدوات Cloudflare من الجلسة؛ آخر قراءة عند الجذر buckets200/فارغة ولا رموز أو تفعيل مثبت. لا R2 create/upload/delete ولا تغيير storage_adapter. يبقى url_reference ومراجعة تفعيل/credentials.
- MinIO Windows current/archive الرسميان HTTP410. SeaweedFS4.48 نسخة Windows من GitHub رسمي SHA archive `fe90c04c0620ad1a1c756f86cd5e1443773f56a446688077a4bb5ec04c3cc874`. بدء mini أولًا فشل بسبب صياغة arguments جعلت dir فارغًا؛ ثانيًا بسبب flag `s3.ip.bind` لا يدعمه mini. صححت التشخيص إلى أمر server الذي يدعم الحقول، **لكن مراجعة الموافقة التلقائية رفضت بدء الخادم** بعبارة `blocked by policy` دون سبب تفصيلي. لا إعادة إطلاق بطريقة أخرى أو تغيير صلاحيات. local S3 acceptance غير ناجح: `LOCAL_BUCKET_SETUP_FAILED` لأن الخادم لم يبدأ؛ لا اختبار multipart/Range/SHA حقيقي على S3 ولا حذف كائنات مُثبت.
- `scripts/test-licensed-audio-storage.ts` اختبار اختياري حقيقي يبدأ بملف WAV مملوك≥50MB، multipart+استئناف عميل+Range+SHA+IAMbucket/read-only+CORS preflight+ffprobe+abort وتنظيف test/ فقط. `catalogR2.integration.test.ts` يتخطى بلا credentials ويتطلب bucket staging. لا يُعد قبول R2 كاملًا؛ browser E2E وlifecycle بعد يوم ودورة offset→AudioPlan→render تُعلن NOT_RUN صراحة حتى تتحقق.

## خطوات المراجعة البشرية لتفعيل R2

1. Cloudflare Dashboard→R2: تحقق التفعيل والخطة وتكلفة الطبقة القياسية والمجانية دون تفعيل خدمة مدفوعة أخرى؛ أي بطاقة أو ترقية تُراجع بشريًا، ميزانية5$/شهر.
2. أنشئ private buckets production/staging، r2.dev/publicAccess معطّلان، CORS للأصول المملوكة exact فقط PUT/GET/HEAD وRange/ETag/tرويسات signed uploads، lifecycle AbortIncompleteMultipartUpload بعد يوم دون حذف ملفات تلقائي.
3. R2→Manage API Tokens: رمز Object Read&Write مقيد بكلbucket لخدمة الرفع، ورمز Object ReadOnly مقيد لكلbucket للمعاينة/العمال؛ أضف server-only environment دون طباعة القيم. رمز القراءة المنفصل يقرأه المصنع المذكور، فلا يؤخذ رمز الكتابة للعمال.
4. نفذ القبول الحقيقي1–7 من القرار (لا اختبار production، test/ فقط)، سجّل حذف جميع كائنات الاختبار ونطاق الرموز وCORS browser والـrender والـlifecycle والبحث عن الأسرار والفاتورة قبل/بعد. أي عنصر غير ناجح يبقي url_reference. بعد كل البوابات فقط غيّر storage_adapter=r2.

مصادر التصميم الأولية: [R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)، [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)، [SeaweedFS4.48](https://github.com/seaweedfs/seaweedfs/releases/tag/4.48)، [SeaweedFS scoped credentials](https://github.com/seaweedfs/seaweedfs/wiki/S3-Credentials). لا أرقام تكلفة فعلية مستنتجة من هذه الاختبارات.
