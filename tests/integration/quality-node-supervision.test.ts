/** Execute the real workflow fallback across its supported package routes. */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { stepsIn } from "./quality-gate-facade-fixture.js";

useIoLatencyBudget();

const steps = stepsIn("test_node_suites");
const fallback = steps.find(
  step => step.name === "🧪 Run .mjs suites (lisa-test-node)"
);
const configured = steps.find(step => step.id === "gate_run");
const packageRoot = "node_modules/@codyswann/lisa";
const packagedRunner = `${packageRoot}/all/copy-overwrite/scripts/lisa-test-node.mjs`;
const appliedRunner = "scripts/lisa-test-node.mjs";
const supervisor = `${packageRoot}/dist/cli/lisa-test-run.js`;
const realSupervisor = path.resolve("dist/cli/lisa-test-run.js");
const roots: string[] = [];
const childLog = "children.log";
const supervisorLog = "supervisors.log";
const manifest = `${packageRoot}/package.json`;
const modern = { [manifest]: JSON.stringify({ version: "4.56.1" }) };

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Create one isolated consumer with files owned by this case.
 * @param files - Consumer-relative files
 * @returns Consumer root
 */
function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-node-supervision-"));
  roots.push(root);
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  fs.mkdirSync(path.join(root, "scratch"));
  return root;
}

/**
 * Invoke the workflow's actual shell body.
 * @param root - Consumer root
 * @param body - Workflow body
 * @param env - Additional fixture settings
 * @returns Child execution result
 */
function execute(root: string, body = fallback?.run ?? "exit 99", env = {}) {
  return boundedSpawnSync({
    label: "quality .mjs fallback",
    command: "bash",
    args: ["-c", body],
    cwd: root,
    baseMs: 20_000,
    env: {
      PATH: process.env.PATH,
      BASH_ENV: "/dev/null",
      ENV: "/dev/null",
      TMPDIR: path.join(root, "scratch"),
      ...env,
    },
  });
}

const runner = [
  'import { appendFileSync, writeFileSync } from "node:fs";',
  'import { tmpdir } from "node:os";',
  'import path from "node:path";',
  'appendFileSync("children.log", "child\\n");',
  'writeFileSync("scratch-path.txt", tmpdir());',
  'writeFileSync(path.join(tmpdir(), "owned-sentinel"), "owned");',
  "process.exitCode = Number(process.env.FIXTURE_EXIT ?? 0);",
].join("\n");

// Count the workflow invocation before forwarding unchanged arguments to the
// actual supervisor. Scratch ownership and cleanup are never mocked.
const wrapper = [
  'const { appendFileSync } = require("node:fs");',
  'const { spawnSync } = require("node:child_process");',
  'appendFileSync("supervisors.log", JSON.stringify(process.argv.slice(2)) + "\\n");',
  `const result = spawnSync(process.execPath, [${JSON.stringify(realSupervisor)}, ...process.argv.slice(2)], { stdio: "inherit", env: process.env });`,
  "process.exit(result.status ?? 99);",
].join("\n");

describe("quality .mjs fallback supervision", () => {
  it.each([packagedRunner, appliedRunner])(
    "supervises %s once and reclaims its scratch",
    selected => {
      const root = fixture({
        ...modern,
        [selected]: runner,
        [supervisor]: wrapper,
      });
      const result = execute(root);
      expect(result.status, result.stderr).toBe(0);
      expect(fs.readFileSync(path.join(root, childLog), "utf8")).toBe(
        "child\n"
      );
      expect(fs.readFileSync(path.join(root, supervisorLog), "utf8")).toBe(
        `${JSON.stringify(["--profile", "node", "--adapter", "direct", "--", "node", selected])}\n`
      );
      const owned = fs.readFileSync(
        path.join(root, "scratch-path.txt"),
        "utf8"
      );
      expect(owned).not.toBe(path.join(root, "scratch"));
      expect(fs.existsSync(owned)).toBe(false);
    }
  );

  it("prefers the package runner and preserves its failure without retry", () => {
    const root = fixture({
      ...modern,
      [packagedRunner]: runner,
      [appliedRunner]: 'throw new Error("wrong runner");',
      [supervisor]: wrapper,
    });
    const result = execute(root, fallback?.run, { FIXTURE_EXIT: "23" });
    expect(result.status, result.stderr).toBe(23);
    expect(fs.readFileSync(path.join(root, childLog), "utf8")).toBe("child\n");
    expect(
      fs.readFileSync(path.join(root, supervisorLog), "utf8").trim().split("\n")
    ).toHaveLength(1);
    expect(
      fs.existsSync(
        fs.readFileSync(path.join(root, "scratch-path.txt"), "utf8")
      )
    ).toBe(false);
  });

  it.each(["3.42.0", "4.37.3", "4.56.0", undefined])(
    "keeps the reported legacy route for %s",
    version => {
      const root = fixture({
        [appliedRunner]: runner,
        ...(version
          ? { [`${packageRoot}/package.json`]: JSON.stringify({ version }) }
          : {}),
      });
      const result = execute(root);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(
        "::warning title=Legacy .mjs suite runner"
      );
      expect(fs.readFileSync(path.join(root, childLog), "utf8")).toBe(
        "child\n"
      );
      expect(fs.existsSync(path.join(root, supervisorLog))).toBe(false);
    }
  );

  it.each(["4.56.1", "4.62.0", "5.0.0", "invalid"])(
    "refuses missing supervision for %s before child execution",
    version => {
      const root = fixture({
        [appliedRunner]: runner,
        [`${packageRoot}/package.json`]: JSON.stringify({ version }),
      });
      const result = execute(root);
      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toMatch(
        /supervisor missing|Cannot resolve the installed Lisa version/
      );
      expect(fs.existsSync(path.join(root, childLog))).toBe(false);
    }
  );

  it("does not use an older wrapper whose cleanup changes passing suite results", () => {
    const root = fixture({
      [manifest]: JSON.stringify({ version: "4.37.3" }),
      [packagedRunner]: runner,
      [supervisor]: 'throw new Error("old wrapper must not run");',
    });
    const result = execute(root);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("::warning title=Legacy .mjs suite runner");
    expect(fs.readFileSync(path.join(root, childLog), "utf8")).toBe("child\n");
  });

  it.each([packagedRunner, appliedRunner])(
    "refuses ambiguous installed assets without a manifest for %s",
    selected => {
      const root = fixture({ [selected]: runner, [supervisor]: wrapper });
      const result = execute(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Lisa package manifest missing");
      expect(fs.existsSync(path.join(root, childLog))).toBe(false);
      expect(fs.existsSync(path.join(root, supervisorLog))).toBe(false);
    }
  );

  it("refuses a packaged runner missing both supervisor and manifest", () => {
    const root = fixture({ [packagedRunner]: runner });
    const result = execute(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Lisa package manifest missing");
    expect(fs.existsSync(path.join(root, childLog))).toBe(false);
  });

  it("refuses a missing suite runner before starting the supervisor", () => {
    const root = fixture({ [supervisor]: wrapper });
    const result = execute(root, fallback?.run, {
      RUNNER: "inherited-untrusted.mjs",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(".mjs suite runner missing");
    expect(fs.existsSync(path.join(root, supervisorLog))).toBe(false);
  });

  it("runs a configured command once without entering the fallback", () => {
    expect(fallback?.if).toBe("steps.gate.outputs.configured == 'false'");
    expect(configured?.if).toBe("steps.gate.outputs.configured == 'true'");
    const root = fixture({ "configured.mjs": runner, [supervisor]: wrapper });
    const result = execute(root, configured?.run, {
      GATE_RUNNER: "node",
      GATE_TASK: "configured.mjs",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(path.join(root, childLog), "utf8")).toBe("child\n");
    expect(fs.existsSync(path.join(root, supervisorLog))).toBe(false);
  });
});
