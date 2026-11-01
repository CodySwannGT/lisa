"""Local permission-judge controls; these do not attest Ubuntu root ownership."""
import hashlib
import json
import pathlib
import tempfile
import unittest
from keyring import capture_keyring, keyring_identity, require_secure_keyring


EXPECTED = {'uid': 0, 'gid': 0, 'mode': '0o644'}


class ScopedKeyringPermissions(unittest.TestCase):
    def test_accepts_only_root_owned_exact_0644(self):
        require_secure_keyring(dict(EXPECTED), EXPECTED)

    def test_rejects_observed_hosted_0666(self):
        with self.assertRaisesRegex(AssertionError, 'exactly 0644'):
            require_secure_keyring(dict(EXPECTED, mode='0o666'), EXPECTED)

    def test_rejects_non_root_owner(self):
        with self.assertRaisesRegex(AssertionError, 'root-owned'):
            require_secure_keyring(dict(EXPECTED, uid=1000), EXPECTED)

    def test_rejects_non_root_group(self):
        with self.assertRaisesRegex(AssertionError, 'group must be root'):
            require_secure_keyring(dict(EXPECTED, gid=1000), EXPECTED)

    def test_rejects_other_modes_including_special_bits(self):
        for mode in ('0o664', '0o646', '0o600', '0o444', '0o4644', '0o2644'):
            with self.subTest(mode=mode), self.assertRaises(AssertionError):
                require_secure_keyring(dict(EXPECTED, mode=mode), EXPECTED)

    def test_expected_values_cannot_relax_the_security_boundary(self):
        unsafe = {'uid': 1000, 'gid': 1000, 'mode': '0o666'}
        with self.assertRaises(AssertionError):
            require_secure_keyring(unsafe, unsafe)

    def test_records_actual_stat_and_preserves_rejected_raw_capture(self):
        with tempfile.TemporaryDirectory(prefix='lisa-k6-keyring-') as directory:
            root = pathlib.Path(directory)
            keyring = root / 'keyring.gpg'
            keyring.write_bytes(b'local judge fixture, not a provider key')
            keyring.chmod(0o666)
            output = root / 'identity.json'
            with self.assertRaises(AssertionError):
                capture_keyring(keyring, output, EXPECTED)
            actual = json.loads(output.read_text())
            metadata = keyring.stat()
            self.assertEqual(actual, {'uid': metadata.st_uid, 'gid': metadata.st_gid,
                                     'mode': '0o666',
                                     'sha256': hashlib.sha256(keyring.read_bytes()).hexdigest()})
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)

    def test_rejects_symlink_instead_of_following_it(self):
        with tempfile.TemporaryDirectory(prefix='lisa-k6-keyring-') as directory:
            root = pathlib.Path(directory)
            (root / 'file').write_bytes(b'local fixture')
            (root / 'link').symlink_to(root / 'file')
            with self.assertRaisesRegex(AssertionError, 'regular file'):
                keyring_identity(root / 'link')


if __name__ == '__main__':
    unittest.main(verbosity=2)
