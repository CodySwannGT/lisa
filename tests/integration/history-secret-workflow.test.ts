/**
 * @file history-secret-workflow.test.ts
 * @description Execute the actual inline facade against root and emitted registry sources.
 * @module tests/history-secrets
 */
import {
  mkdtempSync,
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
useIoLatencyBudget();
/** Minimal job shape for the actual authored shell step. */
interface HistoryWorkflow {
  readonly jobs: Record<
    string,
    {
      readonly uses?: string;
      readonly steps?: readonly {
        readonly name?: string;
        readonly if?: string;
        readonly uses?: string;
        readonly run?: string;
        readonly env?: Record<string, string>;
      }[];
    }
  >;
}
const root = resolve(import.meta.dirname, "../..");
const CONFIG = ".lisa.config.json";
const SOURCE_SCRIPTS = "all/copy-overwrite/scripts";
const NO_SCANNER_RESULT = "No scanner safety result claimed";
const workflow = load(
  readFileSync(join(root, ".github/workflows/history-secrets.yml"), "utf8")
) as HistoryWorkflow;
const step = workflow.jobs["scan"]?.steps?.find(
  entry => entry.env?.["HISTORY_MOMENT"]
);
const runFacade = (
  cwd: string,
  event: string,
  moment = "pull-request",
  directory = "."
) =>
  boundedSpawnSync({
    label: "actual history inline facade",
    command: "bash",
    args: ["-c", step?.run ?? ""],
    cwd,
    env: {
      ...process.env,
      GATE_ID: "introduced-history-credential-leakage",
      HISTORY_DIRECTORY: directory,
      HISTORY_MOMENT: moment,
      GITHUB_EVENT_PATH: event,
      GITHUB_EVENT_NAME: "push",
      RUNNER_TEMP: tmpdir(),
    },
    baseMs: 30000,
  });
describe("actual shared history facade", () => {
  it("rejects privileged pull request events before checking out caller code", () => {
    const steps = workflow.jobs["scan"]?.steps ?? [];
    const index = steps.findIndex(entry =>
      entry.if?.includes("pull_request_target")
    );
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(
      steps.findIndex(entry => entry.uses?.startsWith("actions/checkout@"))
    );
    const result = boundedSpawnSync({
      label: "actual unsupported event refusal",
      command: "bash",
      args: ["-c", steps[index]?.run ?? ""],
      cwd: root,
      baseMs: 30000,
    });
    expect(result.status).toBe(1);
    expect(String(result.stdout) + String(result.stderr)).toContain(
      "pull_request"
    );
  });
  it("preserves authored incompatible-policy guidance and withholds parser payloads", () => {
    const cwd = mkdtempSync(join(tmpdir(), "history-policy-guidance-"));
    try {
      cpSync(join(root, SOURCE_SCRIPTS), join(cwd, "scripts"), {
        recursive: true,
      });
      const runPolicy = () =>
        boundedSpawnSync({
          label: "actual policy guidance",
          command: process.execPath,
          args: [
            "--input-type=module",
            "-e",
            'const { historyPolicy } = await import("./scripts/lib/history-secret-policy.mjs"); try { historyPolicy(process.cwd(), "push"); } catch(error) { console.error(error.message); process.exitCode = 1; }',
          ],
          cwd,
          baseMs: 30000,
        });
      writeFileSync(
        join(cwd, CONFIG),
        JSON.stringify({
          gates: {
            "introduced-history-credential-leakage": { push: "optional" },
          },
        })
      );
      const incompatible = runPolicy();
      expect(incompatible.status).toBe(1);
      expect(String(incompatible.stderr)).toContain(
        "authored required history route is incompatible"
      );
      writeFileSync(join(cwd, "package.json"), "{private-parser-payload");
      const malformed = runPolicy();
      expect(malformed.status).toBe(1);
      expect(String(malformed.stderr)).toContain(
        "raw configuration errors are withheld"
      );
      expect(String(malformed.stdout) + String(malformed.stderr)).not.toContain(
        "private-parser-payload"
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  it("withholds invalid directory and missing-entry bootstrap paths", () => {
    const value = randomBytes(32).toString("hex");
    const cwd = mkdtempSync(join(tmpdir(), `history-${value}-`));
    try {
      const invalidDirectory = runFacade(
        cwd,
        "unused.json",
        "push",
        `missing-${value}`
      );
      expect(invalidDirectory.status).toBe(1);
      expect(String(invalidDirectory.stderr)).toContain("full Lisa apply");
      expect(
        String(invalidDirectory.stdout) + String(invalidDirectory.stderr)
      ).not.toContain(value);
      cpSync(join(root, SOURCE_SCRIPTS), join(cwd, "scripts"), {
        recursive: true,
      });
      writeFileSync(
        join(cwd, CONFIG),
        JSON.stringify({
          gates: {
            "introduced-history-credential-leakage": { push: "required" },
          },
        })
      );
      rmSync(join(cwd, "scripts/lisa-history-secrets.mjs"));
      const missingEntry = runFacade(cwd, "unused.json", "push");
      expect(missingEntry.status).toBe(1);
      expect(
        String(missingEntry.stdout) + String(missingEntry.stderr)
      ).not.toContain(value);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  it("uses same-commit nested workflow calls", () => {
    for (const file of ["quality.yml", "quality-rails.yml"]) {
      const caller = load(
        readFileSync(join(root, ".github/workflows", file), "utf8")
      ) as HistoryWorkflow;
      expect(caller.jobs["history_secrets"]?.uses).toBe(
        "./.github/workflows/history-secrets.yml"
      );
    }
  });
  it("resolves the real root source without silently imposing a new declaration", () => {
    const output = runFacade(root, "unused-for-undeclared.json");
    expect(output.status).toBe(0);
    expect(String(output.stdout)).toContain("not declared");
    expect(String(output.stdout)).toContain(NO_SCANNER_RESULT);
  });
  it("preserves an older manifest-free host's undeclared route without a new helper", () => {
    const cwd = mkdtempSync(join(tmpdir(), "history-old-host-"));
    try {
      mkdirSync(join(cwd, "scripts"));
      writeFileSync(
        join(cwd, CONFIG),
        JSON.stringify({
          gates: {
            runner: "just",
            "credential-leakage": { "pull-request": "optional" },
          },
        })
      );
      const result = runFacade(cwd, "unused-for-undeclared.json");
      expect(result.status).toBe(0);
      expect(String(result.stdout)).toContain(NO_SCANNER_RESULT);
      writeFileSync(
        join(cwd, CONFIG),
        JSON.stringify({
          gates: {
            "introduced-history-credential-leakage": {
              "pull-request": "required",
            },
          },
        })
      );
      expect(runFacade(cwd, "unused-for-missing-helper.json").status).toBe(1);
      writeFileSync(
        join(cwd, CONFIG),
        JSON.stringify({
          gates: {
            "introduced-history-credential-leakage": { "pull-request": "off" },
          },
        })
      );
      const off = runFacade(cwd, "unused-for-off.json");
      expect(off.status).toBe(0);
      expect(String(off.stdout)).toContain(NO_SCANNER_RESULT);
      writeFileSync(join(cwd, CONFIG), "{invalid-private-config");
      const malformed = runFacade(cwd, "unused-for-malformed.json");
      expect(malformed.status).toBe(1);
      expect(String(malformed.stderr)).not.toContain("invalid-private-config");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  it("executes real emitted manifest-free deletion semantics and fails malformed policy", () => {
    const cwd = mkdtempSync(join(tmpdir(), "history-facade-"));
    try {
      cpSync(join(root, SOURCE_SCRIPTS), join(cwd, "scripts"), {
        recursive: true,
      });
      mkdirSync(join(cwd, "repository"));
      const initialized = boundedSpawnSync({
        label: "initialize actual history repository",
        command: "git",
        args: ["init", "-q"],
        cwd,
        baseMs: 30000,
      });
      expect(initialized.status).toBe(0);
      const config = join(cwd, CONFIG);
      writeFileSync(
        config,
        JSON.stringify({
          gates: {
            "introduced-history-credential-leakage": {
              "pull-request": "required",
            },
          },
        })
      );
      const event = join(cwd, "event.json");
      writeFileSync(
        event,
        JSON.stringify({
          before: "a".repeat(40),
          after: "0".repeat(40),
          deleted: true,
        }),
        { mode: 0o600 }
      );
      const result = runFacade(cwd, event);
      expect(result.status).toBe(0);
      expect(String(result.stdout)).toContain(
        "No introduced history. Scanner was not run."
      );
      writeFileSync(join(cwd, "package.json"), "{invalid-private-value");
      const invalid = runFacade(cwd, event);
      expect(invalid.status).toBe(1);
      expect(String(invalid.stderr)).not.toContain("invalid-private-value");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
