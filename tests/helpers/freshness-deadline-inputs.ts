/**
 * Owned on-disk inputs for reaching the real diagnostic boundary. All guards
 * are copied intact; faults target optional anchor startup or its Node producer.
 * @module tests/helpers/freshness-deadline-inputs
 */
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { scratchRoot } from "./enforcement-fallback-fixtures.js";
import {
  currentHost,
  hostState,
  SOURCE_FALLBACK,
} from "./host-guard-freshness-fixtures.js";

const NODE_SHIM = [
  "#!/bin/bash",
  'case "$1" in *lisa-enforcement-freshness.mjs) ;; *) exec "$LISA_DEADLINE_REAL_NODE" "$@" ;; esac',
  'printf "%s\\n" "$$" >> "$LISA_DEADLINE_ENTRIES"',
  'case "$LISA_DEADLINE_MODE" in',
  ' normal|delayed-qualification|missing-runner|unsafe-tmp|anchor-startup|anchor-qualification) exec "$LISA_DEADLINE_REAL_NODE" "$@" ;;',
  ' stall|post-start-ps-failure) printf "installed\\t9.9.9\\nguard0\\tmatching\\n"; trap "" TERM; /bin/sleep 30 & printf "%s\\n" "$!" >> "$LISA_DEADLINE_ENTRIES"; wait ;;',
  // Keep this child alive for two census periods before successful completion.
  ' surviving-child) /bin/sleep 30 & printf "%s\\n" "$!" >> "$LISA_DEADLINE_ENTRIES"; /bin/sleep 0.2; exec "$LISA_DEADLINE_REAL_NODE" "$@" ;;',
  ' *) printf "installed\\t9.9.9\\n"; for i in 0 1 2 3 4 5 6 7; do printf "guard%s\\tmatching\\n" "$i"; done',
  '    case "$LISA_DEADLINE_MODE" in duplicate) printf "installed\\t9.9.9\\n" ;; malformed) printf "garbage\\n" ;; unknown) printf "extra\\tfact\\n" ;; esac',
  '    [ "$LISA_DEADLINE_MODE" = incomplete ] || printf "complete\\t1\\n"',
  '    [ "$LISA_DEADLINE_MODE" != trailing ] || printf "installed\\t9.9.9\\n"',
  '    [ "$LISA_DEADLINE_MODE" != failed ] ;;',
  "esac",
  "",
].join("\n");

/** Immutable fixture inputs reused by the asynchronous process observer. */
export interface DeadlineFixture {
  readonly root: string;
  readonly scratch: string;
  readonly bin: string;
  readonly subject: string;
  readonly payload: string;
  readonly driver: string;
  readonly startup: string;
  readonly entries: string;
  readonly guards: string;
  readonly phases: string;
  readonly before: readonly string[];
}

/**
 * Confine startup fault injection to the optional diagnostic boundary.
 * @param mode Diagnostic-only fault mode.
 * @returns File-backed startup observation and injection script.
 */
function deadlineStartup(mode: string): string {
  return [
    'trap \'case "${BASH_SOURCE[0]}" in */scripts/lisa-hooks/*.sh) printf "%s\\n" "${BASH_SOURCE[0]##*/}" >> "$LISA_DEADLINE_GUARDS"; trap - DEBUG ;; esac\' DEBUG',
    ...(mode === "anchor-startup"
      ? [
          // BASH_ENV runs before Bash assigns the custom command-string $0.
          'case "${BASH_EXECUTION_STRING-}" in *\'scratch="$1"\'*) printf "anchor-bash-env:%s\\n" "$$" >> "$LISA_DEADLINE_PHASES"; /bin/sleep 30 & printf "anchor-startup-child:%s\\n" "$!" >> "$LISA_DEADLINE_PHASES"; wait ;; esac',
        ]
      : []),
    ...(mode === "anchor-qualification"
      ? [
          // The earlier parent pid census remains intact and is recorded.
          'ps() { if [ "$1" = -o ] && [ "$2" = pid= ]; then printf "parent-preflight:%s\\n" "$$" >> "$LISA_DEADLINE_PHASES"; fi; if [ "$1" = -o ] && [ "$2" = pgid= ]; then printf "anchor-qualification:%s\\n" "$$" >> "$LISA_DEADLINE_PHASES"; /bin/sleep 30 & printf "anchor-qualification-child:%s\\n" "$!" >> "$LISA_DEADLINE_PHASES"; wait; fi; command ps "$@"; }; export -f ps',
        ]
      : []),
    ...(mode === "missing-runner"
      ? ["mkfifo() { return 127; }; export -f mkfifo"]
      : []),
    ...(mode === "delayed-qualification"
      ? [
          'ps() { if [ "$1" = -o ] && [ "$2" = pgid= ]; then /bin/sleep 1.25; fi; command ps "$@"; }; export -f ps',
        ]
      : []),
    ...(mode === "post-start-ps-failure"
      ? [
          'ps() { if [ -s "$LISA_DEADLINE_ENTRIES" ]; then return 127; fi; command ps "$@"; }; export -f ps',
        ]
      : []),
    "",
  ].join("\n");
}

/**
 * Create the same real dispatcher and payload fixture in every test mode.
 * @param mode Optional diagnostic injection only.
 * @param allowed Choose the genuine permitted sibling command.
 * @returns Owned fixture paths and original guard/receipt digests.
 */
export function prepareDeadline(
  mode: string,
  allowed: boolean
): DeadlineFixture {
  const root = currentHost();
  const scratch = scratchRoot();
  const fixture = {
    root,
    scratch,
    bin: path.join(scratch, "bin"),
    subject: path.join(scratch, "lisa-enforcement-fallback.sh"),
    payload: path.join(scratch, "payload.json"),
    driver: path.join(scratch, "driver.sh"),
    startup: path.join(scratch, "observer.bash"),
    entries: path.join(scratch, "entries"),
    guards: path.join(scratch, "guards"),
    phases: path.join(scratch, "phases"),
    before: hostState(root),
  };
  mkdirSync(fixture.bin);
  copyFileSync(SOURCE_FALLBACK, fixture.subject);
  copyFileSync(
    path.join(path.dirname(SOURCE_FALLBACK), "lisa-enforcement-freshness.mjs"),
    path.join(scratch, "lisa-enforcement-freshness.mjs")
  );
  writeFileSync(fixture.entries, "");
  writeFileSync(fixture.guards, "");
  writeFileSync(fixture.phases, "");
  writeFileSync(
    path.join(scratch, "foreign-sentinel"),
    "preserve unrelated fixture state\n"
  );
  if (mode === "unsafe-tmp") chmodSync(scratch, 0o777);
  writeFileSync(
    fixture.payload,
    JSON.stringify({
      session_id: "deadline-control",
      tool_name: "Bash",
      tool_input: { command: allowed ? "pwd" : "git commit --no-verify -m x" },
    })
  );
  writeFileSync(
    fixture.driver,
    'exec /bin/bash "$LISA_DEADLINE_SUBJECT" < "$LISA_DEADLINE_PAYLOAD"\n'
  );
  writeFileSync(fixture.startup, deadlineStartup(mode));
  writeFileSync(path.join(fixture.bin, "node"), NODE_SHIM);
  chmodSync(path.join(fixture.bin, "node"), 0o700);
  return fixture;
}

/**
 * Inherit actual tools while confining every injected input to owned files.
 * @param fixture Prepared private fixture.
 * @param mode Diagnostic-only fault mode.
 * @returns Isolated child environment for the genuine Bash dispatcher.
 */
export function deadlineEnvironment(
  fixture: DeadlineFixture,
  mode: string
): NodeJS.ProcessEnv {
  // eslint-disable-next-line no-restricted-syntax -- subprocess fixtures inherit real tools, not application configuration
  const inherited = process.env;
  return {
    ...inherited,
    PATH: `${fixture.bin}:${inherited.PATH}`,
    CLAUDE_PROJECT_DIR: fixture.root,
    CLAUDE_CONFIG_DIR: path.join(fixture.scratch, "config"),
    TMPDIR: fixture.scratch,
    BASH_ENV: fixture.startup,
    LISA_DEADLINE_SUBJECT: fixture.subject,
    LISA_DEADLINE_PAYLOAD: fixture.payload,
    LISA_DEADLINE_ENTRIES: fixture.entries,
    LISA_DEADLINE_GUARDS: fixture.guards,
    LISA_DEADLINE_PHASES: fixture.phases,
    LISA_DEADLINE_MODE: mode,
    LISA_DEADLINE_REAL_NODE: process.execPath,
  };
}
