# مولّد تقرير D4 النهائي — دون اتصال أو كتابة قاعدة

`scripts/generate_d4_completion_report.py` يقرأ artifacts العامة الموجودة في checkout المختار؛ يكتب ملف Markdown فقط، ويحافظ على صيغة التقرير العربية ذات الأجزاء الستة. لا يعيد T7، ولا يتصل بقاعدة/Cloud/API، ولا يحوّل مرشحًا عدديًا أو status إلى قبول rule-v1 أو هوية confirmed.

الأعداد تُحسب من availability-summary وvoice-auto-verification، ويُرفض اختلاف مجموعة slugs أو تكرارها. كل تلاوات الكتالوج تدخل الجدول، وT7 يضاف فقط للتلاوات المقيسة المثبّتة. صحة الرابط منفصلة عن التغطية الزمنية وعن valid_audio_complete النهائي. الـJSON النهائي المقدم من root هو مصدر حالة DB وrule-v1؛ لا يُستنتج ذلك من نتائج T7. يُرفض bool النصّي مثل `"yes"`، والجرد الجزئي، والجرد بلا `read_only=true` أو `checked_at`.

التشغيل من checkout الجذر بعد cherry-pick، ببايثون المحلي المعروف:

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
$env:PYTHONUTF8='1'
$python = 'C:/Users/cpazi/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
& $python scripts/generate_d4_completion_report.py `
  --repo-root . `
  --inventory docs/data/d4-final-production-inventory.json `
  --operations docs/data/d4-final-operations-proof.json `
  --proof docs/data/d4-final-production-inventory.json `
  --proof docs/data/d4-final-operations-proof.json `
  --out docs/data/d4-completion-report.ar.md
```

اسما finalinventory/operations أعلاه مقترحان؛ يعين root المسارات الفعلية. يمكن حذف `--inventory` و`--operations` لإنتاج مسودة واضحة الـpending؛ لا يسمح هذا بتسمية الدفعة مغلقة. `--proof` تكراري للملفات العامة الإضافية داخل repo، ويمنع المسارات الخارجة منه. الروابط العامة لبراهين CI/PR/deploy تقبل HTTPS على GitHub/Railway/Cloudflare دون credentials أو query؛ كل URL خاص/موقّع لا يدخل مدخل operations أصلًا.

عقد finalinventory (يُملأ من قراءة فعلية، وليس هذا المثال بيانات إنتاج):

```json
{
  "read_only": true,
  "checked_at": "UTC timestamp from actual read",
  "recitations": [
    {
      "slug": "actual catalog slug",
      "reciter_id": "actual reader identity key",
      "name_ar": "actual catalog name",
      "provider": "actual provider",
      "voice_identity_status": "unverified",
      "license_status": "unreviewed",
      "status": "actual technical status",
      "offset_verified": null,
      "offset_method": null,
      "valid_complete_chapters": null,
      "rule_v1_eligible": null,
      "rule_v1_reasons": [],
      "public_visible": null,
      "youtube_audio_state": null
    }
  ],
  "flag_enabled": null,
  "protected_verification_summary": "actual D1/D3/admin protection counts/checksums/result with referenced proof",
  "review_counts_by_type": {},
  "added_hosts": [
    {"host": "actual host", "reason": "verified ownership/redirect/TLS reason", "evidence_ref": "public proof path"}
  ]
}
```

`recitations` يحتوي كل مجموعة slugs التي يحسبها المصدر، لا صف المثال وحده. `null` أو غياب حقل = pending. `rule_v1_eligible` قرار root المثبت و`rule_v1_reasons` أسبابه؛ لا يحسب المولّد قبولًا جديدًا. `youtube_audio_state` وصف مثبت من القراءة النهائية: بحاجة ملف/قيد التحقق/جاهزة، ولا يستعمل جاهزة بلا دليل. عدد القراء المؤهلين يُحسب من reciter_id، ويظهر pending إن غاب أي ID مؤهل.

عقد operations؛ كل مدخل عام بلا أسرار أو response bodies:

```json
{
  "gates": {
    "npm_test": {"status": "actual status", "evidence_ref": "existing public artifact path", "tests": {"total": 0, "passed": 0, "failed": 0, "skipped": 0}},
    "ci": {"status": "actual terminal status", "evidence_ref": "verified CI public URL"},
    "deployment_success": {"status": "actual terminal status", "evidence_ref": "existing deployment proof"}
  },
  "billing": {
    "railway": {"before_dollars": null, "after_dollars": null, "evidence_ref": "public billing evidence"},
    "cloudflare_r2": {"before_dollars": null, "after_dollars": null, "evidence_ref": "public billing evidence"},
    "budget_summary": "actual hard limit/current remaining from read-only evidence"
  },
  "self_decisions": ["actual decision and reason"]
}
```

مفاتيح gates المدعومة: tsc،changed_lint،npm_test،build،ci،merge،deployment_success،health،ready،logs_10_minutes،read_only_smoke،catalog_disabled_404،r2_real_acceptance،r2_cleanup،r2_secret_scan،rollback. بوابة بلا status ودليل مرتبط = pending، ولا يكفي وجود artifact وحده لاستنتاج نجاحه. rollback يجوز توثيقه not_needed بدليل فحص عدم التراجع؛ لا يحوّل عدم وجوده إلى تنفيذ مزعوم. الفاتورة قبل/بعد أرقام فعلية، والفرق حساب عشري فقط بلا ادعاء تكلفة سببية أو توفير. حقول R2 الاختيارية `before_class_a_operations/after_class_a_operations/before_class_b_operations/after_class_b_operations` أعداد عمليات، وتُعرض صراحة دون نسبتها للدولار. `operations.changes` قائمة تفاصيل الملفات/الجداول/endpoints الفعلية.

تقرير المعاينة الحقيقي في TEMP بتاريخ 2026-10-11 جمع 69 تلاوة و9 YouTube حسب المصدر الفعلي، وبقي rule-v1 والجرد النهائي والفاتورة وبوابات الشحن pending. لا يعد ذلك قبولًا للإنتاج. اختبار المولّد: `python -m unittest test_generate_d4_completion_report` من scripts؛ يفحص pending، الجرد الجزئي/bool غير الصحيح، عدم تسريب الحقول غير المختارة، والمراجع التي تتجاوز repo.

## التقاط الجرد النهائي؛ root وحده يشغّل

`scripts/capture-d4-final-evidence.ts` يفتح جلسة SSH/MySQL واحدة بـ `allowWrites:false`. استعماله بعد K8 وبعد تحضير publication plan **جديد للقراءة فقط، changes=0**؛ لا يستهلك خطة pre-apply ذات تغييرات معلقة:

```powershell
npx tsx scripts/capture-d4-final-evidence.ts `
  --baseline "$env:TEMP/actual-approved-private-before-inventory.json" `
  --publication docs/data/actual-fresh-production-publication-plan.json `
  --out docs/data/d4-final-production-inventory.json `
  --inventory-output "$env:TEMP/ayahx-d4-final-private-inventory.json"
```

هذه مسارات مثال؛ root يمرر baseline الخاص الفعلي وخطة النشر الفعلية، ولا يكتب فوق baseline. baseline وinventory-output يجب أن يكونا خارج Git، والمخرج العام داخل docs/data. ينفّذ captureInventory ويفرض ثبات count/CHECKSUM لـusers/user_roles وجداول D1/D3 مع بصمة النص القانوني، ويعيد بناء بصمة T2 من الحقول المخزنة وdiagnostic READY runs للفصول canonical المحجوبة فقط. يقارنها بـavailability-summary وbaseline إن احتوى availability_fingerprint. لا يُنقل corpus التوقيت كله ولا صوت.

يُرفض اختلاف IDs/slugs/المزوّد/الرواية أو وقائع complete/healthy-complete في آخر24h أو حالة المؤهلة المنشورة عن خطة root. eligible/reasons تُنقل من الخطة نفسها ولا تُخترع. يلتزم flag المغلق ويستعمل isPubliclyVisible الحالية. verified licensed candidates=0 تُثبت حالتها من live query، ولا يصبح YouTube جاهزًا من stamp؛ إن وُجد مرشح تستعمل الخدمة الأصلية CatalogLicensedChapterReadiness/SourceResolver وتتحقق من binding والحقوق والتوقيت ومصدر القراءة بدل اعتبار row verified قبولًا. لذلك قد تجري تلك الحالة قراءة المصدر عبر المحول الأصلي لدى root؛ الحالة الحالية بلا مرشحين لا تفعلها.

المخرج العام whitelist: لا audio URLs أو verification_details الخام أو صفوف الحسابات أو مسار النسخة/الجرد الخاص أو secrets. يتضمن counts/checksums المحمية، metadata التلاوات، review total/pending بكل نوع، allowlist live وثلاث إضافات Archive المعتمدة من proof plan، actual constraints/nullable/collation،df وThreads_connected، وبصمة خطة النشر. private inventory منفصل خارج Git. الفشل يطبع code ثابتًا فقط ويخرج1؛ لا يكتب تقرير نجاح. نجاح القراءة لا يثبت CI/deploy/health/logs، وهي تبقى في operations.

التحقق المحلي للكود: `npx tsx scripts/test-capture-d4-final-evidence.ts`؛ ستة حراس offline ناجحة، وlint الملفات الجديدة بلا رسائل، وtsc scoped ناجح مع declaration ffprobe-static الموجودة. **لم يُشغّل التقاط Railway بواسطة الوكيل الفرعي**؛ الدليل الفعلي يكتبه root بعد التنفيذ.
