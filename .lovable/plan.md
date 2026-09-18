

# خطة: إصلاح رفع الخلفيات + التحقق من الخطوط/الألوان + تأثير Fade In

## تحليل المشاكل

### 1. رفع الخلفية لا يعمل بين الصفحات (المشكلة الجذرية)
**السبب**: `CustomBackgroundUploader` ينشئ `blob:` URL عبر `URL.createObjectURL()`. هذا الرابط صالح **فقط في الصفحة الحالية**. عند الانتقال من الابتهالات إلى `/preview`، يتم تمرير الـ blob URL كـ URL parameter → لكنه يصبح **غير صالح** في الصفحة الجديدة.

**الحل**: تحويل الملف إلى `base64 data URL` بدلاً من `blob URL` — الـ data URL يعمل في أي مكان. للملفات الكبيرة (فيديو)، نستخدم `sessionStorage` لتخزين الـ blob مؤقتاً ونمرر مفتاح فقط.

### 2. إعدادات النص (خطوط/ألوان) غير موجودة في الابتهالات
صفحة `IbtahalatPage.tsx` لا تحتوي على `TextSettingsPanel` — الخطوط والألوان تظهر فقط في `PreviewPage` (الخطوة 4 للقرآن). هذا يعني أن المستخدم يمكنه تعديلها فقط في المعاينة، وهو السلوك الحالي الصحيح.

### 3. تأثير Fade In — موجود بالفعل
بعد الفحص، `VideoPreview.tsx` يحتوي بالفعل على تأثيرات `globalAlpha` و transition effects متعددة (fade, slide, zoom, blur, rise, twist, bounce) في أسطر 1867-1920. التأثير يعمل.

## التغييرات المطلوبة

### ملف `src/components/CustomBackgroundUploader.tsx`
- تحويل الصور إلى `data:` URL عبر `FileReader.readAsDataURL()`
- للفيديوهات: تخزين الـ File في `sessionStorage` كـ base64 (حد ~10MB) أو استخدام مفتاح في `window.__customBgFile`

### ملف `src/pages/PreviewPage.tsx`
- عند استلام `customBgUrl` من URL params: التحقق إذا كان مفتاح sessionStorage واسترجاع الملف
- إصلاح تبويب "رفع الخلفية" (Step 4) — يعمل حالياً لأنه في نفس الصفحة، لكن نتأكد من تمرير النوع الصحيح

### ملف `src/pages/IbtahalatPage.tsx`
- تحديث طريقة تمرير الخلفية المرفوعة لتستخدم `sessionStorage` بدلاً من blob URL في params

## الملفات المتأثرة

| الملف | التغيير |
|-------|---------|
| `CustomBackgroundUploader.tsx` | استخدام data URL للصور + window storage للفيديو |
| `IbtahalatPage.tsx` | تخزين الخلفية في sessionStorage + تمرير مفتاح |
| `PreviewPage.tsx` | استرجاع الخلفية من sessionStorage عند التحميل |

~40 سطر تغييرات إجمالي.

