# ما يلزم لإتاحة D5 لاحقًا

وثيقة تجهيز فقط، 2026-10-11؛ **لم يبدأ D5** ولم تُنزّل أوزان أو يُرسل صوت إلى مزود أو تُنشأ استضافة. مبنية على [D5_DESIGN](../plan/D5_DESIGN.md)، كود عامل AyahX، المصدر العام المثبت للـSpace، وقراءة حديثة لوثائق HF الرسمية. اعتماد المستخدم MAE≤30ms وp95≤75ms لا يزيل بوابات الوصول/الحقوق.

## الأسماء الدقيقة وما أثبته فحص الوصول

| الأصل | المصدر | القراءة العامة الجديدة | النتيجة وحدودها |
|---|---|---|---|
| Base | [hetchyy/tibyan-base-v1](https://huggingface.co/hetchyy/tibyan-base-v1) | API metadata و`resolve/main/config.json` | كلاهما401، بلا تسجيل دخول |
| Large | [hetchyy/tibyan-large-v1](https://huggingface.co/hetchyy/tibyan-large-v1) | API metadata و`resolve/main/config.json` | كلاهما401، بلا تسجيل دخول |
| واجهة المنظومة | [hetchyy/quranic-universal-aligner](https://huggingface.co/spaces/hetchyy/quranic-universal-aligner) | README/config.py/install_sdk.py/deploy.json عندrevision المثبت | المصدر العام200، لا inference |
| توقيت الكلمات الخارجي | [hetchyy/Quran-phoneme-mfa](https://huggingface.co/spaces/hetchyy/Quran-phoneme-mfa) بحسب README | لا POST أو اختبار تنزيل لهذه الخدمة هنا | README يذكرها؛ `config.py` يستخدم افتراضيًا `https://hetchyy-quran-phoneme-mfa-dev.hf.space` عبر `MFA_SPACE_URL` |

بدأ الفحص العام في **2026-10-11T17:16:20.844Z**، طلب واحد لكل API/config من Base/Large، دون توكن ودون retry. الجسم للمحاولات الأربع: `Invalid username or password.` لا يثبت ذلك وجود كلمة مرور خاطئة؛ لم تُرسل بيانات اعتماد أصلًا. **الحالة private/gated غير محسومة**: 401 يثبت أن الجلسة العامة لا تصل إلى الملف/metadata، ولا يميز مستودعًا خاصًا عن اسم غير متاح أو وصول يحتاج اعتمادًا. لا توجد model card متاحة لنا تثبت نوع القيد أو رخصة الأوزان. وصف Base95M/Large1B و`align-v1` يأتي من README صاحب المشروع، لا قياسنا. [README المثبت](https://huggingface.co/spaces/hetchyy/quranic-universal-aligner/blob/ad3222b8870ffe9faf6b48d1bac9d32a16a8b10d/README.md).

## خطوات تنفذها من حسابك عند تجهيز D5

1. سجّل دخول حساب Hugging Face الذي سيملك الوصول، ثم افتح رابطَي Base/Large أعلاه. إذا ظهرت صفحة طلب access فاقرأ الشروط وشارك البيانات المطلوبة فقط إذا وافقت؛ طلب gated يتم من المتصفح وقد ينتظر موافقة المؤلف. إذا ظهرت404/غير متاح حتى بعد الدخول، تواصل مع صاحب `hetchyy` لمنح حسابك قراءة النموذج أو تأكيد الاسم الحالي؛ شراءPRO وحده لا يمنح إذنًا للمستودع. هذه خطوات مشروطة بالحالة التي تظهر لك، لا ادعاء أن النموذج gated. [سياسة gated الرسمية](https://huggingface.co/docs/hub/models-gated).
2. احصل من صاحب المنظومة على حق تشغيل **SDK الخاص وأصول المطابقة/VAD** كذلك، وليس النموذج وحده. [install_sdk.py](https://huggingface.co/spaces/hetchyy/quranic-universal-aligner/blob/ad3222b8870ffe9faf6b48d1bac9d32a16a8b10d/src/core/install_sdk.py) يشترط `HF_TOKEN` لقراءة deploy bundle الخاص، ويثبت native DP extension. [deploy.json](https://huggingface.co/spaces/hetchyy/quranic-universal-aligner/blob/ad3222b8870ffe9faf6b48d1bac9d32a16a8b10d/deploy.json) يحدد bucket `hetchyy/qua-aligner-assets` وcommit **`bfc8a3336ce3139ee6fdb1fd354969c6ced7d4fa`** وحزم qua-domain/qua-contracts/qua-sdk/qua-alignment-batch/qua-timing-batch. لا تنسخ حزمة خاصة دون حقها؛ installer يحتاج صلاحية قراءة هذا المورد تحديدًا. public Space يعمل بأسرار صاحبه ولا يورث صلاحياته للمستخدم.
3. اتفق على رخصة الأوزان وSDK والصوت والاستخدام التجاري، وإتاحة MFA للنطاق المطلوب. `MFA` هنا تعني **Montreal Forced Aligner**، وليست المصادقة متعددة العوامل. غياب ملف/خدمة الكلمات لا يعالَج بتقسيم الوقت أو نقل نص حفص إلى رواية مختلفة. رخصة MIT في metadata ورأس CC BY4.0 في app.py لا يثبتان ترخيص SDK/الأوزان الخاصة؛ هذا قرار حقوق يبقى في قائمة المراجعة. [مصدر التطبيق](https://huggingface.co/spaces/hetchyy/quranic-universal-aligner/blob/ad3222b8870ffe9faf6b48d1bac9d32a16a8b10d/app.py).
4. بعد منح الوصول، أنشئ من إعدادات حسابك رمز **قراءة** أو fine-grained للموارد الممنوحة فقط؛ scope وحده لا يتجاوز منع حسابك الأصلي. وصول bundle الخاص قد يحتاج bucket read ضمن خيارات المورد أيضًا. تحفظه بنفسك في مخزن أسرار الخادم/بيئة محلية خاصة، باسم `HF_TOKEN` إذا اخترنا installer هذا؛ لا يُرسل في المحادثة ولا يُكتب فيGit/لوج أوVITE_*. تنزيل النموذج لا يحتاج write token. عمليات إنشاءSpace مستقبلية فقط تحتاج write أوscope مناسبًا منفصلًا. [الرموز والصلاحيات الرسمية](https://huggingface.co/docs/hub/security-tokens).
5. **نسخ Space ليس شرطًا لبروفة CPU محلية**؛ المسار الأقل كلفة بعد حقوق الوصول هو تشغيل بيئة محلية مستقلة وتجربة قصيرة. إن اخترت لاحقًا Duplicate this Space، فالأسرار لا تُنسخ، ويلزم إعادة ضبطها بالواجهة الخاصة، وMFA URL/SDK assets يجب أن يكونا متاحين لحسابك. لا تنشئ النسخة أو ترفع عتادها ضمن D7. [إدارة النسخ](https://huggingface.co/docs/huggingface_hub/guides/manage-spaces).
6. عند تفويض D5 لاحقًا، نثبت model revision وSHA/SDK/options وعقد ready الحقيقي؛ نحمل المحرك المختار في [عامل AyahX](../../services/alignment-worker/app.py) عبر `ALIGNMENT_ENGINE_MODULE` أو`ALIGNMENT_ENGINE_COMMAND` أو`ALIGNMENT_CTC_MODEL_ID` **اختيار صريح واحد**. تغيير URL فقط لا يحمل نموذجًا. نقيس cold/warm CPU وRSS وزمن VAD/ASR/DP/MFA على صوت مصرح، ثم QUD MAE/p95 والتغطية؛ لا تبديل مزوّد صامت عند401. [README عامل AyahX](../../services/alignment-worker/README.md).

## التكلفة قبل أي إنشاء

| الخيار المشروط | السعر المقروء في2026-10-11 | ما يزال مجهولًا |
|---|---|---|
| CPU على الجهاز الحالي | لا رسوم منصة إضافية | الكهرباء/الشبكة/الوقت لم تقَس |
| HF CPU Basic | العتاد0$/ساعة، 2vCPU/16GB RAM/50GB ephemeral | إنشاء/نسخ Gradio/Docker CPU Basic يحتاج خطة؛ استثناءZeroGPU لحسابات مؤهلة لا يفترض انطباقه |
| PRO شخصي | 9$/شهر | ليس حق وصول للنموذج/SDK؛ ليس تغييرًا منفّذًا أو مفوضًا هنا |
| HF CPU Upgrade | 0.03$/ساعة | مدة التشغيل/ملاءمة الذاكرة للمسار الكامل |
| HF T4-small أوA10G-small | 0.40$ أو1.00$/ساعة | لا توصيةGPU قبل benchmark؛ MFA قد تحتاج موارد/رسوم مستقلة |
| عامل Railway الموجود | التكلفة الهامشية غير معروفة | لا RTF/RSS كاملين مثبتين؛ لا مبلغ شهري مختلق |

الأسعار أمثلة من [Spaces Overview](https://huggingface.co/docs/hub/spaces-overview) و[صفحة الأسعار](https://huggingface.co/pricing)، وليست فاتورة حسابك أو عرض صاحب SDK. توجد صياغة أكثر تفصيلًا في manage-spaces عن شروط billing للعتاد المدفوع؛ العرض النهائي وشروط الحساب يُراجعان قبل أي إنشاء. التكلفة المتوقعة بعد القياس: سعر العتاد × ساعات التشغيل، مضافًا رسوم الخطة وMFA/التخزين إن وجبت. لا يُفترض تشغيل24/7، ولا اقتراح إنفاق خارج التفويض الحالي. وصول المصدر/الترخيص ونجاح benchmark هي أول بوابات D5؛ D7 يستخدم D3 المستوردة ولا يتوقف على إتاحة هذه النماذج.

## ماذا لم نفعل

صفر تنزيل أوزان، صفر محاذاة، صفر POST إلى HF/MFA، صفر استهلاك ZeroGPU أو إنشاء Space، صفر قراءة سرية أو تغيير Railway/DB. أداة web لم تفتح raw source لبعض مسارات Space؛ جلب HTTP GET العام المباشر لنفس revision أثبت200 للملفات المذكورة، لا وصول لحزمة خاصة. فحص config في المسارين `src/config.py`/`config.json` أعاد404؛ الصحيح المقروء هو `config.py` في جذر Space. لا يُستنتج فشل صاحب Space من هذه المسارات غير الصحيحة.
