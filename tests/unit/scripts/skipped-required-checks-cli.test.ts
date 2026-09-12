/** CLI version skew must fail before an unsupported mode can report success. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const SCRIPT = path.resolve(
  __dirname,
  "../../..",
  "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs"
);
const UNKNOWN_FLAG = "--future-mode";
let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "lisa-check-cli-"));
  mkdirSync(path.join(root, ".github/workflows"), { recursive: true });
  writeFileSync(
    path.join(root, ".github/required-checks.json"),
    JSON.stringify({
      enforcement: "warn",
      required_contexts: [],
      skip_job_declarations: {},
      workflows: [".github/workflows/ci.yml"],
    })
  );
  writeFileSync(path.join(root, ".github/workflows/ci.yml"), "jobs: {}\n");
});
afterEach(() => rmSync(root, { force: true, recursive: true }));

/** Invoke the shipped entry point against an offline repository. */
function invoke(args: string[]) {
  return boundedSpawnSync({
    label: "skipped-required-checks CLI",
    command: process.execPath,
    args: [SCRIPT, ...args],
    cwd: root,
    env: { ...process.env, GITHUB_STEP_SUMMARY: "", GITHUB_OUTPUT: "" },
  });
}

describe("required-check CLI arguments", () => {
  it("preserves the no-mode offline invocation", () => {
    const result = invoke([root, "--json"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).not.toHaveProperty("error");
  });

  it.each([UNKNOWN_FLAG, `${UNKNOWN_FLAG}=true`, "--vacutiy", "-x"])(
    "refuses unknown %s even under warning-only enforcement",
    flag => {
      const result = invoke([root, "--json", flag]);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        error: expect.stringContaining(flag.split("=")[0] ?? flag),
      });
    }
  );

  it("names an unknown flag before reading a missing declaration", () => {
    const result = invoke([path.join(root, "missing"), UNKNOWN_FLAG]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(UNKNOWN_FLAG);
    expect(result.stderr).not.toContain("does not exist");
  });

  it.each(["--json=false", "--settle-timeout"])(
    "refuses malformed supported option %s",
    flag => {
      const result = invoke([root, flag]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(flag.split("=")[0]);
    }
  );

  it.each([["--repo", "acme/code"], ["--repo=acme/code"]])(
    "keeps a supported value separate from the repository path: %j",
    (...flags) => {
      const result = invoke([...flags, root, "--json"]);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).not.toHaveProperty("error");
    }
  );

  it("keeps the specific remedy for the retired remote mode", () => {
    const result = invoke([root, "--remote", "--json"]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).error).toContain("was retired");
  });
});
