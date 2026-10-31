"""Private raw captures with the installer's original runner permissions."""
import os
import subprocess
import datetime

def run_capture(root, name, args, env, timeout, child_umask):
    """Do not let the capture policy change the production command's umask."""
    def private_file(suffix):
        fd = os.open(root / (name + suffix), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        return os.fdopen(fd, 'wb')
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with private_file('.stdout') as out, private_file('.stderr') as err:
        try:
            result = subprocess.run(args, cwd=root, env=env, stdout=out, stderr=err,
                                    stdin=subprocess.DEVNULL, timeout=timeout, umask=child_umask)
            code, timed_out = result.returncode, False
        except subprocess.TimeoutExpired:
            code, timed_out = None, True
    return {'name': name, 'argv': args, 'exitCode': code, 'timedOut': timed_out,
            'startedAt': started, 'installerUmask': format(child_umask, '04o')}
