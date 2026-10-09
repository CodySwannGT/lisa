"""Owned Linux CLI trace. No production byte edits or extra process streams."""
from pathlib import Path
import os, json, hashlib, tempfile, shutil, subprocess, threading, time
from evaluate import evaluate

SOURCE, OUT = Path('/source'), Path('/out')
manifest = json.loads((OUT / 'manifest.json').read_text())
GUARDS = ['block-no-verify', 'parity-safety-net', 'block-shell-json-parsing', 'block-instruction-file-edits', 'block-direct-issue-create', 'block-managed-file-edits', 'block-blind-automerge', 'worktree-binding-guard']
TRACE = ['strace', '-f', '-ttt', '-T', '-yy', '-s', '256', '-e', 'trace=%process,%signal,%desc,setitimer', '-e', 'signal=SIGALRM,SIGCHLD,SIGKILL']

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def versions():
    result = {}
    commands = {'node': ['node', '--version'], 'bun': ['bun', '--version'], 'bash': ['/bin/bash', '--version'], 'strace': ['strace', '--version'], 'python': ['python3', '--version'], 'jq': ['jq', '--version'], 'git': ['git', '--version'], 'kernel': ['uname', '-a']}
    for key, command in commands.items():
        result[key] = subprocess.run(command, capture_output=True, text=True, timeout=5, check=True).stdout.splitlines()[0]
    if result['node'] != 'v22.23.3' or result['bun'] != '1.3.8':
        raise ValueError('unqualified native runtime pins')
    result['tmp_mount'] = next(line for line in Path('/proc/mounts').read_text().splitlines() if line.split()[1] == '/tmp')
    if 'noexec' in result['tmp_mount'].split()[3].split(','):
        raise ValueError('owned private tmp mount must execute the diagnostic shim')
    return result

def scan():
    rows = []
    for path in Path('/proc').iterdir():
        if not path.name.isdecimal():
            continue
        try:
            text = (path / 'stat').read_text()
            fields = text[text.rfind(')') + 2:].split()
            rows.append({'pid': int(path.name), 'parent': int(fields[1]), 'group': int(fields[2]), 'birth': fields[19], 'state': fields[0]})
        except (FileNotFoundError, ProcessLookupError):
            pass
    return rows

def prepare(mode, control=None):
    root = Path(tempfile.mkdtemp(prefix='l4407.', dir='/tmp'))
    root.chmod(0o700)
    app = root / 'app'
    host = app / 'scripts/lisa-hooks'
    templates = app / 'node_modules/@codyswann/lisa/all/copy-overwrite/scripts/lisa-hooks'
    host.mkdir(parents=True)
    templates.mkdir(parents=True)
    (app / '.lisa').mkdir()
    for path in (SOURCE / 'plugins/lisa/hooks').iterdir():
        if path.suffix in ['.sh', '.bash', '.mjs', '.py']:
            shutil.copyfile(path, host / path.name)
            shutil.copyfile(path, templates / path.name)
    (app / 'node_modules/@codyswann/lisa/package.json').write_text(json.dumps({'name': '@codyswann/lisa', 'version': '4.72.7'}))
    (app / '.lisa/apply-receipt.json').write_text(json.dumps({'schema_version': 1, 'lisa_version': '4.33.1', 'applied_at': '2026-08-01T00:00:00.000Z', 'harness': 'fleet', 'apply_mode': 'full', 'stale_paths': []}))
    for name in ['lisa-enforcement-fallback.sh', 'lisa-enforcement-freshness.mjs']:
        shutil.copyfile(SOURCE / 'scripts' / name, root / name)
    entries = root / 'entries'
    entries.write_text('')
    (root / 'guards').write_text('')
    (root / 'foreign-sentinel').write_text('preserve-owned-control\n')
    binpath = root / 'bin'
    binpath.mkdir()
    # Only the diagnostic executable boundary is injected; real guards use Node.
    shim = '''#!/bin/bash
case "$1" in *lisa-enforcement-freshness.mjs) ;; *) exec /usr/local/bin/node "$@" ;; esac
printf '%s\\n' "$$" >> "$LISA_DEADLINE_ENTRIES"
case "$LISA_DEADLINE_MODE" in
 normal) exec /usr/local/bin/node "$@" ;;
 stall|post-start-ps-failure) printf 'installed\\t9.9.9\\nguard0\\tmatching\\n'; trap '' TERM; /bin/sleep 30 & printf '%s\\n' "$!" >> "$LISA_DEADLINE_ENTRIES"; wait ;;
esac
'''
    (binpath / 'node').write_text(shim)
    (binpath / 'node').chmod(0o700)
    if not os.access(binpath / 'node', os.X_OK):
        raise ValueError('owned diagnostic shim is not executable on the actual scratch mount')
    payload = root / 'payload.json'
    payload.write_text(json.dumps({'session_id': 'native-deadline', 'tool_name': 'Bash', 'tool_input': {'command': 'git commit --no-verify -m x'}}))
    startup = root / 'startup.bash'
    startup.write_text('''trap 'case "${BASH_SOURCE[0]}" in */scripts/lisa-hooks/*.sh) printf "%s\\n" "${BASH_SOURCE[0]##*/}" >> "$LISA_DEADLINE_GUARDS"; trap - DEBUG ;; esac' DEBUG
''' + ('ps() { if [ -s "$LISA_DEADLINE_ENTRIES" ]; then return 127; fi; command ps "$@"; }; export -f ps\n' if mode == 'post-start-ps-failure' else ''))
    subject = root / 'lisa-enforcement-fallback.sh'
    if control:
        # Standalone detector qualification. Never mutate copied production code.
        os.mkfifo(root / 'control-done', 0o600)
        subject = root / 'owned-over-budget-control.sh'
        subject.write_text('''#!/bin/bash
exec 9<>"$LISA_CONTROL_FIFO"
set -m
/bin/bash -c '
 /bin/sleep 30 &
 printf "%s\\n" "$$" "$!" >> "$LISA_DEADLINE_ENTRIES"
 if read -r -t "$1" -u 9 done; then :; fi
 /bin/sleep "$2"
 kill -KILL -- -"$$"
' owned-timing-control "$LISA_CONTROL_TIMER" "$LISA_CONTROL_DELAY" &
anchor=$!
wait "$anchor" || true
/bin/bash "$CLAUDE_PROJECT_DIR/scripts/lisa-hooks/block-no-verify.sh" < "$LISA_CONTROL_PAYLOAD"
''')
    env = {**os.environ, 'PATH': str(binpath) + ':' + os.environ['PATH'], 'TMPDIR': str(root), 'CLAUDE_PROJECT_DIR': str(app), 'CLAUDE_CONFIG_DIR': str(root / 'config'), 'BASH_ENV': str(startup), 'LISA_DEADLINE_ENTRIES': str(entries), 'LISA_DEADLINE_GUARDS': str(root / 'guards'), 'LISA_DEADLINE_MODE': mode, 'LISA_CONTROL_FIFO': str(root / 'control-done'), 'LISA_CONTROL_TIMER': str(control[0]) if control else '', 'LISA_CONTROL_DELAY': str(control[1]) if control else '', 'LISA_CONTROL_PAYLOAD': str(payload)}
    statefiles = [app / '.lisa/apply-receipt.json', *[host / (name + '.sh') for name in GUARDS]]
    return root, app, subject, payload, env, statefiles

def drive(mode, traced, control=None):
    label = (control[2] if control else mode) + ('-traced' if traced else '-direct')
    case = OUT / label
    case.mkdir()
    root, app, subject, payload, env, statefiles = prepare(mode, control)
    before = [digest(path) for path in statefiles]
    trace = case / 'native.strace'
    command = [*(TRACE + ['-o', str(trace)] if traced else []), '/bin/bash', str(subject)]
    snapshots, offsets, births, observer_errors = [], [], {}, []
    stop = threading.Event()
    with payload.open('rb') as stdin, (case / 'stdout.log').open('wb') as stdout, (case / 'stderr.log').open('wb') as stderr:
        started = time.monotonic_ns()
        child = subprocess.Popen(command, cwd=app, env=env, stdin=stdin, stdout=stdout, stderr=stderr)
        def observe():
            try:
                while not stop.is_set():
                    rows = scan()
                    wall, mono = time.time_ns(), time.monotonic_ns()
                    offsets.append(wall - mono)
                    if child.pid not in births:
                        initial = next((row for row in rows if row['pid'] == child.pid and row['parent'] == os.getpid()), None)
                        if initial:
                            births[child.pid] = initial
                    parents = {row['pid'] for row in rows if row['pid'] in births and births[row['pid']]['birth'] == row['birth'] and births[row['pid']]['group'] == row['group']}
                    for _ in range(len(rows) + 1):
                        found = [row for row in rows if row['parent'] in parents and row['pid'] not in parents]
                        if not found:
                            break
                        for row in found:
                            births[row['pid']] = row
                            parents.add(row['pid'])
                    snapshots.append({'wall_ns': wall, 'mono_ns': mono, 'rows': rows})
                    if trace.exists() and trace.stat().st_size > 64 * 1024 * 1024:
                        raise ValueError('native trace capture exceeds64MiB')
                    stop.wait(0.005)
            except Exception as error:
                observer_errors.append(str(error))
                stop.set()
                child.terminate()  # Only this freshly created child handle.
        observer = threading.Thread(target=observe, daemon=True)
        observer.start()
        try:
            status = child.wait(timeout=15)
        finally:
            stop.set()
            observer.join(timeout=2)
        elapsed = (time.monotonic_ns() - started) / 1_000_000
    if observer.is_alive() or observer_errors:
        raise ValueError('native observer failed: ' + str(observer_errors))
    finalrows = scan()
    wall, mono = time.time_ns(), time.monotonic_ns()
    offsets.append(wall - mono)
    snapshots.append({'wall_ns': wall, 'mono_ns': mono, 'rows': finalrows})
    entries = [int(value) for value in (root / 'entries').read_text().splitlines() if value]
    survivors = [row for row in finalrows if row['pid'] in births and births[row['pid']]['birth'] == row['birth'] and births[row['pid']]['group'] == row['group']]
    leaves = [{'name': path.name, 'device': path.lstat().st_dev, 'inode': path.lstat().st_ino, 'mode': path.lstat().st_mode & 0o777, 'entries': [entry.name for entry in path.iterdir()] if path.is_dir() and not path.is_symlink() else None} for path in root.glob('lisa-freshness.*')]
    capture = {'kind': 'owned-evaluator-control' if control else 'actual-native-cli', 'mode': mode, 'traced': traced, 'status': status, 'command': command, 'elapsed_ms': elapsed, 'source_sha256': {name: digest(SOURCE / name) for name in manifest['source_sha256']}, 'subject_sha256': digest(subject), 'state_before': before, 'state_after': [digest(path) for path in statefiles], 'helper_pids': entries, 'unobserved_helper_pids': [pid for pid in entries if pid not in births], 'owned_births': list(births.values()), 'surviving_births_including_zombies': survivors, 'diagnostic_leaves_before_sweep': leaves, 'foreign_sentinel_unchanged': (root / 'foreign-sentinel').read_text() == 'preserve-owned-control\n', 'snapshots': snapshots, 'clock_offsets_ns': offsets, 'max_sample_gap_ms': max((right['mono_ns'] - left['mono_ns']) / 1_000_000 for left, right in zip(snapshots, snapshots[1:])) if len(snapshots) > 1 else None, 'scratch': str(root), 'stdout_sha256': digest(case / 'stdout.log'), 'stderr_sha256': digest(case / 'stderr.log')}
    capture['guard_markers'] = (root / 'guards').read_text().splitlines()
    # Raw observations survive decoder/evaluator failure.
    (case / 'observation.json').write_text(json.dumps(capture, indent=2) + '\n')
    if traced:
        result = evaluate(trace, capture, mode != 'normal' or bool(control))
        (case / 'timing.json').write_text(json.dumps(result, indent=2) + '\n')
        capture['timing'] = result
    if not control:
        output = (case / 'stdout.log').read_text() + (case / 'stderr.log').read_text()
        failures = []
        if status != 2:
            failures.append('actual-refusal-exit')
        if 'Blocked: this command bypasses pre-commit/pre-push hooks' not in output or 'jq not found' in output:
            failures.append('actual-original-block-no-verify-refusal')
        if capture['guard_markers'] != [name + '.sh' for name in GUARDS]:
            failures.append('eight-real-guard-markers-in-order')
        if not entries:
            failures.append('actual-helper-entry')
        if mode != 'normal' and capture['unobserved_helper_pids']:
            failures.append('long-lived-helper-birth-not-observed')
        if survivors or leaves or 'unbound variable' in output:
            failures.append('owned-source-cleanup')
        if before != capture['state_after'] or not capture['foreign_sentinel_unchanged']:
            failures.append('unchanged-owned-state')
        if mode == 'normal' and not all(value in output for value in ['matches installed template', '4.72.7', '4.33.1']):
            failures.append('normal-complete-facts')
        if mode != 'normal' and ('9.9.9' in output or 'host content unknown' not in output):
            failures.append('incomplete-remains-unknown')
        if traced and capture['timing']['guard_order'] != [name + '.sh' for name in GUARDS]:
            failures.append('eight-real-guard-exec-order')
        if traced:
            failures += capture['timing']['failures']
        capture['failures'] = failures
    shutil.rmtree(root)
    return capture

qualification = versions()
for name, expected in manifest['source_sha256'].items():
    if digest(SOURCE / name) != expected:
        raise ValueError('exact mounted source identity changed: ' + name)
(OUT / 'tools.json').write_text(json.dumps(qualification, indent=2) + '\n')
controls = [drive('stall', True, (3, 0, 'producer-control')), drive('stall', True, (1, 1.2, 'cleanup-control'))]
if 'producer-expiry-over-two-seconds' not in controls[0]['timing']['failures']:
    raise ValueError('producer evaluator did not bite on actual native3s control')
if 'expiry-to-reaping-and-guard-over-one-second' not in controls[1]['timing']['failures']:
    raise ValueError('cleanup evaluator did not bite on actual native1.2s cleanup control')
observations = []
for mode in ['normal', 'stall', 'post-start-ps-failure']:
    traced, direct = drive(mode, True), drive(mode, False)
    observations.append({'mode': mode, 'traced': traced, 'direct': direct, 'tracer_overhead_elapsed_ms': traced['elapsed_ms'] - direct['elapsed_ms']})
failures = [(observation['mode'], kind, failure) for observation in observations for kind in ['traced', 'direct'] for failure in observation[kind]['failures']]
result = {'kind': 'independent-native-linux-timing', 'manifest': manifest, 'tools': qualification, 'controls': controls, 'observations': observations, 'failures': failures, 'not_established': ['Paired fresh-case elapsed difference includes scheduling variance, so it is not solely ptrace overhead.', 'Wall/monotonic calibration is sampled, not universal no-clock-jump proof.', 'Birth census may miss descendants shorter than its actual reported maximum sampling gap; declared long-lived helper coverage is explicitly checked.', 'Hosted Linux15-case regression and exact genuinely published-package replay remain separate obligations.']}
(OUT / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'native_cases': 3, 'paired_direct_calls': 3, 'controls': 2, 'failures': failures, 'head': manifest['head']}))
raise SystemExit(1 if failures else 0)
