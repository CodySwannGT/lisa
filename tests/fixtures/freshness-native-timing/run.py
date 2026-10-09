"""Native Linux timing benchmark through the ordinary Lisa direct adapter."""
from pathlib import Path
import argparse, hashlib, json, os, shutil, subprocess, time, uuid

BASE = 'node@sha256:363e1587494626837fa7f9a23bdb453d13b0ff3c67c705c2805cfc69c2d2fad7'
OWNER_KEY = 'lisa.verification.owner'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--expected-head')
args = parser.parse_args()
source, packet = Path(args.source).resolve(), Path(args.output).resolve()
if not os.environ.get('TMPDIR') or not Path(os.environ['TMPDIR']).is_dir():
    raise ValueError('ordinary lisa-test-run private TMPDIR is required')
if shutil.which('docker') is None:
    raise ValueError('native timing requires the Docker CLI and a reachable daemon')

def completed(command, timeout=10):
    return subprocess.run(command, cwd=source, capture_output=True, text=True, timeout=timeout, check=True)

def clean_head():
    value = completed(['git', 'rev-parse', 'HEAD']).stdout.strip()
    completed(['git', 'diff', '--quiet'])
    completed(['git', 'diff', '--cached', '--quiet'])
    return value

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write(name, value):
    (packet / name).write_text(json.dumps(value, indent=2) + '\n')

head = clean_head()
if args.expected_head and head != args.expected_head:
    raise ValueError('assigned source head does not match the clean checkout')
packet.mkdir(mode=0o700)  # Refuse any existing output, including an old packet.
prepared = packet / 'prepared'
prepared.mkdir(mode=0o700)
for filename in ['Dockerfile', 'run.py', 'run-linux.py', 'evaluate.py']:
    shutil.copyfile(Path(__file__).parent / filename, prepared / filename)
files = [source / 'scripts/lisa-enforcement-fallback.sh', source / 'scripts/lisa-enforcement-freshness.mjs', source / 'all/copy-overwrite/scripts/lisa-enforcement-fallback.sh']
files += [path for path in (source / 'plugins/lisa/hooks').iterdir() if path.suffix in ['.sh', '.bash', '.mjs', '.py']]
identifier = uuid.uuid4().hex
tag = 'lisa-freshness-native-tools:' + identifier
name = 'lisa-freshness-native-proof-' + identifier
image_id = None
manifest = {'head': head, 'source_sha256': {str(path.relative_to(source)): digest(path) for path in files}, 'preparation_sha256': {path.name: digest(path) for path in prepared.iterdir()}, 'base_reference': BASE, 'container_name': name, 'owner_label': OWNER_KEY + '=' + identifier, 'tool_image_tag': tag, 'started_at_epoch_ns': time.time_ns(), 'scope': 'actual source checkout; three traced cases, three direct twins, two native over-budget controls; no published replay claim'}
write('manifest.json', manifest)

def inspect(kind, target):
    reply = subprocess.run(['docker', kind, 'inspect', target], cwd=source, capture_output=True, text=True, timeout=10)
    if reply.returncode:
        if 'No such image' in reply.stderr or 'No such object' in reply.stderr or 'No such container' in reply.stderr:
            return None
        raise ValueError('Docker identity read failed: ' + reply.stderr.strip())
    values = json.loads(reply.stdout)
    if len(values) != 1:
        raise ValueError('Docker identity read is ambiguous')
    return values[0]

def owned_image():
    current = inspect('image', tag)
    if current is None:
        return None
    if (current['Config'].get('Labels') or {}).get(OWNER_KEY) != identifier or (image_id and current['Id'] != image_id):
        raise ValueError('tools image owner or immutable identity changed; no cleanup authority')
    return current

def owned_container():
    current = inspect('container', name)
    if current is None:
        return None
    if (current['Config'].get('Labels') or {}).get(OWNER_KEY) != identifier or not image_id or current['Image'] != image_id:
        raise ValueError('container owner or immutable image identity changed; no cleanup authority')
    return current

status, failure, container_removed, image_removed = 1, None, False, False
try:
    completed(['docker', 'version'])
    with (packet / 'base-pull.log').open('wb') as output:
        subprocess.run(['docker', 'pull', BASE], cwd=source, stdout=output, stderr=subprocess.STDOUT, timeout=120, check=True)
    base = inspect('image', BASE)
    if base is None or BASE not in base.get('RepoDigests', []):
        raise ValueError('official Node base registry digest is not qualified')
    write('base-image-identity.json', base)
    with (packet / 'image-build.log').open('wb') as output:
        subprocess.run(['docker', 'build', '--pull=false', '--label', OWNER_KEY + '=' + identifier, '-t', tag, '-f', str(prepared / 'Dockerfile'), str(prepared)], cwd=source, stdout=output, stderr=subprocess.STDOUT, timeout=300, check=True)
    image = owned_image()
    if image is None:
        raise ValueError('fresh labelled tools image did not materialize')
    image_id = image['Id']
    write('image-identity.json', image)
    if clean_head() != head:
        raise ValueError('source head changed during tools setup')
    command = ['docker', 'run', '--name', name, '--label', OWNER_KEY + '=' + identifier, '--init', '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,exec,mode=1777', '--cap-add', 'SYS_PTRACE', '--security-opt', 'seccomp=unconfined', '--mount', 'type=bind,src=' + str(source) + ',dst=/source,readonly', '--mount', 'type=bind,src=' + str(packet) + ',dst=/out', image_id, 'python3', '/out/prepared/run-linux.py']
    write('launch.json', {'command': command, 'exact_image_id': image_id})
    with (packet / 'wrapper-child.log').open('wb') as output:
        status = subprocess.run(command, cwd=source, stdout=output, stderr=subprocess.STDOUT, timeout=120).returncode
    if status == 0:
        result = json.loads((packet / 'result.json').read_text())
        if len(result['controls']) != 2 or len(result['observations']) != 3 or result['failures']:
            raise ValueError('native source cases or controls are incomplete')
        expected_rejections = ['producer-expiry-over-two-seconds', 'expiry-to-reaping-and-guard-over-one-second']
        if any(control['timing']['failures'] != [boundary] for control, boundary in zip(result['controls'], expected_rejections)):
            raise ValueError('native controls did not reject exactly their named boundaries')
    if clean_head() != head or any(digest(source / path) != expected for path, expected in manifest['source_sha256'].items()):
        raise ValueError('exact source bytes changed during the benchmark')
except Exception as error:
    status, failure = 1, str(error)
finally:
    try:
        container = owned_container()
        if container:
            write('container-terminal.json', container)
            if container['State']['Running']:
                completed(['docker', 'stop', '--time', '3', container['Id']], timeout=15)
            completed(['docker', 'container', 'rm', container['Id']])
        container_removed = True
        image = owned_image()
        if image:
            completed(['docker', 'image', 'rm', image['Id']], timeout=30)
        image_removed = True
    except Exception as error:
        status, failure = 1, (failure + '; ' if failure else '') + 'owned cleanup failed: ' + str(error)
    write('terminal.json', {'head': head, 'exit_code': status, 'failure': failure, 'result_sha256': digest(packet / 'result.json') if (packet / 'result.json').exists() else None, 'tools_image_id': image_id, 'fresh_container_removed': container_removed, 'fresh_tools_image_removed': image_removed, 'completed_at_epoch_ns': time.time_ns()})
print(json.dumps({'head': head, 'exit_code': status, 'failure': failure, 'container_removed': container_removed, 'tools_image_removed': image_removed}))
raise SystemExit(status)
