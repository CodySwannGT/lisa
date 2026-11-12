"""Execute a frozen actual workflow step in an already clean Ubuntu runner.

The only replacement dependency is the expressly requested negative curl fault.
All positive commands, apt, signatures, binaries and loopback traffic are real.
"""
import sys, pathlib, os, json, hashlib, subprocess, datetime, time, urllib.request
from execution import run_capture
from keyring import capture_keyring, require_secure_keyring

inherited_umask = os.umask(0o077)
root = pathlib.Path(sys.argv[1]).resolve()
freeze = json.loads((root / 'freeze.json').read_text())
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
assert sha(root / 'workflow.yml') == freeze['workflowSha256']
assert sha(root / 'setup.sh') == freeze['renderedStepSha256']
for item in freeze['files']: assert sha(root / 'harness' / item['name']) == item['sha256']
assert os.uname().machine == 'x86_64', 'Supported hosted amd64 runner required'
release = dict(line.rstrip().split('=', 1) for line in pathlib.Path('/etc/os-release').read_text().splitlines() if '=' in line)
assert release['ID'].strip('"') == 'ubuntu'
assert not subprocess.run(['sh', '-c', 'command -v k6'], stdout=subprocess.DEVNULL).returncode == 0, 'Preinstalled k6 is invalid'
assert not pathlib.Path('/usr/share/keyrings/k6-archive-keyring.gpg').exists()
assert not pathlib.Path('/etc/apt/sources.list.d/k6.list').exists()
assert subprocess.run(['dpkg-query', '-W', '-f=${Status}', 'k6'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0
assert not os.environ.get('BASH_ENV') and not os.environ.get('ENV'), 'Shell startup override invalidates qualification'
assert 'pipefail' not in os.environ.get('SHELLOPTS', '').split(':'), 'Harness must not supply pipeline failure semantics'

commands = []
def run(name, args, env=None, timeout=240):
    result = run_capture(root, name, args, env, timeout, inherited_umask)
    commands.append(result)
    (root / 'commands.json').write_text(json.dumps(commands, indent=2))
    return result['exitCode']

environment = {'osRelease': release, 'architecture': os.uname().machine,
               'runnerImageOS': os.environ.get('ImageOS'), 'runnerImageVersion': os.environ.get('ImageVersion'),
               'sourceSha': freeze['sourceSha'], 'cleanAbsenceVerified': True,
               'installerUmask': format(inherited_umask, '04o'), 'captureUmask': '0077',
               'shellStartupOverridesAbsent': True, 'harnessSuppliedPipefail': False}
(root / 'environment.json').write_text(json.dumps(environment, indent=2))
env = dict(os.environ)
if freeze['control'] == 'negative':
    assert sha(root / 'public-key.gpg') == freeze['publicKeySha256']
    fault = root / 'fault-bin'; fault.mkdir(mode=0o700)
    shim = fault / 'curl'
    shim.write_bytes((root / 'harness/fail-curl.sh').read_bytes()); shim.chmod(0o700)
    env.update(PATH=str(fault) + ':' + env['PATH'], K6_FAULT_DIR=str(root))
exit_code = run('setup', ['bash', '-e', str(root / 'setup.sh')], env)
keyring = pathlib.Path('/usr/share/keyrings/k6-archive-keyring.gpg')
keyring_identity = None
if freeze['control'] != 'explicit':
    keyring_identity = capture_keyring(keyring, root / 'keyring-identity.json', freeze['expected']['keyring'])
if freeze['control'] == 'negative':
    assert exit_code == freeze['expected']['negativeExit'], 'Download failure was hidden'
    assert (root / 'curl-route.txt').read_text() == '-fsSL https://dl.k6.io/key.gpg\n'
    before_write = json.loads((root / 'keyring-before-write.json').read_text())
    require_secure_keyring(before_write, freeze['expected']['keyring'])
    assert before_write['sha256'] == hashlib.sha256(b'').hexdigest(), 'Key bytes preceded the protected-file check'
    assert not pathlib.Path('/etc/apt/sources.list.d/k6.list').exists(), 'Setup continued after failed download'
    assert subprocess.run(['sh', '-c', 'command -v k6'], stdout=subprocess.DEVNULL).returncode != 0
    assert run('accepted-key', ['sudo', 'gpg', '--show-keys', '--with-colons', '/usr/share/keyrings/k6-archive-keyring.gpg']) == 0
    result = {'control': 'negative', 'expectedFailureObserved': True, 'actualSetupExit': exit_code,
              'validKeyAcceptedByGpg': True, 'k6Executed': False, 'environment': environment,
              'keyringIdentity': keyring_identity, 'keyringBeforeWrite': before_write}
else:
    assert exit_code == 0, 'Real installation failed; no substitute is allowed'
    assert run('binary-identity', ['bash', str(root / 'harness/binary-identity.sh'), freeze['control']]) == 0
    assert run('version', ['k6', 'version']) == 0
    if freeze['control'] == 'explicit': assert 'v2.3.0' in (root / 'version.stdout').read_text()
    if freeze['control'] == 'latest':
        logs = (root / 'setup.stdout').read_text() + (root / 'setup.stderr').read_text()
        assert 'https://dl.k6.io/deb' in logs
        assert all(text not in logs for text in ('NO_PUBKEY', 'unsupported filetype', 'not signed', 'Failed to fetch'))
    www = root / 'www'; www.mkdir(); (www / 'health').write_bytes(b'ok\n')
    # Check port availability before launching; readiness checks do not send HTTP requests.
    import socket
    with socket.socket() as probe: probe.bind(('127.0.0.1', 18765))
    with (root / 'server.stdout').open('xb') as out, (root / 'server.stderr').open('xb') as err:
        server = subprocess.Popen(['python3', '-m', 'http.server', '18765', '--bind', '127.0.0.1', '--directory', str(www)], stdout=out, stderr=err)
        try:
            for attempt in range(100):
                if server.poll() is not None: raise RuntimeError('Owned server exited before test')
                try:
                    with socket.create_connection(('127.0.0.1', 18765), timeout=0.1): break
                except OSError: time.sleep(0.05)
            else: raise RuntimeError('Owned server did not start')
            loopback_exit = run('loopback', ['k6', 'run', '--vus', '1', '--iterations', '1', '--summary-export=' + str(root / 'summary.json'), str(root / 'harness/loopback.js')])
        finally:
            server.terminate(); server.wait(timeout=10)
    result = {'control': freeze['control'], 'actualSetupExit': exit_code, 'loopbackExit': loopback_exit,
              'environment': environment, 'ownedServerStopped': True, 'keyringIdentity': keyring_identity}
(root / 'runtime-result.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result))
