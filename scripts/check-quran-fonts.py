"""Check every codepoint of the imported legal corpus against bundled fonts."""
import argparse
import json
import pathlib
from fontTools.ttLib import TTFont


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--fonts", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    corpus = json.loads(pathlib.Path(args.corpus).read_text(encoding="utf-8"))
    # CGJ is an invisible shaping control, not a printable glyph. It stays in
    # canonical text; its absence in cmap is recorded separately, not tofu.
    controls = {0x034F}
    points = set(corpus["codepoints"]) - {ord(" ")} - controls
    reports = []
    for font_path in sorted(pathlib.Path(args.fonts).glob("*.ttf")):
        font = TTFont(font_path)
        cmap = font.getBestCmap()
        missing = [f"U+{point:04X}" for point in sorted(points) if point not in cmap or cmap[point] == ".notdef"]
        reports.append({"font": font_path.name, "checked_visible": len(points), "missing": missing, "nonprinting_without_cmap": [f"U+{point:04X}" for point in sorted(controls & set(corpus["codepoints"])) if point not in cmap], "pass": not missing})
        font.close()
    result = {"canonical_checksum": corpus["checksum"], "codepoints_including_space": len(corpus["codepoints"]), "fonts": reports}
    pathlib.Path(args.out).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
