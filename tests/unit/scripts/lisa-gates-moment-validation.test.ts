/**
 * Tests that an unrecognised moment fails loudly instead of resolving to
 * nothing.
 *
 * `resolveMoment` reads `gate[moment]`, so a moment Lisa does not know simply
 * matches no key on any gate and returns `[]`. Every consumer reads that empty
 * list as "this project declares no gates here" and falls through to its
 * unguarded path: `lisa-gates.mjs list` reports `configured=false` for all ten
 * façade jobs, and `lisa-run-gates.mjs` prints a green
 * `0 proved, 0 failed ... of 0 gate(s) declared` and exits 0.
 *
 * That is the defect this subsystem exists to stop — a check reporting
 * satisfied without having proved anything — reachable through a single typo.
 * It became reachable from outside the repository when `quality.yml` gained a
 * `moment` input, because until then every call site passed the literal
 * `pull-request`.
 * @module tests/unit/scripts/lisa-gates-moment-validation
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveMoment } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPTS = path.join(REPO_ROOT, "all", "copy-overwrite", "scripts");
const GATES = path.join(SCRIPTS, "lisa-gates.mjs");
const RUN_GATES = path.join(SCRIPTS, "lisa-run-gates.mjs");
const CONTINUOUS_DEV = "continuous:dev";
const FAMILY_GUIDANCE = 'Use "continuous:<environment>" for that family';
const LISA_CONFIG = ".lisa.config.json";
const MALFORMED_CONTINUOUS_DEV = "continuous:dev:nightly";
const TEMP_PREFIX = "lisa-gates-";

/** A gates block declaring one gate at one real moment. */
const gates = {
  "code-style": { run: "lint", "pull-request": "required" },
};

/**
 * Run one of the shipped scripts and capture its result.
 * @param script Absolute path to the script.
 * @param args CLI arguments.
 * @returns The completed process.
 */
const run = (script: string, args: string[]) =>
  boundedSpawnSync({
    label: `${path.basename(script)} ${args.join(" ")}`,
    command: process.execPath,
    args: [script, ...args],
    cwd: REPO_ROOT,
  });

describe("resolveMoment rejects a moment Lisa does not know", () => {
  it.each([
    ["a misspelt family", "continous:dev"],
    ["a family with no environment", "continuous"],
    ["a family with too many segments", MALFORMED_CONTINUOUS_DEV],
    ["a bare typo", "pull-requst"],
    ["nonsense", "totally-bogus"],
  ])("throws on %s", (_label, moment) => {
    expect(() => resolveMoment({ gates, moment })).toThrow(/not a moment/i);
  });

  it("names the offending moment, so the operator can see the typo", () => {
    expect(() => resolveMoment({ gates, moment: "continous:dev" })).toThrow(
      /continous:dev/
    );
  });

  it("does not suggest the same bare family it rejected", () => {
    expect(() => resolveMoment({ gates, moment: "continuous" })).toThrow(
      /Use "continuous:<environment>"/
    );
    expect(() => resolveMoment({ gates, moment: "continuous" })).not.toThrow(
      /Did you mean "continuous"/
    );
  });

  it("rejects a config key keyed by a bare family moment", () => {
    expect(() =>
      resolveMoment({
        gates: {
          "e2e-browser": { task: "test:e2e", continuous: "required" },
        },
        moment: "continuous:dev",
      })
    ).toThrow(/gates\."e2e-browser"\."continuous"/);
  });

  it("rejects a config key keyed by a malformed family moment", () => {
    expect(() =>
      resolveMoment({
        gates: {
          "e2e-browser": {
            task: "test:e2e",
            [MALFORMED_CONTINUOUS_DEV]: "required",
          },
        },
        moment: CONTINUOUS_DEV,
      })
    ).toThrow(/gates\."e2e-browser"\."continuous:dev:nightly"/);
  });

  it.each([
    ["a fixed moment", "pull-request"],
    ["a fixed moment with no gates declared at it", "session-start"],
    ["a family with an environment", CONTINUOUS_DEV],
    ["a deploy family", "pre-deploy:production"],
  ])("still resolves %s", (_label, moment) => {
    expect(() => resolveMoment({ gates, moment })).not.toThrow();
  });

  it("returns an empty list for a VALID moment with nothing declared", () => {
    // The distinction this guard turns on: `[]` is a truthful answer for a
    // real moment, and a lie for one that does not exist.
    expect(resolveMoment({ gates, moment: "session-start" })).toEqual([]);
  });
});

describe("the shipped CLIs refuse an unknown moment", () => {
  it("lisa-gates.mjs list exits nonzero rather than printing []", () => {
    const result = run(GATES, ["list", "--moment=continous:dev", "--json"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("[]");
    expect(`${result.stderr}`).toMatch(/continous:dev/);
  });

  it("lisa-run-gates.mjs never reports green for an unknown moment", () => {
    // The dangerous shape: this runner's ✅ line is what the husky hooks read
    // as "every required gate was proved", and it printed exactly that for a
    // moment that cannot exist.
    const result = run(RUN_GATES, ["--moment=continous:dev"]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}`).not.toContain("✅");
    expect(`${result.stdout}${result.stderr}`).toMatch(/continous:dev/);
  });

  it("lisa-gates.mjs list still succeeds for a real moment", () => {
    const result = run(GATES, ["list", "--moment=pull-request", "--json"]);
    expect(result.status).toBe(0);
  });

  it("lisa-gates.mjs list refuses a config key keyed by a bare family", () => {
    const dir = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX));
    writeFileSync(
      path.join(dir, LISA_CONFIG),
      JSON.stringify({
        gates: {
          "e2e-browser": { task: "test:e2e", continuous: "required" },
        },
      }),
      "utf8"
    );
    const result = boundedSpawnSync({
      label: "lisa-gates.mjs list",
      command: process.execPath,
      args: [
        GATES,
        "list",
        `--moment=${CONTINUOUS_DEV}`,
        "--json",
        "--include-off",
      ],
      cwd: dir,
    });
    rmSync(dir, { recursive: true, force: true });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("[]");
    expect(`${result.stderr}`).toContain(FAMILY_GUIDANCE);
  });

  it("lisa-gates.mjs list refuses a config key with extra family segments", () => {
    const dir = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX));
    writeFileSync(
      path.join(dir, LISA_CONFIG),
      JSON.stringify({
        gates: {
          "e2e-browser": {
            task: "test:e2e",
            [MALFORMED_CONTINUOUS_DEV]: "required",
          },
        },
      }),
      "utf8"
    );
    const result = boundedSpawnSync({
      label: "lisa-gates.mjs list",
      command: process.execPath,
      args: [
        GATES,
        "list",
        `--moment=${CONTINUOUS_DEV}`,
        "--json",
        "--include-off",
      ],
      cwd: dir,
    });
    rmSync(dir, { recursive: true, force: true });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("[]");
    expect(`${result.stderr}`).toContain(
      `gates."e2e-browser"."${MALFORMED_CONTINUOUS_DEV}"`
    );
    expect(`${result.stderr}`).toContain(FAMILY_GUIDANCE);
  });
});

describe("list distinguishes an unrunnable gate from an intercepted one", () => {
  /**
   * Run `list` against a throwaway config in its own directory.
   * @param config The `.lisa.config.json` contents.
   * @returns The plain-text listing.
   */
  const seed = (config: unknown): string => {
    const dir = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX));
    const file = path.join(dir, LISA_CONFIG);
    writeFileSync(file, JSON.stringify(config), "utf8");
    return dir;
  };

  const listWith = (config: unknown): string => {
    const dir = seed(config);
    const result = boundedSpawnSync({
      label: "lisa-gates.mjs list --moment=pull-request",
      command: process.execPath,
      args: [GATES, "list", "--moment=pull-request"],
      cwd: dir,
    });
    rmSync(dir, { recursive: true, force: true });
    return `${result.stdout}`;
  };

  it("does not call an unresolvable gate intercepted", () => {
    // A gate id Lisa does not know has no task, so its command is null — the
    // same null an intercepted gate has. Rendering both as "intercepted by
    // Lisa" told a config author their typo was being handled.
    const listing = listWith({
      gates: { "x-nothing-runs-me": { "pull-request": "optional" } },
    });
    expect(listing).toContain("x-nothing-runs-me");
    expect(listing).not.toContain("intercepted by Lisa");
    expect(listing).toContain("NO PROVER");
  });

  it("still calls a genuinely intercepted gate intercepted", () => {
    const listing = listWith({
      gates: { "verification-bypass": { "pull-request": "required" } },
    });
    expect(listing).toContain("intercepted by Lisa");
  });
});
