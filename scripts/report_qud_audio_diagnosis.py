"""Read-only B report, with observed patterns separate from proven causes."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path


def digest(value):
    return hashlib.sha256(value).hexdigest()


def build(catalog, original, raw, review, annotation):
    records = {r['slug']: r for r in catalog['recitations']}
    expected = {s for s, r in original['results'].items() if r['verification_status'] == 'failed'}
    if set(records) != set(original['results']) or set(raw['results']) != expected or set(review['results']) != expected:
        raise ValueError('COMPLETE_MATCHING_CATALOG_AND_FAILED_CONFIGS_REQUIRED')
    if review.get('validation_errors') or any(r.get('proof_errors') for r in review['results'].values()):
        raise ValueError('INDEPENDENT_REVIEW_ERRORS_PREVENT_COMPLETION')
    if any(r['status'] not in ('measured', 'source_unavailable') for r in raw['results'].values()):
        raise ValueError('DIAGNOSTIC_ERROR_IS_NOT_AN_AUDIO_RESULT')
    audits = {r['config']: r for r in annotation['configs']}
    grouped, rows = {}, []
    for slug, meta in sorted(records.items()):
        before = original['results'][slug]
        current, checked = raw['results'].get(slug), review['results'].get(slug)
        if slug not in audits:
            raise ValueError('ANNOTATION_AUDIT_REQUIRED')
        cause = checked['reviewed_pattern'] if checked else 'not_rechecked_v1_' + before['verification_status']
        candidate = checked is not None and checked['v2_adoption_candidate'] is True
        row = {'config': slug, 'riwayah': meta['riwayah'], 'channel': meta['channel'],
               'provider_group': meta['channel'], 'audio_category': meta['audio_category'], 'style': meta['style'],
               'offset_metadata_source': 'chapter_offsets_ms_present' if meta['audio'].get('chapter_offsets_ms') else 'source_offset_ms_only',
               'v1_status': before['verification_status'], 'B_status': current['status'] if current else 'not_targeted',
               'observed_pattern': current.get('classification', {}).get('pattern') if current else None,
               'reviewed_cause': cause, 'v2_adoption_candidate': candidate,
               'unique_ayahs_in_HF_audit': audits[slug]['unique_ayahs'],
               'complete_chapters_in_HF_audit': sum(c.get('complete_against_hafs') is True for c in audits[slug]['chapters']),
               'coverage_scope': 'historical HF annotation audit, not D3 Release timing completeness',
               'published': False, 'publication_reason': 'D3/D4 gates and provider audio license/attribution not yet accepted',
               'review_blockers': checked.get('blockers', []) if checked else [],
               'v1_failed_sample_causes': dict(Counter(
                   name for sample in before.get('samples', []) for name, failed in (
                       ('low_correlation', sample['source_offset_hypothesis']['score'] < .95),
                       ('duration_difference', sample['source_offset_hypothesis']['duration_difference_ms'] > 30),
                       ('large_optimal_lag', abs(sample['source_offset_hypothesis']['best_lag_ms']) > 30)) if failed))}
        rows.append(row)
        for field in ('provider_group', 'channel', 'audio_category', 'style', 'riwayah', 'offset_metadata_source'):
            group = grouped.setdefault(field, {}).setdefault(row[field], {'v1': Counter(), 'reviewed_causes': Counter(), 'v2_candidates': 0})
            group['v1'][row['v1_status']] += 1
            group['reviewed_causes'][cause] += 1
            group['v2_candidates'] += candidate
    return {'checked_at': datetime.now(timezone.utc).isoformat(), 'read_only': True,
            'v1_results_replaced': False, 'database_writes': 0, 'publication_changed': False,
            'v1_status_counts': dict(Counter(r['v1_status'] for r in rows)),
            'reviewed_cause_counts': dict(Counter(r['reviewed_cause'] for r in rows if r['B_status'] != 'not_targeted')),
            'v2_adoption_candidates': [r['config'] for r in rows if r['v2_adoption_candidate']],
            'grouped': grouped, 'recitations': rows}


def markdown(report):
    lines = ['# تشخيص فشل الصوت والتوقيت — B', '',
             'نتائج v1 محفوظة. الأنماط العددية لا تثبت السبب وحدها؛ unresolved يعني أن الدليل لا يكفي، لا أنه صوت مختلف أو drift.', '',
             'VAD هنا كاشف طاقة موثق، وليس نموذجًا لغويًا. فرق المدة يقارن مدة HF المعلنة بمدة مقطعه المفكوك؛ لا يمثل قياس نهاية الآية مستقلًا في المصدر.', '',
             'الأعداد والتغطية أدناه من البيانات المقاسة. تغطية HF التاريخية لا تحقق اكتمال توقيت Release المطلوب في D3.', '',
             'v1: ' + json.dumps(report['v1_status_counts'], ensure_ascii=False), '',
             'الأسباب المستقلة: ' + json.dumps(report['reviewed_cause_counts'], ensure_ascii=False), '',
             'مرشحو v2 بعد المراجعة: ' + (', '.join(report['v2_adoption_candidates']) or 'لا أحد') + '. لا كتابة قاعدة أو نشر بهذا التقرير.', '']
    for field, groups in report['grouped'].items():
        lines += [f'## حسب {field}', '', '| المجموعة | v1 | الأسباب المراجعة | مرشحو v2 |', '|---|---|---|---:|']
        for name, value in sorted(groups.items()):
            lines.append(f"| {name} | {dict(value['v1'])} | {dict(value['reviewed_causes'])} | {value['v2_candidates']} |")
        lines.append('')
    lines += ['## كل التلاوات', '', '| التلاوة | الرواية | آيات HF | سور HF كاملة | v1 | نمط عددي B | السبب المراجع | v2 مرشح | النشر |', '|---|---|---:|---:|---|---|---|---|---|']
    for row in report['recitations']:
        lines.append(f"| {row['config']} | {row['riwayah']} | {row['unique_ayahs_in_HF_audit']} | {row['complete_chapters_in_HF_audit']} | {row['v1_status']} | {row['observed_pattern'] or '—'} | {row['reviewed_cause']} | {'نعم' if row['v2_adoption_candidate'] else 'لا'} | غير منشور: شروط D3/D4 والترخيص غير مقبولة بعد |")
    lines += ['', '## الأدلة والقيود', '',
              '- المقاييس لكل عينة والبوابات والأسباب متاحة في تقرير JSON والمراجعة المستقلة المرتبطين بالبصمات أدناه.',
              '- خمس رسوم حقيقية من تلاوات فاشلة فُحصت محليًا؛ بصماتها في b-root-overlay-review.json. الصور والصوت خارج Git.',
              '- بدائل التلاوات غير المتاحة موثقة في d3-source-alternatives.md/json؛ فحص سورة112 لا يعمم على السور الأخرى ولا يثبت الترخيص أو التزامن.',
              '- خطأ scratch المحلي والتشغيل السابق محفوظان منفصلين؛ لا استبدال نتيجة صوتية ولا حذف بديل.',
              '- التنظيف manual_cleanup_required؛ رفض السياسة محفوظ ولا تُجرّب وسيلة تجاوز.', '',
              'بصمات المدخلات: `' + json.dumps(report.get('input_sha256', {}), sort_keys=True) + '`', '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser()
    for name in ('catalog', 'original', 'raw', 'review', 'annotation', 'output', 'markdown'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    inputs = {name: getattr(args, name).read_bytes() for name in ('catalog', 'original', 'raw', 'review', 'annotation')}
    if json.loads(inputs['review'])['raw_report_sha256'] != digest(inputs['raw']):
        raise ValueError('REVIEW_RAW_SHA_MISMATCH')
    result = build(*(json.loads(inputs[name]) for name in ('catalog', 'original', 'raw', 'review', 'annotation')))
    result['input_sha256'] = {name: digest(value) for name, value in inputs.items()}
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    args.markdown.write_text(markdown(result), encoding='utf-8')
    print(json.dumps({'recitations': len(result['recitations']), 'v2_candidates': len(result['v2_adoption_candidates'])}))


if __name__ == '__main__':
    main()
