/**
 * Regression contract for CodySwannGT/lisa#4740: the evidence-release lines in
 * the Jira evidence and journey skills must really stop when the release
 * cannot be used, and must export the name when it can.
 *
 * The old line, `export LISA_EVIDENCE_RELEASE=$(node … --ensure)`, always
 * succeeded: bash's `export` returns 0 whatever the command substitution did,
 * so an agent carried on with an empty release name although the text below
 * the line promised a stop. Reading the wording is not proof the wording
 * works, so this test lifts the release-selection block out of each SKILL.md
 * and runs it under bash, with `node` replaced by a stand-in resolver on PATH.
 * @module tests/unit/strategies/evidence-release-stop-guard
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const BASH = "/bin/bash";
const RELEASE = "lisa-evidence-2026-11";
const STOP_MESSAGE = "Evidence release not usable; stop.";

/** The five source skills that pick the evidence release. */
const SOURCES = [
  "plugins/src/base/skills/lisa-jira-evidence/SKILL.md",
  "plugins/src/base/skills/lisa-jira-journey/SKILL.md",
  "plugins/src/expo/skills/jira-evidence/SKILL.md",
  "plugins/src/expo/skills/jira-journey/SKILL.md",
  "plugins/src/rails/skills/jira-evidence/SKILL.md",
] as const;

/**
 * The fenced bash blocks in a skill that resolve the evidence release into
 * `LISA_EVIDENCE_RELEASE`. A troubleshooting block that only runs the
 * resolver to create the release is not one of them.
 * @param file - Repository-relative SKILL.md path
 * @returns Each block's shell text, without the fences
 */
function releaseSelectionBlocks(file: string): readonly string[] {
  const text = readFileSync(path.resolve(file), "utf8");
  return [...text.matchAll(/```bash\n([\s\S]*?)```/g)]
    .map(match => match[1] ?? "")
    .filter(
      block =>
        block.includes("evidence-release --ensure") &&
        block.includes("LISA_EVIDENCE_RELEASE=$(")
    );
}

const shimRoot = mkdtempSync(path.join(tmpdir(), "lisa-4740-node-shim-"));

afterAll(() => {
  rmSync(shimRoot, { recursive: true, force: true });
});

/**
 * A directory holding a stand-in `node` that plays the release resolver.
 * @param name - Directory name under the shim root
 * @param body - Shell body of the stand-in
 * @returns The directory, to put first on PATH
 */
function nodeShim(name: string, body: string): string {
  const dir = path.join(shimRoot, name);
  const shim = path.join(dir, "node");
  mkdirSync(dir, { recursive: true });
  writeFileSync(shim, `#!/bin/sh\n${body}\n`);
  chmodSync(shim, 0o755);
  return dir;
}

/** Resolver that refuses the release, as `--ensure` does when it is nearly full. */
const REFUSING = nodeShim(
  "refusing",
  'echo "evidence release is nearly full" >&2\nexit 3'
);

/** Resolver that prints a usable release name, but only for the documented call. */
const USABLE = nodeShim(
  "usable",
  [
    'if [ "$1 $2 $3" = "scripts/lisa-work-item.mjs evidence-release --ensure" ]; then',
    `  echo ${RELEASE}`,
    "  exit 0",
    "fi",
    'echo "unexpected resolver call: $*" >&2',
    "exit 9",
  ].join("\n")
);

/**
 * Run a release-selection block exactly as written, then report from a child
 * process what it exported, keeping the block's own exit status.
 * @param block - The block's shell text
 * @param shimDir - Directory whose `node` plays the resolver
 * @param preamble - Shell run before the block, standing in for earlier
 *   commands in a long-lived shell
 * @returns Exit status and output
 */
function runBlock(block: string, shimDir: string, preamble = "") {
  const program = [
    preamble,
    block,
    "status=$?",
    `${BASH} -c 'printf "child=[%s]\\n" "\${LISA_EVIDENCE_RELEASE-unset}"'`,
    'exit "$status"',
  ].join("\n");
  return boundedSpawnSync({
    label: "evidence release-selection block under bash",
    command: BASH,
    args: ["--noprofile", "--norc", "-c", program],
    env: { HOME: process.env.HOME, PATH: `${shimDir}:/usr/bin:/bin` },
  });
}

describe("evidence release-selection lines (#4740)", () => {
  describe.each(SOURCES)("%s", file => {
    const blocks = releaseSelectionBlocks(file);

    it("has exactly one release-selection block", () => {
      expect(blocks).toHaveLength(1);
    });

    it("exits non-zero, says to stop, and exports nothing when the release cannot be used", () => {
      const result = runBlock(blocks[0] ?? "", REFUSING);

      expect(result.status, result.stdout + result.stderr).not.toBe(0);
      expect(result.stdout).toContain(STOP_MESSAGE);
      expect(result.stdout).toContain("child=[unset]");
    });

    it("clears a release exported earlier in the same shell when the release cannot be used", () => {
      const result = runBlock(
        blocks[0] ?? "",
        REFUSING,
        "export LISA_EVIDENCE_RELEASE=old"
      );

      expect(result.status, result.stdout + result.stderr).not.toBe(0);
      expect(result.stdout).toContain(STOP_MESSAGE);
      expect(result.stdout).toContain("child=[unset]");
    });

    it("exports the release name when the release is usable", () => {
      const result = runBlock(blocks[0] ?? "", USABLE);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain(STOP_MESSAGE);
      expect(result.stdout).toContain(`child=[${RELEASE}]`);
    });
  });
});
