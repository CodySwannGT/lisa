/* This file is managed by Lisa and IS replaced on each `lisa` run.
 * Do not edit directly — durable changes belong upstream in Lisa. */
/* The fixed nonroot PID1 retains deadline/verdict authority across child exec. */
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

static volatile sig_atomic_t interrupted = 0;

static void interruption(int signal_number) {
  interrupted = signal_number;
}

static long long milliseconds(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) return -1;
  return (long long)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

static void pause_briefly(void) {
  const struct timespec delay = {0, 20000000};
  (void)nanosleep(&delay, NULL);
}

static int deadline_argument(const char *value) {
  if (!value || !*value) return -1;
  for (const char *p = value; *p; ++p) {
    if (*p < '0' || *p > '9') return -1;
  }
  errno = 0;
  char *end = NULL;
  long result = strtol(value, &end, 10);
  if (errno || !end || *end || result < 1 || result > 1800000) return -1;
  return (int)result;
}

/* Namespace-wide signals are used only after main has established actual PID1. */
static int cleanup_children(void) {
  long long started = milliseconds();
  if (started < 0 || (kill(-1, SIGTERM) != 0 && errno != ESRCH)) return -1;
  int killed = 0;
  for (;;) {
    int status;
    pid_t reaped;
    do { reaped = waitpid(-1, &status, WNOHANG); } while (reaped > 0);
    if (reaped < 0 && errno == ECHILD) return 0;
    if (reaped < 0 && errno != EINTR) return -1;
    long long now = milliseconds();
    if (now < 0 || now - started >= 4000) return -1;
    if (!killed && now - started >= 2000) {
      if (kill(-1, SIGKILL) != 0 && errno != ESRCH) return -1;
      killed = 1;
    }
    pause_briefly();
  }
}

/* Only a real waitpid result can be the original command's successful verdict. */
static int await_command(pid_t child, int duration) {
  long long started = milliseconds();
  if (started < 0) return 125;
  for (;;) {
    int status = 0;
    pid_t result = waitpid(child, &status, WNOHANG);
    if (interrupted) return 128 + interrupted;
    if (result == child) {
      if (WIFEXITED(status)) return WEXITSTATUS(status);
      if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
      return 125;
    }
    if (result < 0 && errno != EINTR) return 125;
    long long now = milliseconds();
    if (now < 0) return 125;
    if (now - started >= duration) return 124;
    pause_briefly();
  }
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "--version") == 0) {
    puts("lisa-npm-supervisor 1");
    return 0;
  }
  int duration = argc >= 4 ? deadline_argument(argv[1]) : -1;
  if (duration < 0 || strcmp(argv[2], "--") != 0 || argv[3][0] != '/' ||
      getpid() != 1 || getuid() == 0 || getgid() == 0) {
    fputs("lisa supervisor: invalid nonroot PID1 invocation\n", stderr);
    return 125;
  }
  if (prctl(PR_SET_DUMPABLE, 0) != 0 || prctl(PR_GET_DUMPABLE) != 0) {
    fputs("lisa supervisor: dumpability protection unavailable\n", stderr);
    return 125;
  }
  struct sigaction action;
  memset(&action, 0, sizeof action);
  action.sa_handler = interruption;
  if (sigemptyset(&action.sa_mask) != 0 || sigaction(SIGTERM, &action, NULL) != 0 ||
      sigaction(SIGINT, &action, NULL) != 0 || sigaction(SIGHUP, &action, NULL) != 0) return 125;
  fprintf(stderr, "lisa supervisor: pid=1 uid=%lu gid=%lu dumpable=0\n",
          (unsigned long)getuid(), (unsigned long)getgid());
  if (fflush(stderr) != 0) return 125;
  pid_t child = fork();
  if (child < 0) return 125;
  if (child == 0) {
    if (setpgid(0, 0) != 0) _exit(125);
    execv(argv[3], argv + 3);
    _exit(errno == ENOENT ? 127 : 126);
  }
  int result = await_command(child, duration);
  if (cleanup_children() != 0) return 125;
  if (interrupted) return 128 + interrupted;
  return result;
}
