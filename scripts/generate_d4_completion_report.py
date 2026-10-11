"""Generate an Arabic D4 report from local, public evidence only; performs no network/DB work."""
import argparse
import hashlib
import json
import math
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlsplit


PENDING = 'pending — لم يصل دليل نهائي'
ARTIFACTS = {
    'availability': 'docs/data/availability-summary.json',
    'voice': 'docs/data/voice-auto-verification.json',
    't7': 'docs/data/d4-t7-execution-results.json',
    'links': 'docs/data/link-scan-final.json',
    'k1': 'docs/data/d4-k1-scratch.json',
}
REFERENCES = [
    'docs/data/d4-t7-execution-report.md', 'docs/data/voice-auto-verification.md',
    'docs/data/legacy-reciter-mapping-audit.md', 'docs/data/qud-audio-provenance.md',
    'docs/data/provider-terms-digest.md', 'docs/data/k5-r2-real-acceptance-guide.ar.md',
    'docs/data/d4-k1-local-rehearsal.json', 'docs/data/d4-k1-production-apply.json',
    'docs/data/d4-k3-production-apply.json', 'docs/data/d4-k6-production-apply.json',
    'docs/data/d4-k9-final-migration004.json', 'docs/data/d4-k9-final-migration005.json',
    'docs/data/d4-k9-reconcile-local-first.json', 'docs/data/d4-k9-reconcile-local-second.json',
    'docs/data/d4-r2-control-plane-readback.json', 'docs/data/d4-r2-browser-cors.json',
    'docs/data/d4-r2-real-acceptance.json', 'docs/data/d4-r2-log-secret-scan.json',
    'docs/data/d4-r2-billing-before-after.json', 'docs/data/d4-r2-variables.json',
    'docs/data/d4-r2-budget-alert.json', 'docs/data/d4-budget-resume-20261011.json',
    'docs/data/d4-human-reviews-final-local-apply.json',
    'docs/plan/ADMIN_RECITERS_SOURCES_SPEC.md', 'docs/launch-blockers.md',
]


def cell(value):
    if value is None:
        return PENDING
    if not isinstance(value, (str, int, float, bool)):
        raise ValueError('PUBLIC_CELL_MUST_BE_SCALAR')
    if isinstance(value, bool):
        return 'نعم' if value else 'لا'
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if not math.isfinite(value):
            raise ValueError('NONFINITE_PUBLIC_VALUE')
    return str(value).replace('|', '\\|').replace('\n', ' ').replace('\r', ' ')


def count_text(values):
    return ', '.join(f'{cell(key)}:{cell(value)}' for key, value in sorted(values.items()))


def keyed(rows):
    result = {}
    for row in rows:
        slug = row['slug']
        if not isinstance(slug, str) or not slug or slug in result:
            raise ValueError('INVALID_OR_DUPLICATE_RECITATION_SLUG')
        result[slug] = row
    return result


def load(path):
    return json.loads(Path(path).read_bytes())


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def evidence_link(root, relative):
    target = (root / relative).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError('EVIDENCE_OUTSIDE_REPOSITORY')
    if not target.is_file():
        return f'{cell(relative)}: {PENDING}'
    # Output is docs/data/d4-completion-report.ar.md.
    return f'[{cell(relative)}](../../{relative}) — SHA-256 `{sha(target)}`'


def numeric(value):
    return value if isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value) else None


def public_reference(root, value):
    if not isinstance(value, str) or not value:
        return PENDING
    if value.startswith('https://'):
        parsed = urlsplit(value)
        if parsed.hostname not in {'github.com', 'railway.com', 'railway.app', 'dash.cloudflare.com',
                                   'developers.cloudflare.com'} or parsed.username or parsed.password or parsed.query:
            raise ValueError('UNSAFE_PUBLIC_PROOF_URL')
        return f'[{cell(value)}]({value})'
    if '://' in value:
        raise ValueError('PUBLIC_PROOF_REQUIRES_HTTPS_OR_REPOSITORY_FILE')
    return evidence_link(root, value)


def render(root, artifacts, inventory=None, operations=None, extra_proofs=()):
    availability = keyed(artifacts['availability']['recitations'])
    voice = artifacts['voice']['results']
    if set(availability) != set(voice):
        raise ValueError('CATALOG_VOICE_SLUGS_DIFFER')
    if inventory is not None:
        if inventory.get('read_only') is not True or not inventory.get('checked_at'):
            raise ValueError('FINAL_INVENTORY_REQUIRES_READ_ONLY_AND_CHECKED_AT')
        final = keyed(inventory['recitations'])
        if set(final) != set(availability):
            raise ValueError('FINAL_INVENTORY_SLUGS_DIFFER')
    else:
        final = {}
    operations = operations or {}
    links = defaultdict(Counter)
    for row in artifacts['links']['last_checks']:
        links[row['recitation']][row['status']] += 1
    t7 = artifacts['t7']['results']
    unknown = (set(t7) | set(links)) - set(availability)
    if unknown:
        raise ValueError('EVIDENCE_UNKNOWN_RECITATION')
    for row in final.values():
        for field in ('rule_v1_eligible', 'public_visible', 'offset_verified'):
            if field in row and row[field] is not None and not isinstance(row[field], bool):
                raise ValueError('FINAL_DECISION_REQUIRES_BOOLEAN_' + field)
    eligible = [slug for slug, row in final.items() if row.get('rule_v1_eligible') is True]
    unknown_rule = len(availability) - sum(isinstance(row.get('rule_v1_eligible'), bool) for row in final.values())
    eligible_readers = {final[slug].get('reciter_id') for slug in eligible}
    complete_reader_count = len(eligible_readers) if None not in eligible_readers else None
    auto_count = sum(final.get(slug, {}).get('voice_identity_status', voice[slug].get('voice_identity_status'))
                     == 'auto_verified' for slug in availability)
    lines = ['# تقرير المرحلة D4 — طبقة الصوت؛ الدفعة K1–K9', '',
             'هذا تقرير مولّد من الأدلة المحلية فقط. لا يستدل من وجود ملف على نجاح نشر أو إغلاق الدفعة. '
             'الجرد النهائي وقرارات rule-v1 وبوابات الإنتاج تأتي من root، والناقص يبقى pending.', '',
             '## 1. ما الذي تغيّر', '',
             'K1 قيود النشر؛ K2 الروابط والمضيفون؛ K3 عينات الاستماع؛ K4 الفحص الآلي الاستشاري؛ '
             'K5 مصادر YouTube/الملف المرخص والتخزين؛ K6 المراجعة البشرية؛ K7 القياسات المثبتة؛ '
             'K8 النشر التقني؛ K9 الاختبارات والشحن. لا يتضمن ذلك A1 أو D5 أو تغيير الواجهة.', '',
             f'التلاوات المحسوبة من الجرد المصدر: **{len(availability)}**. '
             f'auto_verified بحسب الحالة المصدرية: **{auto_count}**. '
             f'المؤهلة rule-v1 المثبتة في الجرد النهائي: **{len(eligible) if not unknown_rule else PENDING}**؛ '
             f'قراء المؤهلات: **{cell(complete_reader_count) if final and not unknown_rule else PENDING}**؛ '
             f'قرارات rule-v1 غير المتوفرة: **{unknown_rule}**. '
             'لا تُمنح أهلية جديدة من T7 أو status وحده.', '',
             '## 2. ما الذي تحققت منه فعليًا', '',
             '### جدول التلاوات؛ كل مصدر معلّم مستقلًا', '',
             '| التلاوة | القارئ / المصدر | الرواية | نتيجة الروابط K2 | V1/V2/V3/V4 | حالة الصوت | offset DB /T7 | الإتاحة الزمنية T2 /الصوتية النهائية | rule-v1 /الأسباب |',
             '|---|---|---|---|---|---|---|---|---|']
    for slug in sorted(availability):
        a, v, f = availability[slug], voice[slug], final.get(slug, {})
        link_counts = ', '.join(f'{key}:{value}' for key, value in sorted(links[slug].items())) or PENDING
        checks = '/'.join('pass' if v.get(key, {}).get('passed') is True else
                          v.get(key, {}).get('status', 'unverified') for key in ('V1', 'V2', 'V3', 'V4'))
        timing = ', '.join(f'{key}:{a.get(key, PENDING)}' for key in ('complete', 'near_complete', 'partial', 'unavailable'))
        actual = t7.get(slug)
        t7_value = (f"{actual['verification_status']}/{actual.get('verification_method_candidate', '—')}; "
                    f"samples={actual.get('measured_samples', 0)}" if actual else 'خارج T7؛ لم يُعد قياسه')
        db_offset = f"{cell(f.get('offset_verified'))}/{cell(f.get('offset_method', f.get('verification_method')))}"
        reasons = f.get('rule_v1_reasons')
        rule = cell(f.get('rule_v1_eligible')) + '; ' + (', '.join(map(cell, reasons)) if isinstance(reasons, list) else PENDING)
        source = f.get('provider', a['source'])
        name = f.get('name_ar', a['reciter'])
        state = f.get('voice_identity_status', v.get('voice_identity_status', 'unverified'))
        lines.append('| ' + ' | '.join(map(cell, [slug, f'{name} /{source}', a['riwayah'], link_counts, checks,
                     state, db_offset + ' /T7:' + t7_value, timing + ' /valid_audio_complete:' +
                     cell(f.get('valid_complete_chapters')), rule])) + ' |')
    if operations.get('changes'):
        lines += ['', 'تفاصيل الملفات/الجداول/endpoints الموثقة من root:']
        lines.extend('- ' + cell(change) for change in operations['changes'])
    lines += ['', 'T2 أعلاه تغطية التوقيت وحدها؛ لا تعني فصلًا قابلًا للتشغيل. '
              'valid_audio_complete يأتي من الجرد النهائي، وK2 available لا يُحوّل بذاته إلى جاهزية أو ترخيص.', '',
              '### T7 والهوية الصوتية', '',
              f"نتيجة T7 المصدرية: {count_text(artifacts['t7'].get('counts', {}))}؛ "
              f"العينات الحقيقية {artifacts['t7'].get('measured_samples')}. "
              f"real_measurements_complete={cell(artifacts['t7'].get('real_measurements_complete'))}. "
              'لا إعادة اختيار ولا تخفيف ولا قبول بشري لمرشح v2. الفحص V1–V4 استشاري، '
              'واتساق المتحدث ليس إثباتًا مطلقًا للاسم.', '',
              '### تلاوات YouTube المحسوبة من المصدر', '',
              '| التلاوة | oEmbed/الروابط | مستوى الملف المرخص النهائي | حقوق/ترخيص نهائي |',
              '|---|---|---|---|']
    youtube = [slug for slug, a in availability.items() if a['source'] == 'youtube']
    for slug in sorted(youtube):
        f = final.get(slug, {})
        lines.append(f"| {cell(slug)} | {count_text(links[slug])} | {cell(f.get('youtube_audio_state'))} | {cell(f.get('license_status'))} |")
    lines += ['', f'العدد الفعلي من الكتالوج: **{len(youtube)}**؛ يُحسب من المصدر، '
              'ويُوثّق اختلافه عن وصف المستخدم القديم في provenance/data_conflict. '
              'لا صوت YouTube مُستخرج؛ IFrame الرسمي أو ملف مرخص مثبت فقط.', '',
              '### المضيفون المضافون وقائمة المراجعة', '']
    if inventory and 'added_hosts' in inventory:
        for host in inventory['added_hosts']:
            lines.append(f"- {cell(host.get('host'))}: {cell(host.get('reason'))}; "
                         f"evidence={cell(host.get('evidence_ref'))}")
        if not inventory['added_hosts']:
            lines.append('- الجرد النهائي يثبت صفر مضيفين مضافين.')
    else:
        lines.append('- المضيفون وأدلة redirect/TLS/الملكية: ' + PENDING)
    lines += ['', '| نوع المراجعة | جميع البنود من الجرد النهائي | pending |', '|---|---|---|']
    review = (inventory or {}).get('review_counts_by_type')
    pending_review = (inventory or {}).get('review_pending_counts_by_type', {})
    if isinstance(review, dict):
        for key, value in sorted(review.items()):
            lines.append(f'| {cell(key)} | {cell(value)} | {cell(pending_review.get(key))} |')
    else:
        lines.append('| جميع الأنواع | ' + PENDING + ' | ' + PENDING + ' |')
    lines += ['', '### السبب الجذري K1 ومنشأ الصوت', '',
              'التشخيص المصدر من scratch K1: ' + cell(artifacts['k1'].get('diagnosis')), '',
              'QUD v3.2.0 مصدر metadata/timing وليس إذنًا عامًا لحقوق كل تسجيل. '
              'Release يربط الصوت الخارجي؛ HF للتدقيق؛ ولا مصدر بديل لنفس تسجيل YouTube يُعتمد بمجرد اسم القارئ. '
              'التفصيل والأدلة في [qud-audio-provenance.md](qud-audio-provenance.md) '
              'و[provider-terms-digest.md](provider-terms-digest.md).', '',
              '### أدلة الإنتاج والشحن النهائية', '',
              '| بوابة | النتيجة النهائية المدخلة |', '|---|---|']
    gates = operations.get('gates', {})
    for key in ('tsc', 'changed_lint', 'npm_test', 'build', 'ci', 'merge', 'deployment_success',
                'health', 'ready', 'logs_10_minutes', 'read_only_smoke', 'catalog_disabled_404',
                'r2_real_acceptance', 'r2_cleanup', 'r2_secret_scan', 'rollback'):
        record = gates.get(key)
        if isinstance(record, dict) and record.get('status') and record.get('evidence_ref'):
            ref = public_reference(root, record['evidence_ref'])
            result = (cell(record.get('status')) + '; evidence=' + ref) if PENDING not in ref else PENDING
            tests = record.get('tests', {})
            if isinstance(tests, dict) and tests:
                result += '; tests=' + count_text({key: tests[key] for key in ('total', 'passed', 'failed', 'skipped') if key in tests})
        else:
            result = PENDING
        lines.append(f'| {key} | {result} |')
    lines += ['', 'الجرد المحمي النهائي (قراءة): ' + cell((inventory or {}).get('protected_verification_summary')), '',
              'flag_enabled النهائي: ' + cell((inventory or {}).get('flag_enabled')) + '. '
              'لا تعتبر هذه القيمة بديلًا لاختبار API 404/كود QURAN_CATALOG_DISABLED.', '',
              '## 3. نتائج الاختبارات', '',
              'جميع الأعداد والنتائج تُقرأ من gates المدخلة أعلاه؛ لا يُعلن CI أو نشر SUCCESS دون أثر نهائي. '
              'مؤشرات الوحدات/المحلي مستقلة عن اختبارات Railway وR2 الحقيقي.', '',
              '## 4. ما لم يكتمل أو يحتاج مراجعة، وسببه', '',
              '- كل pending في الجدول أو البوابات دليل ناقص؛ التقرير لا يعلن إغلاق D4.',
              '- التأكيد البشري للصوت والرخصة والحقوق والأسماء والبسملة وقبول v2 يذهب إلى مركز المراجعة؛ لا confirmed آلي.',
              '- ملفات YouTube المرخصة غير المثبتة لا تمنح جاهزية ريندر. '
              'R2 الحقيقي له قبول مستقل 1–7، وMinIO/محول محلي لا يُسمى R2.', '',
              '## 5. المخاطر المعروفة', '',
              '- الإتاحة الزمنية، صحة الرابط، الصوت، offset، الترخيص والنشر بوابات مستقلة؛ لا fallback بين تلاوات.',
              '- الأدلة التاريخية لا تُحذف أو تُحوّل إلى نجاح؛ الاعتماد على snapshot نهائي محدد وتاريخه وبصمته.',
              '- rule-v1 نشر تقني فقط؛ الظهور العام يعتمد السياسة والترخيص والـflag. '
              'لا تبديل تلقائي إلى R2 ولا تعديل النص القانوني.', '',
              '### الاستهلاك المالي قبل/بعد', '',
              '| بند | قبل $ | بعد $ | الفرق $ | دليل/ملاحظة |', '|---|---|---|---|---|']
    operation_rows = []
    for provider in ('railway', 'cloudflare_r2'):
        b = operations.get('billing', {}).get(provider, {})
        before, after = numeric(b.get('before_dollars')), numeric(b.get('after_dollars'))
        delta = float(Decimal(str(after)) - Decimal(str(before))) if before is not None and after is not None else None
        lines.append(f"| {provider} | {cell(before)} | {cell(after)} | {cell(delta)} | {cell(b.get('evidence_ref'))} |")
        for metric in ('class_a_operations', 'class_b_operations'):
            if 'before_' + metric in b or 'after_' + metric in b:
                operation_rows.append(f"| {provider}/{metric} | {cell(b.get('before_' + metric))} | "
                                      f"{cell(b.get('after_' + metric))} |")
    if operation_rows:
        lines += ['', 'عمليات R2؛ أعداد مستقلة عن الدولار:', '', '| نوع العمليات | قبل | بعد |',
                  '|---|---|---|'] + operation_rows + ['', 'قد تتأخر الفاتورة؛ لا يُستنتج من هذه الأعداد إنفاق منفرد.']
    lines += ['', 'الفرق حساب لقيمتين مدخلتين فقط؛ ليس إسنادًا سببيًا لتكلفة D4 أو توفيرًا دون فاتورة. '
              'حدود الصرف والمتبقي: ' + cell(operations.get('billing', {}).get('budget_summary')), '',
              '## 6. الخطوة التالية المقترحة', '',
              'تراجع root الأدلة النهائية وتستكمل بوابات هذه الدفعة فقط. بعد تقريرها توقف تام؛ '
              'لا A1 ولا D5 قبل تفويض جديد.', '', '### القرارات الذاتية المدخلة', '']
    for decision in operations.get('self_decisions', [PENDING]):
        lines.append('- ' + cell(decision))
    lines += ['', '### مراجع الأدلة وبصماتها', '']
    for relative in list(ARTIFACTS.values()) + REFERENCES + list(extra_proofs):
        lines.append('- ' + evidence_link(root, relative))
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo-root', default='.')
    parser.add_argument('--inventory', help='Final read-only inventory; absent fields remain pending')
    parser.add_argument('--operations', help='Public billing/gates/self_decisions only; never supply secrets')
    parser.add_argument('--proof', action='append', default=[], help='Additional repository-relative proof file')
    parser.add_argument('--out', default='docs/data/d4-completion-report.ar.md')
    args = parser.parse_args()
    root = Path(args.repo_root).resolve()
    artifacts = {key: load(root / relative) for key, relative in ARTIFACTS.items()}
    inventory = load(args.inventory) if args.inventory else None
    operations = load(args.operations) if args.operations else None
    text = render(root, artifacts, inventory, operations, args.proof)
    for label, path in [('final inventory', args.inventory), ('operations', args.operations)]:
        text += f'\n- {label}: SHA-256 `{sha(path)}`\n' if path else f'\n- {label}: {PENDING}\n'
    output = Path(args.out)
    output.write_bytes(text.encode('utf-8'))
    print(json.dumps({'out': str(output), 'sha256': sha(output),
                      'recitations': len(artifacts['availability']['recitations']),
                      'inventory_provided': inventory is not None, 'network_requests': 0, 'database_writes': 0}))


if __name__ == '__main__':
    main()
