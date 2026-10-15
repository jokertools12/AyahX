# مراجعة QUD على Hugging Face

هذه مراجعة قراءة فقط لمصدر الخطة الجديدة. لم يتم تنزيل dataset، ولم تُرسل أي
وسائط، ولم يُنشأ Hugging Face Job أو adapter مُفعّل.

## الدليل العام

- `hetchyy/quranic-universal-ayahs` يعلن صيغة Parquet، ووسوم forced-alignment
  وword/letter timestamps، وترخيص CC BY 4.0 لبيانات المستودع.
- بطاقة dataset تذكر أن التسجيلات تبقى ملكًا للمصادر/القراء الأصليين؛ ترخيص
  dataset لا يساوي ترخيص إعادة توزيع التسجيلات داخل AyahX أو تخزينها في R2.
- الحزمة كبيرة ومتعددة subsets؛ لذلك لا يجوز تنزيلها كاملة أو إدخالها في صورة
  runtime cache قبل اختيار subset/revision وحساب checksum ومراجعة التغطية والرواية.

## قرار الدمج

يبقى QUD مرشحًا اختياريًا لـdraft/provisional alignment ومصدرًا محتملًا لـword
وletter timing بعد مراجعة المصدر والصوت والحقوق. أي نتيجة تمر عبر
`validateResolutionCandidate`، وتُحفظ محاولتها في ledger، ولا تُستخدم في
`final_export` قبل approval مستقل. لا يوجد تغيير في Railway أو R2 أو متغيرات
البيئة نتيجة هذه المراجعة.

المصدر العام: <https://huggingface.co/datasets/hetchyy/quranic-universal-ayahs>
