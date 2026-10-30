/**
 * Classify synthetic path strings with the actual canonical and emitted hooks.
 * Proposed commands are stdin JSON DATA ONLY, never shell invocations. Setup
 * creates harmless Markdown beneath one owned temp root; no store file exists
 * in the fixture, and no user's agent home is enumerated or read.
 *
 * The six directory spellings are the existing shared Bash protection surface.
 * OpenCode/Devin have no additional directory arm in that matcher; this suite
 * measures the shared hook, not seven native applications. Generation remains
 * owned by build:plugins. Existing safety suites retain their own assertions.
 * @module tests/unit/hooks/parity-safety-net-agent-store-paths
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { withUnanswerableGrep } from "../../helpers/unanswerable-grep.js";

import profile from "./support/agent-store-paths.json" with { type: "json" };

/** Exact credential diagnostic; an unrelated early refusal is not success. */
const STORE_DIAGNOSTIC = "coding-agent or package-registry credential store";
const HOOKS = [
  "plugins/src/base/hooks/parity-safety-net.sh",
  "plugins/lisa/hooks/parity-safety-net.sh",
].map(file => path.resolve(file));

/** One synthetic proposed command and its required classifier verdict. */
interface Case {
  readonly id: string;
  readonly command: string;
  readonly expected: number;
  readonly diagnostic?: string;
}

/**
 * Render operands as text, leaving root substitution until fixture setup.
 * @param relative Synthetic relative path.
 * @param shape Controlled literal spelling.
 * @returns An operand template used only as JSON command data.
 */
function operand(relative: string, shape: string): string {
  switch (shape) {
    case "relative":
      return relative;
    case "dot-relative":
      return `./${relative}`;
    case "absolute":
      return `{root}/${relative}`;
    case "quoted-absolute":
      return `"{root}/${relative}"`;
    default:
      throw new Error(`Unknown controlled path shape: ${shape}`);
  }
}

/** New harmless controls must fail on the unfixed hook and allow after a fix. */
const BENIGN: readonly Case[] = profile.agentDirectories.flatMap(directory =>
  profile.benignBasenames.flatMap(basename =>
    profile.pathShapes.map(shape => ({
      id: `allows-descriptive-agent-artifact-filenames/${directory}/${basename}/${shape}`,
      command: `cat ${operand(`${directory}/artifacts/research/${basename}`, shape)}`,
      expected: 0,
    }))
  )
);

/** Store targets are path STRINGS only. Setup never materializes these files. */
const STORES: readonly Case[] = [
  ...profile.agentStorePaths,
  ...profile.registryStorePaths,
].flatMap(store =>
  profile.pathShapes.map(shape => ({
    id: `retains-known-agent-store-refusal/${store}/${shape}`,
    command: `cat ${operand(store, shape)}`,
    expected: 2,
    diagnostic: STORE_DIAGNOSTIC,
  }))
);

/** Keep existing uncertainty refusal, including known stores under variable HOME. */
const UNCERTAIN: readonly Case[] = profile.uncertainCommands.map(row => ({
  ...row,
  id: `retains-uncertain-credential-target-refusal/${row.id}`,
  expected: 2,
}));

/** Harmless filenames cannot subtract a protected operand from a whole command. */
const MIXED: readonly Case[] = profile.agentStorePaths.flatMap(store => {
  const directory = store.split("/")[0];
  const benign = `${directory}/artifacts/research/operator-resume-authority-v1.md`;
  return profile.mixedPathShapes.flatMap(shape =>
    profile.mixedTemplates.map(row => ({
      id: `benign-artifact-cannot-exempt-protected-operand/${store}/${shape}/${row.id}`,
      command: row.command
        .replaceAll("{benign}", operand(benign, shape))
        .replaceAll("{protected}", operand(store, shape))
        .replaceAll("{archive}", operand("archive.tgz", shape)),
      expected: 2,
      diagnostic: STORE_DIAGNOSTIC,
    }))
  );
});

const ORIGINAL: readonly Case[] = profile.originalProtectionCommands.map(
  row => ({
    ...row,
    id: `retains-original-conservative-refusal/${row.id}`,
    expected: 2,
  })
);
const CASES = [...BENIGN, ...STORES, ...UNCERTAIN, ...MIXED, ...ORIGINAL];

/** Filled in before execution; never points at an actual user agent directory. */
let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "lisa-agent-store-paths-"));
  for (const directory of profile.agentDirectories) {
    const research = path.join(root, directory, "artifacts", "research");
    mkdirSync(research, { recursive: true });
    for (const basename of profile.benignBasenames) {
      writeFileSync(
        path.join(research, basename),
        "Synthetic research notes; no secrets.\n"
      );
    }
  }
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

/**
 * Bind captured evidence to input and hook bytes, not a filename alone.
 * @param input Bytes to identify.
 * @returns Hexadecimal SHA256 digest.
 */
const sha256 = (input: string | Buffer): string =>
  createHash("sha256").update(input).digest("hex");

/**
 * The only child is Bash interpreting the literal hook file. The command field
 * is never argv, shell:true, eval, an executable file, or a source of setup work.
 * Every returned receipt includes real status/diagnostic and source/input bytes.
 * @param hook Actual canonical or generated hook.
 * @param row Synthetic command and expected classification.
 * @param env Normal environment, or the existing unanswerable-grep perturbation.
 * @returns Actual completed classifier outcome, not the expected verdict.
 */
function classify(hook: string, row: Case, env = { ...process.env }) {
  const command = row.command.replaceAll("{root}", root);
  const input = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command },
    cwd: root,
  });
  const result = boundedSpawnSync({
    label: `agent-store-paths: ${row.id}`,
    command: "/bin/bash",
    args: [hook],
    input,
    cwd: root,
    env,
  });
  const receipt = {
    case_id: row.id,
    proposed_command: command,
    input,
    input_sha256: sha256(input),
    invocation: ["/bin/bash", hook],
    hook_sha256: sha256(readFileSync(hook)),
    cwd: root,
    observed_at: new Date().toISOString(),
    expected_status: row.expected,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
  };
  console.info(`[agent-store-path-discrimination] ${JSON.stringify(receipt)}`);
  return receipt;
}

describe("parity-safety-net: agent-store path discrimination", () => {
  it.each(CASES)("$id", row => {
    // Classify BOTH before asserting: baseline failures retain both observations.
    const receipts = HOOKS.map(hook => classify(hook, row));
    for (const receipt of receipts) {
      expect(receipt.status, JSON.stringify(receipt)).toBe(row.expected);
      const diagnostic = receipt.stdout + receipt.stderr;
      if (row.diagnostic) {
        expect(diagnostic).toContain(row.diagnostic);
      } else {
        expect(diagnostic).not.toContain(STORE_DIAGNOSTIC);
        expect(diagnostic).not.toContain("Blocked by safety-net");
      }
    }
    expect(receipts.map(receipt => receipt.status)).toEqual([
      row.expected,
      row.expected,
    ]);
  });

  describe.each(HOOKS)("combined controls: %s", hook => {
    it("rejects-all-allow-and-all-block-with-real-opposing-verdicts", () => {
      const harmlessRow = BENIGN[0];
      const storeRow = STORES[0];
      if (!harmlessRow || !storeRow) {
        throw new Error("The opposing classifier controls must both exist");
      }
      const harmless = classify(hook, harmlessRow);
      const protectedStore = classify(hook, storeRow);
      expect(harmless.status, JSON.stringify(harmless)).toBe(0);
      expect(protectedStore.status, JSON.stringify(protectedStore)).toBe(2);
      expect(new Set([harmless.status, protectedStore.status])).toEqual(
        new Set([0, 2])
      );
    });

    it("detects-real-all-blocking-unanswerable-grep-harness", () => {
      const row = {
        id: "ordinary-echo",
        command: "echo harmless-control",
        expected: 0,
      };
      const ordinary = classify(hook, row);
      const blockedRow = {
        ...row,
        id: "ordinary-echo/unanswerable-grep",
        expected: 2,
      };
      const unanswerable = classify(hook, blockedRow, withUnanswerableGrep());
      expect(ordinary.status, JSON.stringify(ordinary)).toBe(0);
      expect(unanswerable.status, JSON.stringify(unanswerable)).toBe(2);
      expect(unanswerable.stdout + unanswerable.stderr).not.toBe("");
    });
  });
});
