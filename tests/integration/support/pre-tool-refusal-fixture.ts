/**
 * Shared fixture for the `PreToolUse` refusal-script controls.
 *
 * Extracted the way `hardcoded-invocation-fixture` is: the subjects and the
 * payloads they must judge are read by more than one suite, and a second copy
 * of them would let two controls disagree about what the population is.
 *
 * @module tests/integration/pre-tool-refusal-fixture
 */

import { spawnSync } from "node:child_process";

/** `bash` by absolute path — never resolved through a writeable $PATH. */
export const BASH = "/bin/bash";

/** Wall-clock ceiling for one script run. */
export const SCRIPT_TIMEOUT_MS = 30_000;

/** The settings file these scripts consult. */
export const CONFIG_FILE = ".lisa.config.json";

/** The shared façade helper, by basename. */
export const HELPER = "lisa-edit-gate.sh";

/** The Codex path extractor, sourced by both Codex subjects. */
export const EXTRACTOR = "_extract-edit-paths.sh";

/** The exit status a `PreToolUse` hook uses to refuse a write. */
export const REFUSED = 2;

/** The exit status that lets the write through. */
export const PERMITTED = 0;

/** The task the fixture declares, and the trace line proving it ran. */
export const DECLARED_TASK = "check:proposed-write";

/** Where the pre-change snapshot of each refusal script is pinned. */
export const PRE_FACADE = "tests/fixtures/pre-tool-refusal-pre-facade";

/**
 * A suppression directive, assembled rather than written out.
 *
 * Written literally this file could not be saved at all: the subject of these
 * suites is installed in this repository and refuses any write that adds one.
 * The guard refusing the fixture that proves it guards is the strongest
 * evidence here; the interpolation is only the way around it, and the runtime
 * string is the real directive.
 */
const SUPPRESSION = `// ${"eslint"}-disable-next-line no-console\nconsole.log(1);\n`;

/** One payload a shipped refusal script must judge. */
export interface Payload {
  /** Project-relative path of the file the tool proposes to write. */
  readonly file: string;
  /** The text the tool proposes to write into it. */
  readonly text: string;
}

/** One shipped `PreToolUse` refusal script and what it proves. */
export interface Subject {
  /** Repository-relative path to the shipped script. */
  readonly script: string;
  /** Basename of its pinned pre-change snapshot. */
  readonly before: string;
  /** The registry gate one invocation of it proves. */
  readonly gate: string;
  /** A write the built-in must refuse. */
  readonly refuses: Payload;
  /** A write the built-in must let through — the inert-guard control. */
  readonly permits: Payload;
}

/** An ordinary TypeScript write, in scope for both subjects and innocent. */
const ORDINARY: Payload = {
  file: "src/thing.ts",
  text: "export const thing = 1;\n",
};

/** The write `block-suppress-directives` exists to stop. */
const SUPPRESSING: Payload = { file: "src/thing.ts", text: SUPPRESSION };

/**
 * The write `block-migration-edits` exists to stop.
 *
 * The digits and the dash are load-bearing: the Codex copy matches
 * `*&#47;migrations/*[0-9]*-*.ts` where the Claude copy matches any `.ts` under
 * a migrations directory, and one path has to satisfy both.
 */
const HAND_WRITTEN_MIGRATION: Payload = {
  file: "src/database/migrations/1700000000000-Init.ts",
  text: "export class Init {}\n",
};

/**
 * The four shipped copies, both agent surfaces.
 *
 * The Codex copies are executed rather than represented by the originals: they
 * DIFFER — a different harness contract, a shared path extractor, and no `cd` —
 * so "the original consults, therefore this does" is not an argument that holds
 * for them.
 */
export const SUBJECTS: readonly Subject[] = [
  {
    script: "plugins/src/typescript/hooks/block-suppress-directives.sh",
    before: "typescript-block-suppress-directives.sh",
    gate: "suppression-residue",
    refuses: SUPPRESSING,
    permits: ORDINARY,
  },
  {
    script: "plugins/src/nestjs/hooks/block-migration-edits.sh",
    before: "nestjs-block-migration-edits.sh",
    gate: "migration-provenance",
    refuses: HAND_WRITTEN_MIGRATION,
    permits: ORDINARY,
  },
  {
    script: "src/codex/scripts/block-suppress-directives.sh",
    before: "codex-block-suppress-directives.sh",
    gate: "suppression-residue",
    refuses: SUPPRESSING,
    permits: ORDINARY,
  },
  {
    script: "src/codex/scripts/block-migration-edits.sh",
    before: "codex-block-migration-edits.sh",
    gate: "migration-provenance",
    refuses: HAND_WRITTEN_MIGRATION,
    permits: ORDINARY,
  },
];

/**
 * The stub runner every declared task resolves through.
 *
 * Records the task instead of running it, so "which prover ran" is observable.
 * `LISA_TASK_EXIT` lets one case make the declared task FAIL, which is how a
 * declared refusal is told from a declared permit.
 */
export const RUNNER_STUB = [
  "#!/bin/sh",
  'if [ "$1" = "run" ]; then',
  '  echo "TASK:$2" >> "$LISA_TRACE"',
  '  exit "${LISA_TASK_EXIT:-0}"',
  "fi",
  "exit 0",
  "",
].join("\n");

/**
 * Absolute path of one external tool, resolved through the ambient PATH.
 * @param tool The binary name.
 * @returns Its absolute path, or empty when it is not installed.
 */
export function locate(tool: string): string {
  const found = spawnSync("/usr/bin/env", ["which", tool], {
    encoding: "utf8",
    timeout: SCRIPT_TIMEOUT_MS,
  });
  return (found.stdout ?? "").trim();
}
