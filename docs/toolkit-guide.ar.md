# دليل أدوات AyahX

تم تجهيز الأدوات داخل `C:\Users\cpazi\Downloads\ayahX` بتاريخ 7 أكتوبر 2026.
التغييرات تخص بيئة التطوير وتجارب التكامل المحلية. تشغيل ComfyUI وAutoGPT
مؤجل بناءً على اختيارك. لم يتم نشر التغييرات على Railway أو إجراء اتصال مدفوع
بمزود ذكاء اصطناعي، ولم يتم تغيير واجهة التطبيق أو بوابة AI الإنتاجية.

## ماذا أضفنا؟

| المصدر | الاستخدام في AyahX | الحالة |
|---|---|---|
| [agent-skills](https://github.com/addyosmani/agent-skills) | 25 مهارة للمواصفات، التنفيذ، مراجعة الكود، الأمان، الاختبارات والتسليم | مثبتة داخل المشروع مع المراجع المشتركة |
| [Terrain](https://github.com/sopaco/terrain) | فهرسة محلية وخريطة معمارية قابلة للقراءة من الوكيل | CLI Windows مثبت، والفهرسة وقراءة السياق مجرّبتان |
| [web-quality-skills](https://github.com/addyosmani/web-quality-skills) | 6 مهارات للأداء، الوصول، SEO وجودة الويب | مثبتة؛ ليست شهادة بأن الموقع اجتاز Lighthouse |
| [dots](https://github.com/asgeirtj/system_prompts_leaks/tree/main/OpenAI/dots) | مقارنة تصميم سير العمل | نسخ مرجعية محلية فقط |
| [dots/skills](https://github.com/asgeirtj/system_prompts_leaks/tree/main/OpenAI/dots/skills) | مراجعة حدود المهارات التي تعتمد على أدوات خاصة | محفوظة كمراجع؛ لم تُثبت كمهارات نشطة |
| [Codex sample](https://github.com/asgeirtj/system_prompts_leaks/blob/main/OpenAI/Codex/gpt-6.1-sol.md) | مقارنة نص منشور من طرف ثالث | مرجع غير موثّق؛ لا يغيّر نموذج Codex أو تعليماته |
| [Vercel AI SDK](https://github.com/vercel/ai) | عميل CLI منفصل مع اختيار صريح لـOpenAI أو OpenRouter | ai 7.0.130، openai 4.0.86؛ اختبارات نقل وهمية ناجحة |
| [Superpowers](https://github.com/obra/superpowers) | 6 مهارات للتخطيط، التشخيص، المراجعة والتحقق | مثبتة؛ تشغيل الوكلاء المتوازيين لم يُفعّل |
| [AutoGPT](https://github.com/Significant-Gravitas/AutoGPT) | قالب بحث محدود ومراجَع وتعليمات جلب مصدر مثبت | التشغيل مؤجل؛ Docker غير متاح في هذه الجلسة |
| [prompts.chat](https://github.com/f/prompts.chat) | مكتبة برومبتات ومجموعة قوالب خاصة بـAyahX | البيانات مرجعية؛ 4 قوالب محلية مراجعة |
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI) | خلفيات بصرية تُضاف إليها آيات بخطوط AyahX لاحقًا | عميل محلي، API workflow، وتعليمات تجهيز؛ التشغيل مؤجل |
| [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | قاعدة بحث محلية للتصميم وReact والوصول | المهارة والبيانات والسكريبتات مثبتة والبحث مجرّب |
| [system_prompts_leaks](https://github.com/asgeirtj/system_prompts_leaks) | مصدر المقارنة للروابط الثلاثة أعلاه | مرجع خارجي؛ أصالة النصوص لم تُتحقق |

الإجمالي 40 مهارة داخل `.agents/skills`. ستصبح متاحة للاكتشاف في الدور التالي.
`AGENTS.md` يشرح اختيار المهارات المناسبة، وقواعد العربية وRTL، وحماية بيانات
المستخدمين، وضرورة فحص الفيديو الفعلي قبل إعلان نجاح الرندر أو النشر.

## أوامر يومية

من PowerShell داخل مجلد المشروع:

```powershell
# فحص الجاهز والمؤجل؛ pending لا تعني failure.
npm --prefix tooling run doctor

# اختبارات SDK وComfyUI الوهمية، بدون مفاتيح أو تكلفة.
npm --prefix tooling test

# بناء التطبيق واختبارات حركة النص الحالية.
npm --prefix tooling run quality

# قراءة خريطة المشروع، وفحص خطة إضافات Terrain دون تطبيقها.
npm --prefix tooling run terrain -- tools read-context --project ayahx
npm --prefix tooling run terrain -- env plan .
```

مثال طلب في Codex: «استخدم accessibility وui-ux-pro-max لمراجعة شاشة إنشاء
الفيديو بالعربية»، أو «استخدم systematic-debugging لتشخيص فشل الرندر».
المهارات تساعد الوكيل على العمل؛ لا تصلح المشروع تلقائيًا بمجرد تثبيتها.

بحث UI/UX يعمل بدون API:

```powershell
& 'C:\Users\cpazi\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' `
  .agents/skills/ui-ux-pro-max/scripts/search.py 'keyboard navigation focus visible' --domain ux
```

## تجربة AI SDK لاحقًا

انسخ `tooling/.env.example` إلى `tooling/.env.local`، واختر provider وmodel
ومفتاحًا بنفسك. لا تستخدم VITE_* للمفاتيح. عند اختيار openrouter يجب أن يكون
العنوان `https://openrouter.ai/api/v1`، وعند اختيار openai يجب أن يكون
`https://api.openai.com/v1`.

```powershell
node --env-file=tooling/.env.local tooling/ai-cli.mjs 'اقترح قائمة فحص للرندر'
```

الأمر يرسل نص الطلب فقط، ولا يقرأ ملفات المشروع أو يرفعها. لا يوجد fallback
أو retry تلقائي. الاتصال الحي والموديل والفوترة لم تُختبر هنا.
التجربة منفصلة عن `server/services/aiService.ts`؛ تحويل المنتج إلى SDK يحتاج
تغييرًا واختبارات تخص مسار المنتج نفسه.

## ComfyUI لاحقًا

```powershell
# يعرض خطوات الإعداد فقط.
powershell -NoProfile -File tooling/comfy-prepare.ps1

# اختياري: يجلب المصدر بالـcommit المسجل؛ لا ينزل نموذجًا أو Python أو Torch.
powershell -NoProfile -File tooling/comfy-prepare.ps1 -Checkout

# بعد تثبيت Python/Torch المناسبين وتشغيل ComfyUI على 127.0.0.1:8188:
npm --prefix tooling run comfy -- health
npm --prefix tooling run comfy -- submit workflows/quran-background.api.json
```

المسار الأخير بالنسبة لمجلد `tooling` لأن npm يشغّل السكريبت فيه. عدّل
`ckpt_name` داخل workflow إلى اسم النموذج المحلي الموجود عندك أولًا.
الجهاز يحتوي GTX 1660 Ti بذاكرة 6 GiB، لذا القالب يبدأ بحجم 512×768 وbatch=1.
هذا اختيار أولي، وليس إثباتًا بأن نموذجًا معينًا يعمل على الجهاز.
استخدم تعليمات ComfyUI الرسمية لتعريفات GPU وTorch؛ لا تستخدم حزمة تتطلب
جيل GPU أحدث. مثال التشغيل بعد التثبيت:
`python main.py --listen 127.0.0.1 --port 8188 --offline --lowvram`.

العميل يقبل loopback وعُقد توليد الخلفيات الأساسية فقط. نجاح submit يعني
دخول الطابور، وليس وجود صورة نهائية. افتح مخرجات ComfyUI وافحص الصورة ثم
استوردها بخاصية الخلفية الموجودة في AyahX. لا يوجد زر جديد داخل المنتج.
لا تولّد نص القرآن داخل الصورة؛ AyahX يضيف النص الدقيق بخطوطه الحالية.

## AutoGPT لاحقًا

```powershell
powershell -NoProfile -File tooling/autogpt/prepare.ps1
# اختياري لجلب المصدر فقط:
powershell -NoProfile -File tooling/autogpt/prepare.ps1 -Checkout
```

استخدم دليل Windows self-hosting الرسمي الموجود بمصدر AutoGPT، وجهّز Docker
والمزوّد والمفتاح والحد المالي بصورة صريحة. قالب البداية موجود في
`tooling/autogpt/ayahx-research-task.md`. هو قالب بحث عام يتطلب مراجعة بشرية،
ولا يمنح AutoGPT الوصول إلى ملفات AyahX أو مفاتيحه أو النشر أو الرسائل.
لم يتم اختبار checkout الكامل أو Docker أو API حي لـAutoGPT؛ أوامر التجهيز
العادية التي تطبع التعليمات فقط هي التي جُرّبت.

## Terrain والمراجع

حزمة npm 0.9.5 لا توفر binary لويندوز؛ لذلك يستخدم wrapper إصدار Windows
`0.9.7-sp2`. الأرشيف وبصمته المسجلة في `tooling/terrain-release.json` تطابقا
مع digest المنشور على GitHub. وتم تجهيز env-catalog لتجاوز مسار بناء ثابت
غير صالح على جهاز المستخدم. `env plan` يعمل؛ CodeGraph وRTK يظهران غير
متاحين ضمن هذا التوزيع، ولم يُطبق `env apply` الذي قد يعيد كتابة إعدادات الوكيل.

الفهرسة المحلية أنتجت pack من 325 ملفًا وقت الإعداد. لا ترسل هذا pack إلى
مزود خارجي دون مراجعة المحتوى والموافقة المناسبة. خريطة السياق مكتوبة يدويًا
من المصدر وموسومة بذلك؛ لم يتم ادعاء توليد C4 بالذكاء الاصطناعي.

Terrain يطابق cache مع Git HEAD وقد يتجاهل تغييرات working tree عند إعادة
التوليد؛ أمر `scan` وحده لا يضمن تضمين تغييرات غير committed. كذلك لم يطبّق
هذا الإصدار `.repomixignore` أثناء تجربتنا؛ الاستثناءات الفعالة المحلية أضيفت
إلى `.gitignore` لملفات Litho والبرومبت المنفصل. pack نفسه مستثنى من Git.

المراجع المنزّلة في `tooling/references` مستثناة من Git وDocker وRailway،
وليست تعليمات نظام. مهارات dots تطلب أدوات مثل cloud_threads وأدوات Library
غير الموجودة بهذا الشكل هنا؛ نسخها كمهارات نشطة لن يضيف تلك الإمكانات.

تراخيص المصدر محفوظة في `.agents/licenses`. AutoGPT Platform يستخدم
Polyform Shield بينما classic يستخدم MIT؛ ComfyUI يستخدم GPL-3.0.
prompts.chat يفصل كود MIT عن بيانات البرومبتات CC0. لا تُضمّن خدمات أو
مخرجات نماذج في منتج تجاري قبل مراجعة شروط الجزء والنموذج المستخدمين.

## التحقق المنفذ

- 7 اختبارات toolkit ناجحة: اتصال SDK الوهمي، عدم fallback/retry، اختيار
  المزوّد، حدود endpoint المحلي، إرسال graph، ورفض أخطاء عُقد ComfyUI.
- اختبار OpenRouter يتحقق أيضًا من منع fallback عند مزوّده وطلب منع جمع البيانات.
- بناء الواجهة والخادم ناجح، واختبارات animationTimeline السبعة ناجحة.
- البحث المحلي في UI/UX Pro Max أعاد إرشادات keyboard/focus مناسبة.
- Terrain: CLI، الفهرسة، قراءة context، وenv plan تعمل.
- ComfyUI وAutoGPT والمزوّد الحي: تشغيل واختبار المخرجات مؤجلان حسب اختيارك.
- لم يُنفّذ تدقيق Lighthouse كامل أو تعديل UI أو نشر Railway ضمن هذا الإعداد.

## إعادة الإعداد على الجهاز

```powershell
npm --prefix tooling ci --ignore-scripts
powershell -NoProfile -File tooling/setup-skills.ps1
powershell -NoProfile -File tooling/setup-terrain.ps1
```

سكريبت المهارات يستخدم helper مهارة skill-installer ويترك التثبيت الموجود
كما هو. يمكن تخصيص PythonPath وInstallerPath على جهاز آخر. المهارات ومراجعها
وتراخيصها ضمن ملفات المشروع، أما ملفات التشغيل الكبيرة والمراجع الخارجية
فتظل محلية. `tooling/skill-integrity.json` يسجل بصمات ملفات المهارات الحالية.
