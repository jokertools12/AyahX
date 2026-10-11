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
