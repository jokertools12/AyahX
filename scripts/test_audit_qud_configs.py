import unittest
import pathlib
import importlib.util
import json
spec = importlib.util.spec_from_file_location("audit_qud_configs", pathlib.Path(__file__).with_name("audit-qud-configs.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
diff_words, audit_config = module.diff_words, module.audit_config


class RecitedTextPolicy(unittest.TestCase):
    def indexed_case(self, ayah):
        fixture = pathlib.Path(__file__).resolve().parents[1] / "docs" / "data" / "d1-repetition-cases.json"
        cases = json.loads(fixture.read_text(encoding="utf-8"))
        case = next(row for row in cases if row["ayah"] == ayah)
        self.assertEqual(case["baseline_status"], "needs_review")
        result = diff_words(case["canonical_words"], case["recited_words"], case["word_timestamps"])
        self.assertEqual(result["status"], "mapped")
        self.assertEqual(result["mapping"], case["expected_mapping"])
        self.assertEqual(result["repeated_words"], len(case["recited_words"]) - len(case["canonical_words"]))
        return result

    def test_real_2_22_nested_educational_repetitions(self):
        self.assertEqual(self.indexed_case("2:22")["repeated_words"], 14)

    def test_real_2_31_nested_educational_repetitions(self):
        self.assertEqual(self.indexed_case("2:31")["repeated_words"], 8)

    def test_wrong_source_index_cannot_override_word_diff(self):
        result = diff_words(["الحمد", "لله"], ["الحمد", "غير"], [[1, 0, 1], [2, 1, 2]])
        self.assertEqual(result["status"], "needs_review")

    def test_repeated_phrase_maps_to_same_legal_positions(self):
        result = diff_words(["قال", "أنبئوني", "بأسماء"], ["قال", "أنبئوني", "قال", "أنبئوني", "بأسماء"])
        self.assertEqual(result["status"], "mapped")
        self.assertEqual(result["repeated_words"], 2)
        self.assertEqual(result["mapping"], [1, 2, 1, 2, 3])

    def test_substitutions_and_missing_words_fail_closed(self):
        self.assertEqual(diff_words(["الحمد", "لله"], ["الحمد"])["status"], "needs_review")
        self.assertEqual(diff_words(["الحمد", "لله"], ["الحمد", "غير"])["status"], "needs_review")

    def test_basmala_is_not_fabricated_when_row_is_missing(self):
        report = audit_config("fixture", [(1, 2, "الحمد لله", [[1, 0, 1], [2, 1, 2]])], {"1:2": {"words": ["الحمد", "لله"], "text": "الحمد لله"}})
        self.assertEqual(report["basmala_mode"], "absent")
        self.assertFalse(report["ayah_1_available"])
        self.assertFalse(report["offset_verified"])


if __name__ == "__main__":
    unittest.main()
