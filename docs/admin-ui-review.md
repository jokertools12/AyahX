# مراجعة واجهة الأدمن A1/A2a

الحالة في 2026-10-11: مصدر الواجهة موصول بالعقود الفعلية، والقبول الوظيفي المحلي النهائي ناجح 20/20. الأدلة المذكورة أدناه قرأها وكيل التوثيق من ملفات `docs/data` في checkout الرئيسي، أو نُقلت إليه من التشغيل الفعلي للوكيل الرئيسي. لم يشغّل وكيل التوثيق متصفحًا أو HTTP أو قاعدة بيانات. طُبقت migration006 على production بنجاح، CI وPR16 والنشر SUCCESS والتحقق اللاحق ونافذة665.74 ثانية نظيفة مثبتة في [دليل النشر](data/a1-a2a-publication.json).

## الهوية والفروق المقصودة

مرجع الهوية هو [لغة التصميم](design-language.md)، و`src/index.css` و`tailwind.config.ts` وshadcn القائمة. الأدمن يعيد استخدام Cairo والخطوط القرآنية الستة المعتمدة والألوان الدلالية والحواف وحلقة التركيز. التغيير المقصود هو كثافة البيانات: قائمة جانبية 264/72px، شريط علوي 56px، فلاتر وجداول وبطاقات جوال وdrawers تحفظ سياق القائمة. لا يُستخدم hero أو blur زخرفي في أدوات الإدارة.

الشارة تجمع أيقونة ونصًا ولونًا. الحالة `published` موسومة «مؤهل تقنيًا» لتجنب الخلط مع النشر العام. النص القرآني للقراءة فقط وبارتفاع سطر ≥1.9؛ المعرفات والروابط والتوقيتات LTR. الجدول يعرض بطاقات تحت 768px ومساحات لمس ≥44px. حاويات الجدول والرسم والتبويبات تستطيع التمرير داخليًا، بينما جسم الصفحة لا يتجاوز العرض في فحص الصفحات الذي نفذه الوكيل الرئيسي.

حُجزت مساحة تحميل الجدول 640px مع بقاء شريط الأدوات مركّبًا بعد قياس CLS مرتفع في صفحة القراء. أُصلح حد العرض الأدنى لشبكة تفاصيل القارئ ولفّ ترويسته، بدل إخفاء تجاوز العرض على جسم الصفحة. تفعيل تبويبات القارئ يدوي حتى لا يكرر التركيز وحده مطالبة التخلي عن نموذج غير محفوظ.

## مراجعة كل صفحة

أكد التشغيل `01a12acc-d26e-7183-a414-318fbd9cd5f5` اكتمال اللقطات وaxe للصفحات الأربع عشرة بعد انتظار الخطوط والصفوف الفعلية: عربي، سطح مكتب/هاتف × فاتح/داكن، أي 56 حالة صفحة، بصفر مخالفات حرجة أو خطيرة. الروابط أدناه تشير إلى صور حقيقية صُغّرت من الأدلة الأصلية؛ [فهرس الصور](data/admin-pages/index.json) يسجل المصدر وSHA-256 والتحجيم أو الاقتصاص. توجد أربع لقطات إضافية للدخول بحقوله الفارغة؛ لم تُلتقط كلمات مرور أو أسرار. هذه الأدلة لا تشمل تلقائيًا كل حالة drawer أو خطأ أو تدفق تعديل.

| المسار | مطابقة التصميم والفارق المقصود | دليل الجودة المحلي المتاح | حدود المراجعة |
|---|---|---|---|
| `/admin` | بطاقات إحصاء وصحة وتدقيق كثيفة، دون زخرفة صفحة الموقع | أربع حالات axe/لقطات؛ Lighthouse أدناه | صحة العمال تسجل محدودية القياس؛ ليست heartbeat |
| `/admin/roles` | مصفوفة أذونات وملخص أثر وتأكيد مكتوب | أربع حالات axe/لقطات؛ قبول A1 المحلي | `super_admin` محمي وللقراءة فقط |
| `/admin/users` | جدول أو بطاقات وdrawer للأدوار | أربع حالات axe/لقطات؛ قبول تعيين الأدوار المحلي | ليست إدارة حسابات أو اشتراكات كاملة |
| `/admin/audit` | فلاتر وdrawer لـ JSON قبل/بعد | أربع حالات axe/لقطات؛ سجل حقيقي لكل كتابة في HTTP؛ E2E diff ناجح محليًا | ليست مراجعة production |
| `/admin/settings` | بطاقات وصف/مستهلك/قيمة؛ سر مقنّع ومحرر فارغ | أربع حالات axe/لقطات؛ Lighthouse؛ وحدات محرر السر | نصوص البيانات والشروط والسجلات تُعرض بلغتها المخزنة |
| `/admin/security` | بطاقات TOTP وجلسات حقيقية بلا أدوات وهمية | أربع حالات axe/لقطات؛ قبول A1/TOTP محلي | لا تُصور أسرار TOTP أو رموز الاسترداد |
| `/admin/_kit` | حالات المكونات الأساسية ومنطقة virtualized 1000 صف | أربع حالات axe/لقطات؛ قياس التفاعل أدناه | محلي فقط؛ ليس محتوى إنتاجيًا |
| `/admin/reciters` | فلاتر وجدول/بطاقات ومعاينة سريعة | أربع حالات axe/لقطات؛ Lighthouse | اختيار aggregate غير قابل للفرز لا يرسل sort غير مدعوم |
| `/admin/reciters/:id` | ترويسة وتبويبات ولوحة أسباب الظهور | أربع حالات axe/لقطات؛ فحص عرض الجسم؛ وحدات الحراسة؛ Back رفض/قبول ناجح على الجهازين | المسودة بقيت عند رفض المغادرة؛ القبول يغادر النموذج |
| `/admin/recitations` | تعديل أسماء داخل الصف، ترتيب وUndo، تفاصيل ومهمات | أربع حالات axe/لقطات؛ HTTP حقيقي؛ E2E محلي للحفظ والافتراضية والترتيب وUndo | السحب اختُبر على سطح المكتب؛ أزرار الترتيب على الجهازين |
| `/admin/availability` | شبكة 114 خلية ومفتاح حالات وتفاصيل بالسهم/Enter | أربع حالات axe/لقطات؛ عقد HTTP الفصول؛ E2E الكيبورد والتوقيت ناجح | ليس اختبار إتاحة صوت إنتاجي |
| `/admin/providers` | شروط ومضيفون وأدلة مع قرار ترخيص مستقل | أربع حالات axe/لقطات؛ HTTP/RBAC للترخيص | لا اعتماد صوت أو قائمة مراجعة A2b |
| `/admin/quran` | سور/آيات، تكامل وبصمة، روايات وستة خطوط | أربع حالات axe/لقطات؛ HTTP والقراءة القانونية | النص غير قابل للتحرير؛ اختيار خطوط الموقع العام لم يتغير |
| `/admin/timings` | قائمة آيات مقابل SVG/جدول الكلمات/JSON والمدققات | أربع حالات axe/لقطات؛ EXPLAIN أدناه | قراءة إحداثيات المصدر فقط؛ لا تنفيذ محاذاة أو تحويل ريندر |

## فهرس اللقطات الفعلية

| الصفحة | سطح مكتب فاتح | سطح مكتب داكن | هاتف فاتح | هاتف داكن |
|---|---|---|---|---|
| /admin | [عرض](data/admin-pages/desktop-admin-light.png) | [عرض](data/admin-pages/desktop-admin-dark.png) | [عرض](data/admin-pages/mobile-admin-light.png) | [عرض](data/admin-pages/mobile-admin-dark.png) |
| /admin/roles | [عرض](data/admin-pages/desktop-admin-roles-light.png) | [عرض](data/admin-pages/desktop-admin-roles-dark.png) | [عرض](data/admin-pages/mobile-admin-roles-light.png) | [عرض](data/admin-pages/mobile-admin-roles-dark.png) |
| /admin/users | [عرض](data/admin-pages/desktop-admin-users-light.png) | [عرض](data/admin-pages/desktop-admin-users-dark.png) | [عرض](data/admin-pages/mobile-admin-users-light.png) | [عرض](data/admin-pages/mobile-admin-users-dark.png) |
| /admin/audit | [عرض](data/admin-pages/desktop-admin-audit-light.png) | [عرض](data/admin-pages/desktop-admin-audit-dark.png) | [عرض](data/admin-pages/mobile-admin-audit-light.png) | [عرض](data/admin-pages/mobile-admin-audit-dark.png) |
| /admin/settings | [عرض](data/admin-pages/desktop-admin-settings-light.png) | [عرض](data/admin-pages/desktop-admin-settings-dark.png) | [عرض](data/admin-pages/mobile-admin-settings-light.png) | [عرض](data/admin-pages/mobile-admin-settings-dark.png) |
| /admin/security | [عرض](data/admin-pages/desktop-admin-security-light.png) | [عرض](data/admin-pages/desktop-admin-security-dark.png) | [عرض](data/admin-pages/mobile-admin-security-light.png) | [عرض](data/admin-pages/mobile-admin-security-dark.png) |
| /admin/_kit | [عرض](data/admin-ui-kit/desktop-admin-_kit-light.png) | [عرض](data/admin-ui-kit/desktop-admin-_kit-dark.png) | [عرض](data/admin-ui-kit/mobile-admin-_kit-light.png) | [عرض](data/admin-ui-kit/mobile-admin-_kit-dark.png) |
| /admin/reciters | [عرض](data/admin-pages/desktop-admin-reciters-light.png) | [عرض](data/admin-pages/desktop-admin-reciters-dark.png) | [عرض](data/admin-pages/mobile-admin-reciters-light.png) | [عرض](data/admin-pages/mobile-admin-reciters-dark.png) |
| /admin/reciters/:id | [عرض](data/admin-pages/desktop-admin-reciters-detail-light.png) | [عرض](data/admin-pages/desktop-admin-reciters-detail-dark.png) | [عرض](data/admin-pages/mobile-admin-reciters-detail-light.png) | [عرض](data/admin-pages/mobile-admin-reciters-detail-dark.png) |
| /admin/recitations | [عرض](data/admin-pages/desktop-admin-recitations-light.png) | [عرض](data/admin-pages/desktop-admin-recitations-dark.png) | [عرض](data/admin-pages/mobile-admin-recitations-light.png) | [عرض](data/admin-pages/mobile-admin-recitations-dark.png) |
| /admin/availability | [عرض](data/admin-pages/desktop-admin-availability-light.png) | [عرض](data/admin-pages/desktop-admin-availability-dark.png) | [عرض](data/admin-pages/mobile-admin-availability-light.png) | [عرض](data/admin-pages/mobile-admin-availability-dark.png) |
| /admin/providers | [عرض](data/admin-pages/desktop-admin-providers-light.png) | [عرض](data/admin-pages/desktop-admin-providers-dark.png) | [عرض](data/admin-pages/mobile-admin-providers-light.png) | [عرض](data/admin-pages/mobile-admin-providers-dark.png) |
| /admin/quran | [عرض](data/admin-pages/desktop-admin-quran-light.png) | [عرض](data/admin-pages/desktop-admin-quran-dark.png) | [عرض](data/admin-pages/mobile-admin-quran-light.png) | [عرض](data/admin-pages/mobile-admin-quran-dark.png) |
| /admin/timings | [عرض](data/admin-pages/desktop-admin-timings-light.png) | [عرض](data/admin-pages/desktop-admin-timings-dark.png) | [عرض](data/admin-pages/mobile-admin-timings-light.png) | [عرض](data/admin-pages/mobile-admin-timings-dark.png) |
| الدخول (حقول فارغة) | [عرض](data/admin-pages/desktop-admin-login-light.png) | [عرض](data/admin-pages/desktop-admin-login-dark.png) | [عرض](data/admin-pages/mobile-admin-login-light.png) | [عرض](data/admin-pages/mobile-admin-login-dark.png) |

[فهرس مقارنة التصميم: ستة أزواج حقيقية](data/admin-design-parity/README.md) يشرح ما أعيد استخدامه وما تغير لكثافة الإدارة. الصفحة العامة تستخدم بطاقات للسور، لذلك مقارنة الجدول توثّق انتقال البطاقات إلى جدول إداري ولا تدعي وجود جدول عام مماثل.

## القياسات الفعلية وحدودها

[Lighthouse](data/admin-lighthouse.json) شُغّل على build إنتاجي محلي بسطح مكتب، Lighthouse 13.5.0 وChrome 155، مع جلسة HttpOnly محلية وإعادة ضبط التخزين معطّلة. لا تُحفظ ملفات خام قد تتضمن المصادقة. لا تعني هذه القياسات أن جميع صفحات الأدمن خضعت لـ Lighthouse.

| الصفحة | Accessibility | Best practices | CLS | القبول |
|---|---:|---:|---:|---|
| الرئيسية | 100 | 100 | 0.01143 | يحقق 95/95 و≤0.1 |
| القراء | 100 | 100 | 0.02758 | يحقق 95/95 و≤0.1 بعد إصلاح التحميل |
| الإعدادات | 100 | 100 | 0.01143 | يحقق 95/95 و≤0.1 |

توجد توصيات أداء في Lighthouse، منها JavaScript/CSS غير مستخدمين وشجرة اعتماد الشبكة؛ الدرجة 100 في الفئتين لا تعني اختفاء كل توصية. ملف [قياس التفاعل](data/admin-interaction-performance.json) النهائي على 1000 صف سجّل 23 صفًا/10 بطاقات مركّبة وأقصى مدة تفاعل مختبرية 32ms لسطح المكتب و48ms للهاتف، مع CLS 0.01474 و0.01508. هذه أرقام **مختبرية، وليست INP ميدانيًا**. عناصر داخل حاوية تبويبات قابلة للتمرير قد تتجاوز إطار عرض تلك الحاوية؛ معيار عدم تجاوز جسم الصفحة فُحص منفصلًا في اختبارات الصفحات.

في [تقرير الحزمة بعد](data/admin-bundle-after.json)، مجموع gzip للتحمّل العام الأولي انخفض من 322,504 إلى 218,666 بايت، أي ‎−32.20% مقارنة [بخط الأساس](data/admin-bundle-before.json). أقصى مسار أدمن 196,035 بايت gzip، ضمن 250KB. القياس يجمع entry والمسار الكسول وتبعياته الثابتة وCSS، ويستبعد الصفحات البديلة غير المطلوبة؛ ليس حجم كل الأدمن مجتمعًا، وليس زمن نقل شبكة إنتاجية. نسبة التغيير العام تحقق ميزانية عدم الزيادة بأكثر من 2%.

اختبار [HTTP الفعلي A2a](data/a2a-http-acceptance.json) فحص 29 endpoint × سبعة أدوار، و43 كتابة مأذونة لكل منها سجل audit مجمّع واحد. أثبت تأثير الأسماء والافتراضية والترتيب والظهور والمصدر والرواية والحقوق والإعدادات على القراءة العامة محليًا. زمن استعلام مدى التوقيت 0.383–0.484ms مع الفهرس `idx_timing_ready_range` في خمس قراءات، أقل من 50ms. لا تقاس هنا شبكة Railway، ولم تنفذ هذه الأدلة HEAD للمصادر الخارجية.

قبول [A1 المحلي](data/a1-local-acceptance.json) يحتوي 19 نتيجة ناجحة تشمل RBAC والأصول المرفوضة والتحقق والأسرار وTOTP والاسترداد وحماية المدير الأعلى. لا تحل نتائج HTTP محل تفاعلات المتصفح. فحوص الوحدات الخاصة بالواجهة أثبتت ترجمة controls وحجب فحص الرابط حسب `sources.write` وتصفية audit الصحيحة وحماية tab من prompt مضاعف؛ mocks مقتصرة على الوحدات.

## تفاعلات المتصفح وما لم يُحسم بعد

أكد التشغيل الوظيفي النهائي `01a12adc-31ec-782f-bacd-674907de411e` نجاح 20/20 على سطح المكتب والهاتف. تشمل تدفقات الكتالوج حفظ الاسم وقراءته من API العام مع الافتراضية وdiff؛ ترتيب الكيبورد وUndo والسحب المكتبي؛ مصفوفة السور وتوقيت SVG/JSON؛ سياسة الصوت وتأثيرها في API العام؛ فلاتر URL والنتيجة الفارغة الحقيقية؛ ورفض/قبول المغادرة مع مسودة غير محفوظة. شُغلت ضد MySQL وRedis الفعليين المحليين دون network mocks.

كشف اختبار المسودة أن تسجيل listener عند أول تعديل كان متأخرًا في Chrome: الرفض من الرابط والتبويب احتفظ بها، لكن Back المرفوض أعاد تركيب الحقل. ثُبّت listener منذ تحميل AdminEntry قبل تركيب BrowserRouter، دون استبدال تاريخ المتصفح أو تخزين مسودة خارج React. إعادة الفحص المكتبية `01a12acd-85ec-7286-aadc-62b9140d0539` نجحت 2/2؛ أكد التشغيل أن نفس input node بقي وأن المسودة وزر الحفظ احتُفظ بهما، وأن قبول الرجوع يغادر النموذج. اختبار DOM يثبت deny/restoration/accept أيضًا، والتشغيل النهائي أعلاه أثبت التدفق على الجهازين.

- production: CI أخضر وPR16 مدموج، أربعة SUCCESS،health/ready200،نافذة665.74s بلا أخطاء،smokeعام10/10+أدمنمجهول/lazy4/4. [الأدلة](data/a1-a2a-publication.json). الإنفاق18.179866→18.208485$ للـworkspace كله؛لا ادعاء تكلفة معزولة.
- INP ميداني غير متاح لموقع لم يُطلق؛ قياس المختبر لا يعاد تسميته دليلًا ميدانيًا.

تبقى `quran_catalog_v2` مغلقة في production، ولا تعطي هذه المراجعة إذنًا لفتحها أو لإطلاق A2b/D5.

أكد الوكيل الرئيسي نجاح migration006 على production وثبات بصمات D1 وD3 والجداول الحرجة؛ رُقي حسابا أدمن وفق التفويض. قبول القاعدة مستقل، وتدعمه الآن أدلة CI والنشر والقراءة والسجلات المرتبطة أعلاه.
