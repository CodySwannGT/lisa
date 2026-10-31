"""Regression for capture umask leaking into the actual installer child."""
import pathlib
import tempfile
import os
import sys
import unittest
from execution import run_capture

class InstallerPermissions(unittest.TestCase):
    def test_child_permissions_are_independent_of_private_capture_policy(self):
        previous = os.umask(0o077)
        try:
            with tempfile.TemporaryDirectory(prefix='lisa-k6-umask-') as directory:
                root = pathlib.Path(directory)
                child = root / 'child.py'
                child.write_text("import pathlib\npathlib.Path('created-by-child').write_text('public key')\n")
                result = run_capture(root, 'actual', [sys.executable, str(child)], None, 10, 0o022)
                self.assertEqual(result['exitCode'], 0)
                self.assertEqual((root / 'created-by-child').stat().st_mode & 0o777, 0o644)
                self.assertEqual((root / 'actual.stdout').stat().st_mode & 0o777, 0o600)
                self.assertEqual((root / 'actual.stderr').stat().st_mode & 0o777, 0o600)
        finally:
            os.umask(previous)

if __name__ == '__main__':
    unittest.main()
