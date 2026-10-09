"""Read cached public QUD annotations; emit summaries, never raw corpus/audio.

Opening observations describe the actual annotated clip text and source word
indexes. An unannotated audio prefix remains unverified, never silently absent.
"""
import argparse
import collections
import importlib.util
import json
import pathlib
import unicodedata

spec = importlib.util.spec_from_file_location("audit_qud", pathlib.Path(__file__).with_name("audit-qud-configs.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def review_reason(canonical, row):
    words = row["recited_text"].split()
    exact_indexes = audit.verified_event_word_link(canonical["words"], words, row["word_timestamps"])
    if exact_indexes is not None and len(words) > len(canonical["words"]):
        return "recited_repetition_with_index_evidence"
    if unicodedata.normalize("NFC", row["recited_text"]) == unicodedata.normalize("NFC", canonical["text"]):
        return "unicode_normalization"
    if [audit.token_key(w) for w in words] != [audit.token_key(w) for w in canonical["words"]]:
        legal = {audit.token_key(w) for w in canonical["words"]}
        if any(audit.token_key(w) not in legal for w in words):
            return "text_or_marks_difference"
    return "other_unresolved_mapping"


def opening_observation(row, canonical, basmala, hafs):
    if row is None:
        return {"annotated_clip": "first_ayah_unavailable", "first_index_target": "unavailable"}
    tokens = [audit.token_key(w) for w in row["recited_text"].split()]
    events = row["word_timestamps"] or []
    included = tokens[:len(basmala)] == basmala
    first_index = events[0][0] if events else None
    first_start = events[0][1] if events else None
    target = "basmala" if included else "unresolved"
    if not included and hafs and tokens and first_index == 1 and tokens[0] == audit.token_key(canonical["words"][0]):
        target = "canonical_first_word"
    if not hafs and not included:
        target = "riwayah_canonical_reference_unavailable"
    return {"annotated_clip": "basmala_inside" if included else "basmala_not_in_recited_text",
            "first_index": first_index, "first_start_ms": first_start,
            "first_index_target": target}


def main():
    parser = argparse.ArgumentParser()
    for name in ["corpus", "cache", "catalog", "out"]:
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    corpus = json.loads(pathlib.Path(args.corpus).read_text(encoding="utf-8"))
    catalog = json.loads(pathlib.Path(args.catalog).read_text(encoding="utf-8"))
    cache = pathlib.Path(args.cache)
    summary = json.loads((cache / "summary.json").read_text(encoding="utf-8"))
    metadata = {r["slug"]: r for r in json.loads((cache / "mushafs-metadata.json").read_text(encoding="utf-8"))}
    release = {r["slug"]: r for r in catalog["recitations"]}
    legal = {f'{r["surah"]}:{r["ayah"]}': r for r in corpus["ayahs"]}
    basmala = [audit.token_key(w) for w in legal["1:1"]["words"]]
    chapter_numbers = sorted(int(s) for s in corpus["surahs"] if int(s) > 1 and int(s) != 9)
    reasons = collections.Counter({key: 0 for key in ["recited_repetition_with_index_evidence", "text_or_marks_difference", "unicode_normalization", "other_unresolved_mapping"]})
    reviews, openings, samples, cases = [], [], [], []
    for prior in summary["configs"]:
        slug = prior["config"]
        if slug == "mushafs":
            continue
        rows = [json.loads(line) for line in (cache / (slug + ".recited.jsonl")).read_text(encoding="utf-8").splitlines()]
        by_key = {f'{r["surah"]}:{r["ayah"]}': r for r in rows}
        hafs = prior["riwayah"] == "hafs_an_asim"
        row_reasons = collections.Counter()
        now_review = 0
        unresolved = []
        for row in rows:
            key = f'{row["surah"]}:{row["ayah"]}'
            if not hafs or key not in legal:
                continue
            if row["status"] == "needs_review":
                row_reasons[review_reason(legal[key], row)] += 1
            if audit.diff_words(legal[key]["words"], row["recited_text"].split(), row["word_timestamps"])["status"] == "needs_review":
                now_review += 1
                events = row["word_timestamps"]
                unresolved.append({"ayah": key, "legal_words": len(legal[key]["words"]),
                                   "recited_words": len(row["recited_text"].split()), "events": len(events),
                                   "invalid_duration_events": sum(1 for e in events if len(e) < 3 or e[2] <= e[1]),
                                   "reason": "invalid_source_timing_or_unresolved_mapping; no timing correction fabricated"})
        if hafs:
            reasons.update(row_reasons)
            reviews.append({"config": slug, "reciter_id": release.get(slug, metadata.get(slug, {})).get("reciter_id"),
                            "baseline_needs_review": prior["needs_review"], "classified": dict(row_reasons),
                            "remaining_with_verified_index_diff": now_review, "unresolved_ayahs": unresolved})
            if sum(row_reasons.values()) != prior["needs_review"]:
                raise RuntimeError("BASELINE_CLASSIFICATION_COUNT_MISMATCH:" + slug)
        if slug in release:
            chapters = {str(s): opening_observation(by_key.get(f"{s}:1"), legal[f"{s}:1"], basmala, hafs) for s in chapter_numbers}
            groups = collections.defaultdict(list)
            index_groups = collections.defaultdict(list)
            for number, observed in chapters.items():
                groups[observed["annotated_clip"]].append(int(number))
                index_groups[observed["first_index_target"]].append(int(number))
            explicit_separate = [r for r in rows if r["ayah"] == 0]
            openings.append({"config": slug, "riwayah": prior["riwayah"], "basmala_mode": prior["basmala_mode"],
                             "basmala_reason": prior["basmala_reason"] + " Opening observations are separately audited for every chapter except 1 and 9; audio prefixes are not inferred.",
                             "groups": dict(groups), "first_index_groups": dict(index_groups),
                             "explicit_separate_rows": len(explicit_separate), "chapters": chapters})
        if hafs and len(samples) < 20 and slug in release:
            for key in ["1:1", "2:22", "2:31", "112:1"]:
                row = by_key.get(key)
                if row:
                    samples.append({"config": slug, "ayah": key, "legal_words": len(legal[key]["words"]),
                                    "recited_words": len(row["recited_text"].split()), "events": len(row["word_timestamps"]),
                                    "max_word_index": max((e[0] for e in row["word_timestamps"]), default=None)})
        if slug == "al_hussayni_al_azazy_kids_qdc":
            for key in ["2:22", "2:31"]:
                row = by_key[key]
                cases.append({"config": slug, "ayah": key, "canonical_words": legal[key]["words"],
                              "recited_words": row["recited_text"].split(), "word_timestamps": row["word_timestamps"],
                              "baseline_status": row["status"],
                              "expected_mapping": audit.verified_event_word_link(legal[key]["words"], row["recited_text"].split(), row["word_timestamps"])})
    pause_only = [{"surah": r["surah"], "ayah": r["ayah"], "position": i + 1, "codepoints": [f"U+{ord(c):04X}" for c in word]}
                  for r in corpus["ayahs"] for i, word in enumerate(r["words"]) if not any(unicodedata.category(c).startswith("L") for c in word)]
    report = {"qud_version": corpus["version"], "canonical_checksum": corpus["checksum"],
              "opening_chapters_per_config": len(chapter_numbers), "release_configs": len(release),
              "opening_audits": openings, "baseline_review_total": sum(reasons.values()),
              "review_reason_totals": dict(reasons), "reviews_by_config": reviews,
              "word_count_reference": {"legal_words": corpus["wordCount"], "verse_ornaments_excluded": len(corpus["ayahs"]),
                                       "separate_pause_only_tokens": pause_only, "timestamp_samples": samples},
              "audio_prefix_validation": "not_performed; unannotated prefixes remain unverified"}
    pathlib.Path(args.out).write_text(json.dumps(report, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    pathlib.Path(args.out).with_name("d1-repetition-cases.json").write_text(json.dumps(cases, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"release_configs": len(openings), "classified": sum(reasons.values()), "reasons": dict(reasons),
                      "remaining": sum(r["remaining_with_verified_index_diff"] for r in reviews), "pause_only_tokens": len(pause_only)}))


if __name__ == "__main__":
    main()
