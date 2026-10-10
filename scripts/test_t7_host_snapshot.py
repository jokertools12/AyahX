import unittest
from prepare_t7_host_snapshot import build_host_snapshot


class HostSnapshotTests(unittest.TestCase):
    def fixture(self):
        return {'results': {'recitation': {'samples': [{'original_public_url': 'https://archive.org/001.mp3'}]}}}

    def test_keeps_exact_inventory_plus_only_approved_archive_namespace(self):
        rows = [{'recitationSlug': 'recitation', 'allowedHosts': ['archive.org', '*.us.archive.org', 'ia600123.ca.archive.org']}]
        output = build_host_snapshot(self.fixture(), rows)
        self.assertEqual(output['recitation'], ['*.us.archive.org', 'archive.org', 'ia600123.ca.archive.org'])
        self.assertEqual(output, build_host_snapshot(self.fixture(), list(reversed(rows))))

    def test_cannot_infer_missing_original_host_or_expand_provider_namespace(self):
        for hosts in (['*.archive.org'], ['other.example'], []):
            with self.assertRaises(ValueError):
                build_host_snapshot(self.fixture(), [{'recitationSlug': 'recitation', 'allowedHosts': hosts}])
        with self.assertRaisesRegex(ValueError, 'HOSTS_MISSING'):
            build_host_snapshot(self.fixture(), [])

    def test_duplicate_inventory_rows_are_not_silently_overwritten(self):
        row = {'recitationSlug': 'recitation', 'allowedHosts': ['archive.org']}
        with self.assertRaisesRegex(ValueError, 'DUPLICATE'):
            build_host_snapshot(self.fixture(), [row, row])


if __name__ == '__main__':
    unittest.main()
