"""Derive diagnostics from retained measurements without changing acceptance."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
from statistics import pstdev


def analyze(catalog, evidence):
    records = {row['slug']: row for row in catalog['recitations']}
    if set(records) != set(evidence['results']):
        raise ValueError('CATALOG_EVIDENCE_CONFIG_MISMATCH')
    reasons = ('low_correlation', 'duration_difference', 'large_optimal_lag')
    samples_total, sample_failures = Counter(), Counter()
    recitation_failures, combinations = Counter(), Counter()
    by_offset_source, by_channel = {}, {}
    results = []
    for slug, record in sorted(records.items()):
        previous = evidence['results'][slug]
        status = previous['verification_status']
        chapter_offsets = record['audio'].get('chapter_offsets_ms') or {}
        source_group = 'chapter_offsets_ms_present' if chapter_offsets else 'source_offset_ms_only'
        counts, lags, trusted_lags, scores, deltas, failures = Counter(), [], [], [], [], []
        declared_end_outside_source, boundary_checks_unavailable = [], 0
        for row in previous['samples']:
            sample = row['source_offset_hypothesis']
            # Missing measurements must be reported; never coerce them to zero.
            if not all(key in sample and math.isfinite(sample[key]) for key in ('score', 'best_lag_ms', 'duration_difference_ms')):
                raise ValueError(f'INCOMPLETE_SAMPLE_MEASUREMENTS:{slug}:{row["surah"]}:{row["ayah"]}')
            score, lag, delta = sample['score'], sample['best_lag_ms'], sample['duration_difference_ms']
            bad = [reason for reason, condition in zip(reasons, (score < .95, delta > 30, abs(lag) > 30)) if condition]
            if sample['passed'] != (not bad):
                raise ValueError(f'ROUNDED_SCORE_OR_ACCEPTANCE_DISAGREEMENT:{slug}')
            counts.update(bad)
            sample_failures.update(bad)
            samples_total['measured'] += 1
            samples_total['failed' if bad else 'passed'] += 1
            if bad:
                combinations['+'.join(bad)] += 1
                failures.append({'surah': row['surah'], 'ayah': row['ayah'], 'reasons': bad,
                                 'score': score, 'lag_ms': lag, 'duration_difference_ms': delta})
            lags.append(lag)
            scores.append(score)
            deltas.append(delta)
            if score >= .95:
                trusted_lags.append(lag)
            source_length = previous.get('decoded_source_duration_ms', {}).get(str(row['surah']))
            if source_length is None:
                boundary_checks_unavailable += 1
            else:
                overrun = row['source_offset_ms'] + row['duration_ms'] - source_length
                if overrun > 0:
                    declared_end_outside_source.append({'surah': row['surah'], 'ayah': row['ayah'], 'declared_overrun_ms': overrun})
        std = pstdev(lags) if lags else None
        trusted_std = pstdev(trusted_lags) if len(trusted_lags) >= 2 else None
        trusted_spread = max(trusted_lags) - min(trusted_lags) if len(trusted_lags) >= 2 else None
        # 10ms was the prior correction-storage diagnostic, not an additional
        # acceptance threshold. Lags with poor correlation are less reliable.
        unstable = std is not None and std > 10
        if status == 'failed':
            recitation_failures.update(reason for reason in reasons if counts[reason])
            if unstable:
                recitation_failures['lag_std_over_10ms_diagnostic'] += 1
            if trusted_std is not None and trusted_std > 10:
                recitation_failures['high_correlation_lag_std_over_10ms_diagnostic'] += 1
        for groups, key in ((by_offset_source, source_group), (by_channel, record['channel'])):
            group = groups.setdefault(key, {'statuses': Counter(), 'failed_samples': Counter(), 'failed_recitations': Counter(), 'measured_samples': 0})
            group['statuses'][status] += 1
            group['failed_samples'].update(counts)
            group['measured_samples'] += len(lags)
            if status == 'failed':
                group['failed_recitations'].update(reason for reason in reasons if counts[reason])
                if unstable:
                    group['failed_recitations']['lag_std_over_10ms_diagnostic'] += 1
        results.append({'config': slug, 'name_ar': record['name_ar'], 'channel': record['channel'], 'offset_metadata_group': source_group,
                        'chapter_offsets_count': len(chapter_offsets), 'measured_hypothesis': 'source_offset_ms' if lags else None,
                        'chapter_plus_source_measured_samples': sum('chapter_plus_source_hypothesis' in row for row in previous['samples']),
                        'original_status': status, 'sample_count': len(lags), 'failed_sample_count': len(failures),
                        'failure_counts': dict(counts), 'minimum_correlation': min(scores) if scores else None,
                        'maximum_duration_difference_ms': max(deltas) if deltas else None,
                        'maximum_absolute_lag_ms': max(map(abs, lags)) if lags else None,
                        'lag_std_ms': std, 'lag_std_over_10ms_diagnostic': unstable,
                        'high_correlation_lag_count': len(trusted_lags), 'high_correlation_lag_std_ms': trusted_std,
                        'high_correlation_lag_range_ms': trusted_spread,
                        'source_boundary_checks_unavailable': boundary_checks_unavailable,
                        'declared_end_outside_source': declared_end_outside_source, 'failed_samples': failures,
                        'unavailable_reason': previous.get('source_error') if not lags else None})
    known_bounds = sum(row['sample_count'] - row['source_boundary_checks_unavailable'] for row in results)
    overruns = [entry for row in results for entry in row['declared_end_outside_source']]
    return {'checked_at': datetime.now(timezone.utc).isoformat(), 'read_only': True, 'original_results_replaced': False,
            'acceptance': {'minimum_correlation': .95, 'maximum_duration_difference_ms': 30, 'maximum_absolute_lag_ms': 30},
            'status_counts': dict(Counter(row['original_status'] for row in results)),
            'sample_counts': dict(samples_total), 'overlapping_failed_sample_causes': dict(sample_failures),
            'overlapping_failed_recitation_causes': dict(recitation_failures), 'exclusive_failed_sample_combinations': dict(combinations),
            'by_offset_metadata': by_offset_source, 'by_channel': by_channel, 'recitations': results,
            'source_boundary_summary': {'known_sample_source_durations': known_bounds, 'unknown_sample_source_durations': samples_total['measured'] - known_bounds,
                                        'declared_end_outside_source_samples': len(overruns), 'recitations_with_declared_overrun': sum(bool(row['declared_end_outside_source']) for row in results)},
            'lag_instability_definition': 'Population std >10ms is diagnostic only, inherited from correction-storage rule. No new pass/fail gate. High-correlation subset excludes NCC<0.95 lags.',
            'duration_definition': 'Absolute decoded HF clip duration at 8000Hz minus HF duration_ms; original source ayah end is not independently measured.',
            'waveforms_available_for_offline_replay': False}


def markdown(report):
    lines = ['# تحليل offset لكل تلاوة — D2', '',
             'الأسباب متداخلة، والنتيجة القديمة محفوظة دون إعادة تصنيف. σ>10ms علامة تشخيصية فقط؛ أعمدة σ موضحة أدناه، ولا تضيف معيار قبول. «—» يعني أن القياس غير متاح.', '',
             '| التلاوة | المصدر | metadata offset | الحالة | فاشلة/مقاسة | NCC<0.95 | مدة>30ms | abs(lag)>30ms | σ الكل ms | σ NCC≥0.95 ms | أقل NCC | أكبر فرق مدة ms | أكبر abs(lag) ms |',
             '|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
    fmt = lambda x: '—' if x is None else f'{x:.3f}'
    for row in report['recitations']:
        counts = row['failure_counts']
        group = 'chapter موجود؛ لم يُقَس' if row['chapter_offsets_count'] else 'source'
        values = [f"`{row['config']}`", row['channel'], group, row['original_status'], f"{row['failed_sample_count']}/{row['sample_count']}",
                  *[str(counts.get(reason, 0)) if row['sample_count'] else '—' for reason in ('low_correlation', 'duration_difference', 'large_optimal_lag')],
                  fmt(row['lag_std_ms']), fmt(row['high_correlation_lag_std_ms']), '—' if row['minimum_correlation'] is None else f"{row['minimum_correlation']:.8f}",
                  fmt(row['maximum_duration_difference_ms']), fmt(row['maximum_absolute_lag_ms'])]
        lines.append('| ' + ' | '.join(values) + ' |')
    lines.extend(['', 'صفر عينات لا يعني نجاح المعايير. metadata chapter_offsets_ms وsource_offset_ms مجموعتان وصفيتان؛ لم تتوفر ملفات الصوت الأصلية للمجموعة الأولى. σ على NCC≥0.95 أدق في تشخيص تغير الإزاحة؛ argmax عند ارتباط منخفض ليس قياس إزاحة موثوقًا.', ''])
    return '\n'.join(lines)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ('catalog', 'evidence', 'out-json', 'out-markdown'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    catalog_bytes, evidence_bytes = Path(args.catalog).read_bytes(), Path(args.evidence).read_bytes()
    report = analyze(json.loads(catalog_bytes), json.loads(evidence_bytes))
    report['catalog_sha256'] = hashlib.sha256(catalog_bytes).hexdigest()
    report['original_evidence_sha256'] = hashlib.sha256(evidence_bytes).hexdigest()
    Path(args.out_json).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    Path(args.out_markdown).write_text(markdown(report), encoding='utf-8')
    print(json.dumps({key: report[key] for key in ('status_counts', 'sample_counts', 'overlapping_failed_sample_causes', 'overlapping_failed_recitation_causes', 'by_offset_metadata')}, ensure_ascii=False))
