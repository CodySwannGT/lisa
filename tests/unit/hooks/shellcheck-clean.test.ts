/**
 * The shell scripts #4929 made ShellCheck-clean stay clean.
 *
 * shellcheck-directives.test.ts stops a script from hiding a finding with a
 * directive; this one runs ShellCheck itself over the scripts that were fixed,
 * following every sourced file, so a new finding fails here instead of
 * accumulating unseen. ShellCheck is a CI-provisioned tool: on a developer
 * machine without it the suite is deferred with the remedy named, and in CI a
 * missing binary fails.
 *
 * Each script's `source=` hint names the sibling it sources at runtime. Two of
 * those siblings only exist once installed — the Codex installer places
 * `_extract-edit-paths.sh` beside the Harper hooks, and a host's `.husky` gets
 * `pre-push.local` and `pre-push.verify` from the create-only and phaser
 * templates — so the canonical file's directory joins the search path.
 * @module tests/unit/hooks/shellcheck-clean
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { probeSucceeds, suiteDeferral } from "../../support/ci-runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Where ShellCheck looks for a sourced file: beside the script, then the canonical copies. */
const SOURCE_PATH = [
  "SCRIPTDIR",
  path.join(REPO_ROOT, "src/codex/scripts"),
  path.join(REPO_ROOT, "typescript/create-only/.husky"),
  path.join(REPO_ROOT, "phaser/copy-overwrite/.husky"),
  path.join(REPO_ROOT, ".husky"),
].join(":");

/** The scripts that must report nothing. */
const SCRIPTS = [
  ".husky/pre-push",
  ".claude-pr/.husky/pre-push",
  "typescript/copy-contents/.husky/pre-push",
  "all/copy-overwrite/scripts/lisa-hooks/block-managed-file-edits.sh",
  "plugins/src/base/hooks/block-managed-file-edits.sh",
  "plugins/src/base/skills/lisa-setup-remote-env/assets/session-start.sh",
  "scripts/lisa-remote-env/session-start.sh",
  "plugins/src/harper-fabric/hooks/block-generated-artifact-edits.sh",
  "plugins/src/harper-fabric/hooks/enforce-config-extensions.sh",
  "plugins/src/nestjs/hooks/block-migration-edits.sh",
  "plugins/src/nestjs/hooks/lisa-edit-gate.sh",
  "plugins/src/rails/hooks/lisa-edit-gate.sh",
  "plugins/src/rails/hooks/rubocop-on-edit.sh",
  "plugins/src/rails/hooks/sg-scan-on-edit.sh",
  "plugins/src/typescript/hooks/block-suppress-directives.sh",
  "plugins/src/typescript/hooks/format-on-edit.sh",
  "plugins/src/typescript/hooks/lint-on-edit.sh",
  "plugins/src/typescript/hooks/lisa-edit-gate.sh",
  "plugins/src/typescript/hooks/sg-scan-on-edit.sh",
  "src/codex/scripts/block-migration-edits.sh",
  "src/codex/scripts/block-suppress-directives.sh",
  "src/codex/scripts/format-on-edit.sh",
  "src/codex/scripts/lint-on-edit.sh",
  "src/codex/scripts/lisa-edit-gate.sh",
  "src/codex/scripts/rubocop-on-edit.sh",
  "src/codex/scripts/sg-scan-on-edit.sh",
];

const deferred = suiteDeferral(
  () => probeSucceeds("shellcheck", ["--version"]),
  "ShellCheck",
  "Install it: brew install shellcheck, or apt-get install shellcheck."
);

describe.skipIf(deferred !== undefined)(
  "the #4929 shell scripts pass ShellCheck",
  () => {
    it.each(SCRIPTS)("%s reports nothing", script => {
      const result = boundedSpawnSync({
        label: `shellcheck ${script}`,
        command: "shellcheck",
        args: ["-x", "-P", SOURCE_PATH, "-f", "gcc", script],
        cwd: REPO_ROOT,
      });
      expect(result.stdout).toBe("");
      expect(result.status).toBe(0);
    });
  }
);
