/**
 * The workflow half of the work-item contract handshake (#3477).
 *
 * The gate has two halves that travel by different routes — `quality.yml` and
 * `quality-rails.yml` by git ref at `@main`, `scripts/lisa-work-item.mjs` on the
 * `lisa apply` channel — so they WILL drift. That is not a discovery here:
 * `scripts/two-channel-couplings.json` already registers this exact pair, twice.
 * What the registry reasons about is the script being ABSENT, which is the
 * benign case; the harmful one is present-and-old, where a required check goes
 * red on logic Lisa superseded months earlier and every reader believes it.
 *
 * These cases pin the handshake's SHAPE, and especially the asymmetry in it,
 * because the asymmetry is the part a later editor is most likely to "tidy up"
 * into a plain fail-closed and thereby redden the entire fleet in one merge.
 */
import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { WORK_ITEM_CONTRACT_VERSION } from "../../all/copy-overwrite/scripts/lisa-work-item.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS = path.join(REPO_ROOT, ".github", "workflows");
const INPUT = "expected_work_item_contract";
const COUPLINGS = path.join(REPO_ROOT, "scripts", "two-channel-couplings.json");

const FILES = ["quality.yml", "quality-rails.yml"] as const;
const WARNING = "::warning::";
const FAILS = "exit 1";

/** One declared `workflow_call` input, narrowed to what these cases read. */
interface WorkflowInput {
  readonly default?: string;
  readonly type?: string;
}

/**
 * Parse one reusable workflow's declared `workflow_call` inputs.
 * @param file - Workflow file name under .github/workflows.
 * @returns The declared inputs, keyed by name.
 */
function inputsOf(file: string): Record<string, WorkflowInput> {
  const parsed = yaml.load(
    fs.readFileSync(path.join(WORKFLOWS, file), "utf8")
  ) as Record<string, unknown>;
  // `on:` is the YAML 1.1 boolean `true` once loaded, so read both spellings.
  const on = (parsed["on"] ?? parsed[String(true)]) as Record<string, unknown>;
  const call = on["workflow_call"] as Record<string, unknown>;
  return call["inputs"] as Record<string, WorkflowInput>;
}

/**
 * Read one workflow's raw text, which is where the shell body lives.
 * @param file - Workflow file name under .github/workflows.
 * @returns The file contents.
 */
function textOf(file: string): string {
  return fs.readFileSync(path.join(WORKFLOWS, file), "utf8");
}

describe.each(FILES)("%s work-item contract handshake", file => {
  it(`declares the ${INPUT} input as a string`, () => {
    const input = inputsOf(file)[INPUT];
    expect(input).toBeDefined();
    expect(input?.type).toBe("string");
  });

  /**
   * The drift this repository can actually commit. Every other skew needs a
   * consumer who has not applied; THIS one is authored in one tree, where a
   * bump to the script's constant that forgets the workflow default silently
   * turns the handshake into a comparison against a stale literal — a detector
   * that reports "in sync" forever, which is worse than no detector.
   */
  it(`pins the ${INPUT} default in lockstep with WORK_ITEM_CONTRACT_VERSION`, () => {
    expect(inputsOf(file)[INPUT]?.default).toBe(WORK_ITEM_CONTRACT_VERSION);
  });

  it("reads the script's own contract-version rather than inferring it", () => {
    expect(textOf(file)).toContain(
      "node scripts/lisa-work-item.mjs contract-version"
    );
  });

  it("fails closed on a MAJOR mismatch", () => {
    const text = textOf(file);
    expect(text).toContain('if [ "$script_major" != "$expected_major" ]; then');
    expect(text).toContain("Work-Item gate contract mismatch");
  });

  /**
   * The asymmetry, pinned deliberately.
   *
   * The nightly-e2e gate fails closed when its guard script is missing, and it
   * can: its header states that consumers PIN it to an immutable tag and that
   * `@main` is not a supported pin. These workflows are consumed AT `@main` —
   * live in every consumer on their next run, while the script they read
   * arrives only on the `lisa apply` channel. Failing closed on a copy that
   * merely predates the handshake would redden every consumer who has not
   * applied since it shipped: the same two-channel mistake this gate exists to
   * catch, committed in the other direction.
   *
   * So the absent-subcommand branch must WARN and must not exit non-zero.
   */
  it("warns rather than failing when the copy predates the handshake", () => {
    const text = textOf(file);
    const marker =
      'elif grep -q "Usage: lisa-work-item.mjs" "$contract_err"; then';
    const start = text.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const branch = text.slice(start, text.indexOf("\n          else", start));
    expect(branch).toContain(WARNING);
    expect(branch).toContain("lisa apply");
    expect(branch).not.toContain(FAILS);
  });

  /**
   * An older minor means the contract still holds and only the logic behind it
   * moved. It must be reported — that report is the entire remedy for "a
   * required check goes red on logic Lisa fixed months ago and nothing anywhere
   * says so" — and it must not fail, or every consumer one release behind goes
   * red for a difference the contract says is compatible.
   */
  it("reports an older minor without failing", () => {
    const text = textOf(file);
    const start = text.indexOf('[ "$script_minor" -lt "$expected_minor" ]');
    expect(start).toBeGreaterThan(-1);
    const branch = text.slice(start, start + 900);
    expect(branch).toContain(WARNING);
    expect(branch).not.toContain(FAILS);
  });

  /**
   * "I do not understand the reply" is not evidence of a known
   * incompatibility, and it must not be failed on. A host-authored replacement
   * at this path, a wrapper that echoes, or a copy whose unknown-subcommand
   * path writes to stdout and exits 0 all land here — none of them is a
   * declared major mismatch, and on a workflow delivered `@main` the safe
   * reading of an unknown answer is to say so and carry on. Only a real,
   * well-formed, DIFFERENT major is fatal.
   */
  it("only compares an answer that is actually a version", () => {
    const text = textOf(file);
    expect(text).toContain("grep -Eq '^[0-9]+\\.[0-9]+\\.[0-9]+$'");
    const start = text.indexOf(
      "answered the work-item contract handshake with something that is not a version"
    );
    expect(start).toBeGreaterThan(-1);
    expect(text.slice(start - 200, start)).toContain(WARNING);
  });

  it("names both versions so a stale-logic red is diagnosable from the log", () => {
    expect(textOf(file)).toContain(
      'echo "Work-item gate contract: script $script_contract, workflow expects $expected_contract"'
    );
  });

  /**
   * The same version test, applied to the half the workflow controls.
   *
   * `expected_work_item_contract` is an OPTIONAL input, and Actions treats an
   * explicitly-passed empty string as a value that was provided — so a caller
   * interpolating a variable that resolves to empty overrides the declared
   * default rather than falling back to it. A perfectly well-formed reply from
   * the script is then compared against an empty `expected_major`, and this
   * REQUIRED gate fails on a mismatch that is not a real major mismatch. The
   * script's half was already guarded against exactly this; the workflow's
   * half was not, so only one of the two answers could be trusted.
   */
  it("validates BOTH halves of the handshake, not just the script's", () => {
    const text = textOf(file);
    const versionTest = "grep -Eq '^[0-9]+\\.[0-9]+\\.[0-9]+$'";
    expect(text.split(versionTest).length - 1).toBe(2);
  });

  /**
   * Warned and skipped rather than failed, for the same reason the absent
   * subcommand is: these workflows are consumed at `@main`, so failing closed
   * on a caller's empty string would redden the entire fleet for a
   * misconfiguration each consumer's own script is innocent of.
   */
  it("skips, and does not fail, when its OWN expected version is malformed", () => {
    const text = textOf(file);
    const start = text.indexOf("Work-item contract handshake skipped");
    expect(start).toBeGreaterThan(-1);
    const branch = text.slice(start - 300, start + 700);
    expect(branch).toContain(WARNING);
    expect(branch).not.toContain(FAILS);
    // The received value has to reach the log. A required gate that changes
    // behaviour for a reason the operator cannot see is the failure mode this
    // pair keeps producing, and a silent skip is that failure wearing green.
    expect(branch).toContain("received '${expected_contract}'");
    // And the comparison must actually be bypassed — warning while still
    // comparing against an empty major would leave the red in place.
    expect(text).toContain('if [ -z "$expected_contract" ]; then');
  });
});

describe("two-channel coupling registry", () => {
  /**
   * The registry is what made this defect findable, and it still describes only
   * the absence hazard. Its entries must keep naming this pair, so the sweep of
   * the remaining entries (filed separately) has something to walk.
   */
  it("still registers both work-item couplings", () => {
    const parsed = JSON.parse(fs.readFileSync(COUPLINGS, "utf8")) as {
      readonly couplings?: readonly { readonly key: string }[];
    };
    const entries = Array.isArray(parsed)
      ? (parsed as readonly { readonly key: string }[])
      : (parsed.couplings ?? []);
    const keys = entries.map(entry => entry.key);
    expect(keys).toContain("quality.yml::scripts/lisa-work-item.mjs");
    expect(keys).toContain("quality-rails.yml::scripts/lisa-work-item.mjs");
  });
});
