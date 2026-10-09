"""D1 read-only full HF audit. Never downloads/rehosts audio columns.

Optional local tool dependencies: duckdb (HTTP column projection) and fonttools.
Cache and raw recited text stay in an explicit output directory outside Git.
"""
import argparse
import difflib
import hashlib
import json
import pathlib
import re
import unicodedata
import urllib.request

import duckdb


DATASET = "QUD-Technologies%2Fquranic-universal-ayahs"


def normalize_riwayah(value):
    # Explicit source metadata vocabulary; never infer from a slug.
    return {"Hafs A'n Assem": "hafs_an_asim", "Qalon A'n Nafi'": "qalon_an_nafi", "Warsh A'n Nafi'": "warsh_an_nafi"}.get(value, value)


def fetch_json(url):
    with urllib.request.urlopen(url, timeout=120) as response:
        return json.load(response)


def token_key(word):
    # NFC preserves lexical hamza (أ/إ/ؤ/ئ), unlike stripping NFD marks.
    return "".join(char for char in unicodedata.normalize("NFC", word)
                   if unicodedata.category(char).startswith("L")).replace("ٱ", "ا")


def verified_event_word_link(canonical, recited, timestamps):
    """Validate source indexes against every recited word, without guessing.

    Educational recordings repeat nested phrases. A single SequenceMatcher
    insertion cannot represent every such phrase. The source can resolve that
    ambiguity only when each acoustic event agrees with the recited token and
    its legal indexed word, and every legal word is covered.
    """
    if len(recited) != len(timestamps or []) or not canonical:
        return None
    indexes = []
    for spoken, event in zip(recited, timestamps):
        if len(event) < 3:
            return None
        index, start, end = event[:3]
        if not isinstance(index, int) or not 1 <= index <= len(canonical) or start < 0 or end <= start:
            return None
        if token_key(spoken) != token_key(canonical[index - 1]):
            return None
        indexes.append(index)
    if set(indexes) != set(range(1, len(canonical) + 1)):
        return None
    if any(timestamps[i][1] < timestamps[i - 1][1] for i in range(1, len(timestamps))):
        return None
    return indexes


def diff_words(canonical, recited, timestamps=None):
    """Only exact normalized words or provable repeated word sequences map.

    Substitution, omission and ambiguous insertions fail closed. Legal text is
    never changed. Returned positions are 1-based canonical positions.
    """
    legal = [token_key(word) for word in canonical]
    spoken = [token_key(word) for word in recited]
    if not all(legal) or not all(spoken):
        return {"status": "needs_review", "mapping": [], "repeated_words": 0}
    if timestamps is not None:
        indexed = verified_event_word_link(canonical, recited, timestamps)
        if indexed is not None:
            return {"status": "mapped", "mapping": indexed,
                    "repeated_words": len(recited) - len(canonical),
                    "mapping_evidence": "every_recited_token_matches_its_source_index"}
    mapping = [None] * len(spoken)
    repeated = 0
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, legal, spoken, autojunk=False).get_opcodes():
        if tag == "equal":
            mapping[j1:j2] = list(range(i1 + 1, i2 + 1))
        elif tag == "insert":
            fragment = spoken[j1:j2]
            candidates = [i for i in range(len(legal) - len(fragment) + 1)
                          if legal[i:i + len(fragment)] == fragment]
            if len(candidates) != 1:
                return {"status": "needs_review", "mapping": [], "repeated_words": repeated}
            start = candidates[0]
            mapping[j1:j2] = list(range(start + 1, start + len(fragment) + 1))
            repeated += len(fragment)
        else:
            return {"status": "needs_review", "mapping": [], "repeated_words": repeated}
    return {"status": "mapped", "mapping": mapping, "repeated_words": repeated}


def audit_config(config, rows, legal):
    seen = set()
    repeated_ayahs = 0
    repeated_words = 0
    needs_review = 0
    exact_text = 0
    timing_mismatch = 0
    missing_legal = 0
    first_ayah = None
    rows_checksum = hashlib.sha256()
    for surah, ayah, text, timestamps in rows:
        key = f"{surah}:{ayah}"
        seen.add(key)
        rows_checksum.update(f"{key}\t{text}\n".encode("utf-8"))
        if key == "1:1":
            first_ayah = text
        canonical = legal.get(key)
        if not canonical:
            missing_legal += 1
            continue
        recited = text.split()
        result = diff_words(canonical["words"], recited)
        if text == canonical["text"]:
            exact_text += 1
        if result["status"] == "needs_review":
            needs_review += 1
        if result["repeated_words"]:
            repeated_ayahs += 1
            repeated_words += result["repeated_words"]
        # QUD word index repeats are acoustic events, not legal word count.
        indexes = {int(word[0]) for word in (timestamps or []) if word and int(word[0]) > 0}
        if indexes != set(range(1, len(canonical["words"]) + 1)):
            timing_mismatch += 1
    if first_ayah is not None:
        basmala_mode = "ayah_1_included"
        reason = "Dataset contains row 1:1; exact text equality is recorded separately."
    else:
        basmala_mode = "absent"
        reason = "No 1:1 row and no explicit separate_clip metadata. Audio is not inferred."
    return {
        "config": config, "rows": len(rows), "unique_ayahs": len(seen),
        "basmala_mode": basmala_mode, "basmala_reason": reason,
        "ayah_1_available": first_ayah is not None,
        "canonical_text_exact": exact_text, "repeated_ayahs": repeated_ayahs,
        "repeated_words": repeated_words, "needs_review": needs_review,
        "timing_index_mismatches": timing_mismatch, "unmatched_legal_keys": missing_legal,
        "recited_checksum": rows_checksum.hexdigest(),
        "word_highlighting_policy": "disabled for needs_review; verse-only",
        "repetition_display_mode": "canonical", "offset_verified": False,
        "offset_check_score": None, "offset_reason": "D4 validation not run; D1 does not publish recitations",
        "publication_status": "needs_review", "published": False,
        "audio_mode_allowed": None,
        "follow_up": "D4 offset audit; failures realign in D5 on served audio",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--finalize-cache", action="store_true")
    parser.add_argument("--metadata-only", action="store_true")
    args = parser.parse_args()
    root = pathlib.Path(args.out)
    root.mkdir(parents=True, exist_ok=True)
    corpus = json.loads(pathlib.Path(args.corpus).read_text(encoding="utf-8"))
    catalog = json.loads(pathlib.Path(args.catalog).read_text(encoding="utf-8"))
    released = {row["slug"]: row for row in catalog["recitations"]}
    legal = {f'{row["surah"]}:{row["ayah"]}': row for row in corpus["ayahs"]}
    metadata_file = root / "mushafs-metadata.json"
    if metadata_file.exists():
        mushafs = json.loads(metadata_file.read_text(encoding="utf-8"))
    else:
        mushafs = []
        while True:
            page = fetch_json(f"https://datasets-server.huggingface.co/rows?dataset={DATASET}&config=mushafs&split=all&offset={len(mushafs)}&length=100")
            batch = [item["row"] for item in page["rows"]]
            mushafs.extend(batch)
            if len(mushafs) >= page["num_rows_total"]:
                break
            if not batch:
                raise RuntimeError("MUSHAFS_METADATA_INCOMPLETE")
        metadata_file.write_text(json.dumps(mushafs, ensure_ascii=False, indent=2), encoding="utf-8")
    metadata = {row["slug"]: row for row in mushafs}
    if args.metadata_only:
        result = json.loads((root / "summary.json").read_text(encoding="utf-8"))
        summaries = [row for row in result["configs"] if row["config"] != "mushafs"]
        for row in summaries:
            source_riwayah = released.get(row["config"], metadata.get(row["config"], {})).get("riwayah", "metadata_unavailable")
            riwayah = normalize_riwayah(source_riwayah)
            row["riwayah_source_value"] = source_riwayah
            row["riwayah"] = riwayah
            row["comparison_scope"] = "hafs_legal" if riwayah == "hafs_an_asim" else "diagnostic_against_hafs_only"
            row.update({"publication_status": "needs_review", "published": False, "audio_mode_allowed": None, "follow_up": "D4 offset audit; failures realign in D5 on served audio"})
            for chapter in row.get("chapters", []):
                chapter["complete_against_hafs"] = riwayah == "hafs_an_asim" and chapter["available_ayahs"] == chapter["expected_ayahs"] and chapter["word_timed_ayahs"] == chapter["expected_ayahs"]
        summaries.append({"config": "mushafs", "status": "metadata_only", "rows": len(mushafs), "schema": "recitation metadata; no ayah/recited text columns"})
        result["configs"] = summaries
        (root / "summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"configs": len(summaries), "mushafs_rows": len(mushafs)}))
        return
    if args.finalize_cache:
        summaries = []
        for summary_file in sorted(root.glob("*.summary.json")):
            prior = json.loads(summary_file.read_text(encoding="utf-8"))
            config = prior["config"]
            recited_file = root / f"{config}.recited.jsonl"
            if recited_file.exists():
                rows = []
                chapter_seen = {}
                chapter_timed = {}
                with recited_file.open(encoding="utf-8") as source:
                    raw = [json.loads(line) for line in source]
                temp_recited = recited_file.with_suffix(".jsonl.tmp")
                with temp_recited.open("w", encoding="utf-8") as output:
                    for row in raw:
                        surah, ayah, text, timestamps = row["surah"], row["ayah"], row["recited_text"], row["word_timestamps"]
                        rows.append((surah, ayah, text, timestamps))
                        canonical = legal.get(f"{surah}:{ayah}")
                        result = diff_words(canonical["words"], text.split()) if canonical else {"status": "needs_review", "mapping": []}
                        chapter_seen.setdefault(surah, set()).add(ayah)
                        if canonical:
                            indexes = {int(word[0]) for word in (timestamps or []) if word and int(word[0]) > 0}
                            valid = all(len(word) >= 3 and word[1] >= 0 and word[2] > word[1] for word in (timestamps or []))
                            if valid and result["status"] == "mapped" and indexes == set(range(1, len(canonical["words"]) + 1)):
                                chapter_timed.setdefault(surah, set()).add(ayah)
                        row.update(result)
                        output.write(json.dumps(row, ensure_ascii=False) + "\n")
                temp_recited.replace(recited_file)
                summary = audit_config(config, rows, legal)
                summary["in_pinned_release"] = config in released
                source_riwayah = released.get(config, metadata.get(config, {})).get("riwayah", "metadata_unavailable")
                riwayah = normalize_riwayah(source_riwayah)
                summary["riwayah_source_value"] = source_riwayah
                summary["riwayah"] = riwayah
                summary["comparison_scope"] = "hafs_legal" if riwayah == "hafs_an_asim" else "diagnostic_against_hafs_only"
                summary["chapters"] = [{"surah": int(number), "expected_ayahs": info["num_verses"], "available_ayahs": len(chapter_seen.get(int(number), set())), "word_timed_ayahs": len(chapter_timed.get(int(number), set())), "complete_against_hafs": riwayah == "hafs_an_asim" and len(chapter_seen.get(int(number), set())) == info["num_verses"] and len(chapter_timed.get(int(number), set())) == info["num_verses"]} for number, info in corpus["surahs"].items()]
                summary["canonical_checksum"] = corpus["checksum"]
                summary["qud_version"] = corpus["version"]
            else:
                summary = prior
            summary_file.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
            summaries.append(summary)
        summaries.append({"config": "mushafs", "status": "metadata_only", "rows": len(mushafs), "schema": "recitation metadata; no ayah/recited text columns"})
        (root / "summary.json").write_text(json.dumps({"qud_version": corpus["version"], "canonical_checksum": corpus["checksum"], "configs": summaries}, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"finalized_configs": len(summaries)}))
        return
    parquet = fetch_json(f"https://datasets-server.huggingface.co/parquet?dataset={DATASET}")
    files = {}
    for file in parquet["parquet_files"]:
        if file["split"] == "train":
            files.setdefault(file["config"], []).append(file["url"])
    connection = duckdb.connect()
    connection.execute("INSTALL httpfs")
    connection.execute("LOAD httpfs")
    connection.execute("SET enable_progress_bar=false")
    connection.execute("SET threads=4")
    connection.execute("SET http_timeout=120000")
    summaries = []
    for config, urls in sorted(files.items()):
        summary_file = root / f"{config}.summary.json"
        if summary_file.exists():
            summaries.append(json.loads(summary_file.read_text(encoding="utf-8")))
            continue
        try:
            rows = connection.execute(
                "SELECT surah,ayah,text_uthmani,word_timestamps FROM read_parquet(?) ORDER BY surah,ayah", [urls]
            ).fetchall()
            summary = audit_config(config, rows, legal)
            summary["in_pinned_release"] = config in released
            summary["riwayah"] = released.get(config, {}).get("riwayah", "not_in_release_metadata")
            # Recited text is isolated from legal corpus. No signed audio URLs.
            with (root / f"{config}.recited.jsonl").open("w", encoding="utf-8") as output:
                for surah, ayah, text, timestamps in rows:
                    canonical = legal.get(f"{surah}:{ayah}")
                    mapping = diff_words(canonical["words"], text.split()) if canonical else {"status": "needs_review", "mapping": []}
                    output.write(json.dumps({"surah": surah, "ayah": ayah, "recited_text": text, "word_timestamps": timestamps, **mapping}, ensure_ascii=False) + "\n")
        except Exception as error:
            summary = {"config": config, "status": "unavailable", "error": type(error).__name__ + ": " + str(error).splitlines()[0][:240], "in_pinned_release": config in released}
        summary_file.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        summaries.append(summary)
        print(json.dumps({key: summary.get(key) for key in ["config", "rows", "basmala_mode", "repeated_ayahs", "needs_review", "status"]}), flush=True)
        (root / "summary.json").write_text(json.dumps({"qud_version": corpus["version"], "canonical_checksum": corpus["checksum"], "configs": summaries}, ensure_ascii=False, indent=2), encoding="utf-8")
    (root / "summary.json").write_text(json.dumps({"qud_version": corpus["version"], "canonical_checksum": corpus["checksum"], "configs": summaries}, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
