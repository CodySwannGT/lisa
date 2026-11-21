"""Record the actual scoped apt trust file before judging its permissions."""
import hashlib
import json
import os
import pathlib
import stat
import sys


def keyring_identity(path):
    metadata = path.lstat()
    assert stat.S_ISREG(metadata.st_mode), 'Scoped keyring must be a regular file'
    return {'uid': metadata.st_uid, 'gid': metadata.st_gid,
            'mode': oct(stat.S_IMODE(metadata.st_mode)),
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def require_secure_keyring(identity, expected):
    assert identity['uid'] == expected['uid'] == 0, 'Scoped keyring must be root-owned'
    assert identity['gid'] == expected['gid'] == 0, 'Scoped keyring group must be root'
    assert identity['mode'] == expected['mode'] == '0o644', 'Scoped keyring must be exactly 0644'
    assert int(identity['mode'], 8) & 0o022 == 0, 'Scoped keyring must not permit group/world writes'


def capture_keyring(path, output, expected):
    identity = keyring_identity(path)
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as capture:
        json.dump(identity, capture, indent=2)
    require_secure_keyring(identity, expected)
    return identity


if __name__ == '__main__':
    root = pathlib.Path(sys.argv[1])
    expected = json.loads((root / 'freeze.json').read_text())['expected']['keyring']
    capture_keyring(pathlib.Path('/usr/share/keyrings/k6-archive-keyring.gpg'),
                    root / 'keyring-before-write.json', expected)
