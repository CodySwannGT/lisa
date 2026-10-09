"""Independent native-event parser; missing boundaries fail qualification."""
import re
from decimal import Decimal

LINE = re.compile(r'^\s*(\d+)\s+(\d+\.\d+)\s+(.*)$')
DURATION = re.compile(r'<([0-9]+\.[0-9]+)>\s*$')
CALL = re.compile(r'([a-zA-Z_][a-zA-Z_0-9]*)\(')
GUARD = re.compile(r'execve\([^,]+, \["(?:bash|/bin/bash)", "([^"]*/scripts/lisa-hooks/([^/]+\.sh))"')

def parse_trace(path):
    events, pending = [], {}
    for number, line in enumerate(path.read_text().splitlines(), 1):
        match = LINE.match(line)
        if not match:
            continue
        pid, stamp, body = int(match[1]), Decimal(match[2]), match[3]
        resumed = re.match(r'<\.\.\. (\w+) resumed>(.*)', body)
        if resumed:
            previous = pending.pop((pid, resumed[1]), None)
            if previous is None:
                raise ValueError(f'{path}:{number}: unmatched resumed syscall')
            body = previous['body'].replace('<unfinished ...>', '') + resumed[2]
            stamp, origin = previous['start'], previous['line']
        else:
            origin = number
        name, duration = CALL.match(body), DURATION.search(body)
        name = name[1] if name else None
        event = {'pid': pid, 'start': stamp, 'end': stamp + (Decimal(duration[1]) if duration else 0), 'body': body, 'name': name, 'line': origin, 'return_line': number, 'complete': '<unfinished ...>' not in body}
        if event['complete']:
            events.append(event)
        else:
            pending[(pid, name)] = event
    # Self-killing syscalls need not return; their real entries remain evidence.
    events.extend(pending.values())
    return sorted(events, key=lambda event: (event['start'], event['line']))

def evaluate(path, observation, expected_expiry):
    events = parse_trace(path)
    kills = [event for event in events if re.match(r'kill\(-' + str(event['pid']) + r',\s*SIGKILL\b', event['body'])]
    if len(kills) != 1:
        raise ValueError(f'{path}: expected one native self-group kill, found {len(kills)}')
    kill, anchor = kills[0], kills[0]['pid']
    waits = [event for event in events if event['pid'] == anchor and event['name'] in ['pselect6', 'select', 'poll', 'ppoll'] and re.search(r'(?:\[|[ ,])9(?:[<,\]])', event['body']) and event['start'] < kill['start']]
    expiry = [event for event in waits if re.search(r'= 0(?:\s|$)', event['body']) and 'Timeout' in event['body']]
    signals = [event for event in events if event['pid'] == anchor and event['body'].startswith('--- SIGALRM') and event['start'] < kill['start']]
    arms = [event for event in events if event['pid'] == anchor and event['name'] in ['alarm', 'setitimer'] and event['start'] < kill['start'] and not re.search(r'(?:alarm\(0\)|it_value=\{tv_sec=0, tv_usec=0\})', event['body'])]
    fd9_reads = [event for event in events if event['pid'] == anchor and re.match(r'read\(9(?:<|,)', event['body'])]
    if waits:
        beginning = waits[0]
        if expected_expiry and not expiry:
            raise ValueError(f'{path}: fd9 native expiry return missing')
        boundary = expiry[-1] if expected_expiry else waits[-1]
    elif arms and signals and any(arms[-1]['start'] <= event['start'] <= signals[-1]['start'] for event in fd9_reads):
        beginning, boundary = arms[-1], signals[-1]
    else:
        raise ValueError(f'{path}: actual timer arming/expiry boundary unavailable')
    reaps = [event for event in events if event['name'] in ['wait4', 'waitid'] and event['end'] >= kill['start'] and re.search(r'= ' + str(anchor) + r'(?:\s|$)', event['body']) and 'SIGKILL' in event['body']]
    if not reaps:
        raise ValueError(f'{path}: native parent reaping of anchor {anchor} missing')
    guards = [(event, GUARD.search(event['body'])) for event in events if event['name'] == 'execve' and GUARD.search(event['body']) and '= 0' in event['body']]
    if not guards:
        raise ValueError(f'{path}: first genuine guard execve unavailable')
    first_guard = guards[0][0]
    # Include the birth-observed anchor subtree even if a child changed groups.
    # Ordinary guard descendants are a different boundary and remain excluded.
    diagnostic_pids = {anchor}
    for _ in range(len(observation['owned_births']) + 1):
        descendants = {identity['pid'] for identity in observation['owned_births'] if identity['parent'] in diagnostic_pids}
        if descendants.issubset(diagnostic_pids):
            break
        diagnostic_pids.update(descendants)
    births = [identity for identity in observation['owned_births'] if identity['pid'] in diagnostic_pids]
    if not births:
        raise ValueError(f'{path}: positive native anchor-group birth identity missing')
    absent = None
    for snapshot in observation['snapshots']:
        stamp = Decimal(str(snapshot['wall_ns'])) / 1_000_000_000
        if stamp < kill['start']:
            continue
        if all(not any(row['pid'] == birth['pid'] and row['birth'] == birth['birth'] and row['group'] == birth['group'] for row in snapshot['rows']) for birth in births):
            absent = stamp
            break
    if absent is None:
        raise ValueError(f'{path}: group disappearance including zombies not observed')
    offset_range = Decimal(max(observation['clock_offsets_ns']) - min(observation['clock_offsets_ns'])) / 1_000_000_000
    uncertainty = offset_range + Decimal('0.000002')
    producer = boundary['end'] - beginning['start'] + uncertainty
    cleanup = max(reaps[0]['end'], first_guard['start'], absent) - boundary['end'] + uncertainty
    failures = []
    if offset_range > Decimal('0.001'):
        failures.append('clock-domain-observation-uncertain')
    if producer > 2 or producer < 0:
        failures.append('producer-expiry-over-two-seconds')
    if cleanup > 1 or cleanup < 0:
        failures.append('expiry-to-reaping-and-guard-over-one-second')
    return {'anchor_pid': anchor, 'timer_start_line': beginning['line'], 'expiry_line': boundary['return_line'], 'self_kill_line': kill['line'], 'parent_reap_line': reaps[0]['return_line'], 'first_guard_line': first_guard['line'], 'guard_order': [match[2] for event, match in guards], 'producer_upper_seconds': str(producer), 'cleanup_upper_seconds': str(cleanup), 'clock_offset_range_seconds': str(offset_range), 'timestamp_uncertainty_seconds': str(uncertainty), 'group_births': births, 'failures': failures, 'clock_scope': 'strace -ttt wall timestamps and native syscall durations, checked against sampled wall-minus-monotonic offsets; no universal clock/scheduling guarantee'}
