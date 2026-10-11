# بروفة resolver وLaunchReadiness المحلية

هذا السكربت مخصّص لينفّذه الجذر على MySQL **9.7.2** المحلي في `127.0.0.1:33319`. لا يتصل بـRailway أو Cloudflare، ولا يطلب صوتًا من الشبكة. السكربت مكتوب ولم تُنفّذ بروفة قاعدة البيانات بواسطة الوكيل الذي جهّزه.

```powershell
npx tsx scripts/test-d4-licensed-catalog-local.ts --template ayahx_d4_k9_rehearsal_20261010 --database ayahx_d4_licensed_acceptance_20261011 --licensed-rehearsal docs/data/d4-licensed-publication-final-scratch.json --report docs/data/d4-licensed-catalog-local-acceptance.json
```

يُرفض target موجود، أو اسم خارج `ayahx_d4_licensed_acceptance_*`، أو نموذج خارج أسماء البروفات المحلية. يُنسخ DDL الحقيقي من النموذج إلى قاعدة جديدة، وتُنسخ جداول النص القانوني الثلاثة الموجودة كما هي مع مقارنة CHECKSUM. لا يفترض السكربت وجود riwayat أوquran_text_versions؛ المصدر الفعلي الحالي لا يحتويهما. لا تُنسخ حسابات users أو user_roles. قاعدة النموذج للقراءة فقط، وتُقارن أعداد وبصمات بياناتها المحمية قبل البروفة وبعدها. لا يُحذف أي ملف أو قاعدة؛ تُقفل الاتصالات والقفل الاستشاري عند النهاية وتُحتفظ بقاعدة scratch للأدلة. إعادة التشغيل تحتاج اسم scratch جديدًا.

تعمل CatalogMysqlDatabase وCatalogLicensedSourceResolver وRecitationAudioResolver وRecitationCatalogService وLaunchReadinessService الفعلية على SELECT وJOIN وtransactions وCHECK في MySQL. يُربط CHECK ببروفة المصدر المقبولة وexpected_clauses، وتُسجّل بصمات ملفات الخدمة المستخدمة في التقرير. يتطلب قبول LaunchReadiness إصدار الجذر الحالي الذي يستهلك licensed gate؛ الإصدار القديم الذي يعتمد صحة رابط المزود فقط يفشل اختبار سحب الحقوق.

حدود النقل معلنة: URL-hosted وR2 HEAD وGET capability بدائل نقل معزولة داخل العملية. بيانات SHA والمدة والصوت والموافقة البشرية للملف **fixtures اصطناعية محلية**؛ ليست إثبات محاذاة صوتية أو حقوق قانونية، ولا تحقق R2 فعليًا. التوقيتات الأصلية المنسوخة بعينها تأتي من فصل Release جاهز كامل في النموذج، ولا يُغيّر النص القانوني.

التجارب المطلوبة:

- ملف واحد مع حقوق fixture بشرية يمنح الفصل المقابل فقط. يبالغ cache الفصول عمدًا ويصف بقية السور بالمكتملة والصحيحة لتثبت البوابة أن ذلك لا يمنحها مصدرًا مرخّصًا.
- CHECK يقبل النشر المرخّص مع offset_verified=false وverification_status=failed، ويرفض محو proof؛ تبقى هوية الصوت وحالة الجمهور ثابتتين.
- يُستبدل قيد slice القديم ببديل scoped في ALTER واحد، بما في ذلك الاسم التلقائي إذا طابق CHECK_CLAUSE القديم الذي قاستْه بروفة MySQL. لا تُحذف قيود أخرى من تشابه أسمائها، ولا يُمنح offset عام. تُدرج fixture أولًا بوضع unverified_source ثم تُحوّل إلى surah_slice مع البرهان في التحديث نفسه.
- flag OFF يرفض API قبل استدعاء نقل الصوت، مع بقاء public potential منفصلًا عن العرض الفعلي.
- كلا الفرعين يعيدان نافذة التوقيت باستخدام offset الملف المقاس عبر toRenderTimeline، رغم اختلاف chapter_offset_ms المخزّن عمدًا؛ GET المؤقت لا يزيد عن900 ثانية.
- سحب human rights يُستبعد فورًا من LaunchReadiness ومن قائمة الفصول، دون الاعتماد على cache المنشور.
- اختلاف recitation في storage object، واختلاف SHA في المصدر، والملف الأقصر من نافذة التوقيت تُرفض.
- لوج audit يحتوي source ID/SHA والمدى والadapter فقط، ولا يحفظ URL أو capability. لا تحدث محاولة طلب YouTube أو مزود بديل.

نجاح التقرير يثبت التكامل المحلي مع SQL الحقيقي وحدود النقل المعزولة. دليل التخزين والسحابة الفعلي مستقل ويجب ألا يُستنتج من هذا التقرير.
