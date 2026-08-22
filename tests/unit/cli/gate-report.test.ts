/**
 * Tests for what the gate report DERIVES: declarations, commands, provenance
 * and the moment axis.
 *
 * The primary audience is a project with no `gates` block at all — no template
 * ships one — so the first case here is the modal one, and what it must not do
 * is render thirty-four undeclared gates as thirty-four failures.
 * @module tests/unit/cli/gate-report
 */
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { buildGateReport } from "../../../src/cli/gate-report.js";
import {
  MOMENTS,
  REGISTRY,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  cell,
  COVERAGE_TASK,
  makeProject,
  PULL_REQUEST,
  PUSH,
  reportFor,
  row,
  shippedPrePush,
  TEST_CORRECTNESS,
  TYPE_CORRECTNESS,
  TYPECHECK,
  TYPECHECK_SCRIPT,
} from "./gate-report-fixtures.js";

/**
 * How many gates the registry ships.
 *
 * Derived, never typed. A literal here has to be edited every time the registry
 * grows, and the edit is indistinguishable from the report genuinely dropping a
 * gate — the assertion would be updated to match the bug.
 */
const GATE_COUNT = Object.keys(REGISTRY).length;

describe("a project with no gates block", () => {
  it("reports every registry gate rather than omitting the undeclared", async () => {
    const built = await reportFor({ config: { tracker: "github" } });
    expect(built.gates).toHaveLength(GATE_COUNT);
    expect(built.gates.every(entry => entry.label.length > 0)).toBe(true);
    expect(built.gates.every(entry => entry.summary.length > 0)).toBe(true);
  });

  it("renders every gate as not-declared rather than as a failure", async () => {
    const built = await reportFor({ config: { tracker: "github" } });
    const declared = built.gates.flatMap(entry =>
      entry.moments.filter(one => one.declaration !== "not-declared")
    );
    expect(declared).toHaveLength(0);
    expect(built.summary.governedBySettings).toBe(0);
    expect(built.summary.notDeclared).toBe(GATE_COUNT);
    expect(built.summary.buckets.C).toBe(0);
    expect(built.summary.buckets.D).toBe(0);
  });

  it("still resolves the command each gate would run, and whether it exists", async () => {
    const built = await reportFor({
      config: {},
      scripts: { [TYPECHECK]: TYPECHECK_SCRIPT },
    });
    const push = cell(built, TYPE_CORRECTNESS, PUSH);
    expect(push.task).toBe(TYPECHECK);
    expect(push.command).toBe("npm run typecheck");
    expect(push.commandExists).toEqual({ state: "verified", value: true });
    expect(cell(built, "build-integrity", PUSH).commandExists).toEqual({
      state: "verified",
      value: false,
    });
  });
});

describe("a declared gate whose command does not exist", () => {
  it("is bucket C, verified, rather than an unknown or a pass", async () => {
    const built = await reportFor({
      config: { gates: { [TYPE_CORRECTNESS]: { push: "required" } } },
      scripts: {},
    });
    const push = cell(built, TYPE_CORRECTNESS, PUSH);
    expect(push.declaration).toBe("required");
    expect(push.commandExists).toEqual({ state: "verified", value: false });
    expect(push.bucket).toEqual({ state: "verified", value: "C" });
    expect(built.summary.declaredWithoutCommand).toBe(1);
  });
});

describe("declared off and never declared", () => {
  it("are distinct states with distinct labels", async () => {
    const built = await reportFor({
      config: { gates: { "test-node-suites": { push: "off" } } },
    });
    expect(cell(built, "test-node-suites", PUSH).declaration).toBe("off");
    expect(cell(built, "accessibility", PULL_REQUEST).declaration).toBe(
      "not-declared"
    );
    expect(built.summary.declaredOffOnly).toBe(1);
    expect(built.summary.governedBySettings).toBe(0);
  });
});

describe("command provenance", () => {
  it("distinguishes all four sources", async () => {
    const built = await reportFor({
      config: {
        gates: {
          "coverage-adequacy": { run: COVERAGE_TASK, push: "required" },
          "code-style": { commit: { level: "required", run: "lint:staged" } },
          traceability: { push: "required", "pull-request": "required" },
        },
      },
    });
    expect(cell(built, "code-style", "commit").provenance).toBe("moment-run");
    expect(cell(built, "coverage-adequacy", PUSH).provenance).toBe("gate-run");
    expect(cell(built, "traceability", PUSH).provenance).toBe(
      "registry-task-at"
    );
    expect(cell(built, "traceability", PUSH).task).toBe("check:work-item:push");
    expect(cell(built, "traceability", PULL_REQUEST).provenance).toBe(
      "registry-task"
    );
  });

  it("lets a per-moment run beat a gate-level run on the same gate", async () => {
    const built = await reportFor({
      config: {
        gates: {
          [TEST_CORRECTNESS]: {
            run: COVERAGE_TASK,
            push: { level: "required", run: "test:unit:fast" },
            "pull-request": "required",
          },
        },
      },
    });
    const push = cell(built, TEST_CORRECTNESS, PUSH);
    expect(push.provenance).toBe("moment-run");
    expect(push.task).toBe("test:unit:fast");
    const pullRequest = cell(built, TEST_CORRECTNESS, PULL_REQUEST);
    expect(pullRequest.provenance).toBe("gate-run");
    expect(pullRequest.task).toBe(COVERAGE_TASK);
    expect(row(built, TEST_CORRECTNESS).projectTask).toBe(COVERAGE_TASK);
  });
});

describe("the moment axis", () => {
  it("renders the project's own environments and never a bare deploy", async () => {
    const built = await reportFor({
      config: {
        gates: {
          "runtime-web-vulnerability": { "pre-deploy:staging": "required" },
          "e2e-browser": { "continuous:production": "optional" },
        },
      },
    });
    // The fixed moments come from the registry, not from a list retyped here:
    // the axis grew by one when the agent tool boundary was split into
    // `pre-tool` and `post-tool`, and a literal would have had to be edited to
    // match — an edit indistinguishable from the axis losing a column.
    expect(built.momentAxis).toEqual([
      ...MOMENTS,
      "continuous:production",
      "pre-deploy:staging",
    ]);
    expect(built.momentAxis).not.toContain("deploy");
    expect(
      cell(built, "runtime-web-vulnerability", "pre-deploy:staging").declaration
    ).toBe("required");
  });
});

describe("the registry", () => {
  it("is read from the running Lisa package, not the project's stale copy", async () => {
    const projectRoot = await makeProject({ config: {} });
    await mkdir(path.join(projectRoot, "scripts"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "scripts", "lisa-gates.mjs"),
      "export const REGISTRY = {};\n",
      "utf8"
    );
    const built = await buildGateReport({ projectRoot, offline: true });
    expect(built.gates).toHaveLength(GATE_COUNT);
    expect(built.registrySource).toEqual({
      state: "verified",
      value: "lisa-package",
    });
  });
});

describe("an unreadable configuration", () => {
  it("states the problem instead of reading as a project that declared nothing", async () => {
    const built = await reportFor({ config: { gates: { runner: ":" } } });
    expect(built.runner.state).toBe("unknown");
    expect(built.runnerSource).toBe("unknown");
    expect(built.declarationProblems.length).toBeGreaterThan(0);
    expect(built.summary.buckets.A).toBe(0);
  });

  it("reports an illegal moment key as a problem", async () => {
    const built = await reportFor({
      config: { gates: { [TYPE_CORRECTNESS]: { deploy: "required" } } },
    });
    expect(built.declarationProblems.join(" ")).toContain("deploy");
  });
});

describe("determinism", () => {
  it("emits byte-identical output for an unchanged project", async () => {
    const projectRoot = await makeProject({
      config: { gates: { [TYPE_CORRECTNESS]: { push: "required" } } },
      hooks: { "pre-push": shippedPrePush([TYPE_CORRECTNESS]) },
      scripts: { [TYPECHECK]: TYPECHECK_SCRIPT },
    });
    const options = { projectRoot, offline: true };
    const first = JSON.stringify(await buildGateReport(options));
    const second = JSON.stringify(await buildGateReport(options));
    expect(first).toBe(second);
  });
});
