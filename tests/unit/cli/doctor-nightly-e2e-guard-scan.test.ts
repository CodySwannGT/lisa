/**
 * Scanner contract for the nightly-e2e guard doctor check.
 *
 * These fixtures deliberately keep workflow names generic. The production
 * scanner has to follow executable YAML and local-call reachability; filenames,
 * comments, dead reusable definitions, and a conveniently present canonical
 * script are not evidence about the guard an active caller actually runs.
 * @module tests/unit/cli/doctor-nightly-e2e-guard-scan.test
 */
/* eslint-disable max-lines -- the scanner's hostile syntax and every independent bound stay in one fixture matrix */
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_NIGHTLY_GUARD_CALLERS,
  MAX_NIGHTLY_GUARD_FILES,
  MAX_NIGHTLY_GUARD_TARGETS,
  scanNightlyE2eGuardCallers,
} from "../../../src/cli/doctor-nightly-e2e-guard-scan.js";

const CANONICAL_GUARD = "scripts/check-nightly-e2e-health.mjs";
const OFF_PATH_GUARD = "scripts/custom-nightly-gate.mjs";
const ACTIVE_WORKFLOW = ".github/workflows/active.yml";
const ACTIVE_NAME = "active.yml";
const PULL_REQUEST_TRIGGER = "'on':\n  pull_request:";
const WORKFLOW_CALL_TRIGGER = "'on':\n  workflow_call:";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lisa-nightly-scan-"));
  await mkdir(path.join(projectRoot, ".github", "workflows"), {
    recursive: true,
  });
});

afterEach(async () => {
  await rm(projectRoot, { force: true, recursive: true });
});

/**
 * Write one workflow fixture.
 * @param name - File name beneath `.github/workflows`
 * @param source - Complete YAML document
 */
async function workflow(name: string, source: string): Promise<void> {
  await writeFile(path.join(projectRoot, ".github", "workflows", name), source);
}

/**
 * Build an active direct caller whose bypass is an executable environment field.
 * @param target - Literal guard path used by the job
 * @param run - Complete run command when a hostile form is under test
 * @returns Complete workflow YAML
 */
const directCaller = (
  target = CANONICAL_GUARD,
  run = `node ${target}`
): string => `
name: Active gate
'on':
  pull_request:
jobs:
  gate:
    runs-on: ubuntu-latest
    env:
      GATE_BYPASS: \${{ contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}
    steps:
      - run: ${run}
`;

describe("nightly guard scanner: actual active target", () => {
  it("AC1 resolves the official reusable endpoint's canonical default", async () => {
    await workflow(
      ACTIVE_NAME,
      `
name: Active reusable gate
'on': [pull_request]
jobs:
  gate:
    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@v4
`
    );

    await expect(scanNightlyE2eGuardCallers(projectRoot)).resolves.toEqual({
      state: "ok",
      callers: [
        {
          workflow: ACTIVE_WORKFLOW,
          job: "gate",
          kind: "official-reusable",
          target: CANONICAL_GUARD,
        },
      ],
    });
  });

  it("resolves a literal official guard_script override", async () => {
    await workflow(
      ACTIVE_NAME,
      `
'on': [pull_request]
jobs:
  gate:
    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@main
    with:
      guard_script: ${OFF_PATH_GUARD}
`
    );

    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result).toMatchObject({
      state: "ok",
      callers: [{ target: OFF_PATH_GUARD }],
    });
  });

  it("AC2 follows the active renamed target instead of a dead canonical copy", async () => {
    await workflow(ACTIVE_NAME, directCaller(OFF_PATH_GUARD));
    await writeFile(path.join(projectRoot, CANONICAL_GUARD), "unused", {
      flag: "a",
    }).catch(async () => {
      await mkdir(path.join(projectRoot, "scripts"), { recursive: true });
      await writeFile(path.join(projectRoot, CANONICAL_GUARD), "unused");
    });

    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result).toMatchObject({
      state: "ok",
      callers: [{ workflow: ACTIVE_WORKFLOW, target: OFF_PATH_GUARD }],
    });
  });

  it("AC4 supports a one-level literal environment path without changing the caller shape", async () => {
    await workflow(
      ACTIVE_NAME,
      directCaller(CANONICAL_GUARD, 'node "$GUARD"').replace(
        "    steps:",
        `      GUARD: ${CANONICAL_GUARD}\n    steps:`
      )
    );

    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result).toMatchObject({
      state: "ok",
      callers: [{ kind: "direct", target: CANONICAL_GUARD }],
    });
  });

  it("recognizes a literal direct guard from the bypass-label executable field", async () => {
    await workflow(
      ACTIVE_NAME,
      directCaller().replace(
        "GATE_BYPASS: ${{ contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}",
        "NIGHTLY_BYPASS_LABEL: ${{ inputs.bypass_label }}"
      )
    );

    await expect(
      scanNightlyE2eGuardCallers(projectRoot)
    ).resolves.toMatchObject({
      state: "ok",
      callers: [{ kind: "direct", target: CANONICAL_GUARD }],
    });
  });

  it("normalizes a conventional leading-dot relative target", async () => {
    await workflow(ACTIVE_NAME, directCaller(`./${CANONICAL_GUARD}`));

    await expect(
      scanNightlyE2eGuardCallers(projectRoot)
    ).resolves.toMatchObject({
      state: "ok",
      callers: [{ kind: "direct", target: CANONICAL_GUARD }],
    });
  });
});
describe("nightly guard scanner: reachability and negatives", () => {
  it("follows reachable local reusable workflows", async () => {
    await workflow(
      "root.yml",
      `
'on': [pull_request]
jobs:
  call:
    uses: ./.github/workflows/shared.yml
`
    );
    await workflow(
      "shared.yml",
      directCaller().replace(PULL_REQUEST_TRIGGER, WORKFLOW_CALL_TRIGGER)
    );

    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result).toMatchObject({
      state: "ok",
      callers: [
        { workflow: ".github/workflows/shared.yml", target: CANONICAL_GUARD },
      ],
    });
  });

  it("traverses a local reusable whose filename matches the official endpoint", async () => {
    await workflow(
      "root.yml",
      `
'on': [pull_request]
jobs:
  call:
    uses: ./.github/workflows/nightly-e2e-health.yml
`
    );
    await workflow(
      "nightly-e2e-health.yml",
      directCaller().replace(PULL_REQUEST_TRIGGER, WORKFLOW_CALL_TRIGGER)
    );

    await expect(
      scanNightlyE2eGuardCallers(projectRoot)
    ).resolves.toMatchObject({
      state: "ok",
      callers: [
        {
          workflow: ".github/workflows/nightly-e2e-health.yml",
          target: CANONICAL_GUARD,
        },
      ],
    });
  });

  it("AC5 reports a determinate zero for ordinary workflows", async () => {
    await workflow(
      "ordinary.yml",
      `
'on': [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
`
    );

    await expect(scanNightlyE2eGuardCallers(projectRoot)).resolves.toEqual({
      state: "ok",
      callers: [],
    });
  });

  it("ignores comments, reporting, reaper, and unused reusable definitions", async () => {
    await workflow(
      ACTIVE_NAME,
      `
# GATE_BYPASS: node scripts/comment-only.mjs
'on': [pull_request]
jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - env:
          GATE_BYPASS: false
        run: node scripts/report.mjs --report-issues
  reaper:
    runs-on: ubuntu-latest
    steps:
      - run: gh pr edit --remove-label nightly-e2e-bypass
`
    );
    await workflow(
      "unused.yml",
      directCaller().replace(PULL_REQUEST_TRIGGER, WORKFLOW_CALL_TRIGGER)
    );

    await expect(scanNightlyE2eGuardCallers(projectRoot)).resolves.toEqual({
      state: "ok",
      callers: [],
    });
  });

  it("AC7 never treats a reaper as guard proof", async () => {
    await workflow("gate.yml", directCaller(OFF_PATH_GUARD));
    await workflow(
      "reaper.yml",
      `
'on':
  pull_request_target:
    types: [closed]
jobs:
  reaper:
    runs-on: ubuntu-latest
    steps:
      - run: gh pr edit --remove-label nightly-e2e-bypass
`
    );

    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result).toMatchObject({
      state: "ok",
      callers: [{ target: OFF_PATH_GUARD }],
    });
    expect(result.state === "ok" && result.callers).toHaveLength(1);
  });
});

describe("nightly guard scanner: fail-closed syntax", () => {
  const unavailable = async (source: string, reason: RegExp): Promise<void> => {
    await workflow(ACTIVE_NAME, source);
    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result.state).toBe("unavailable");
    expect(result).toMatchObject({ failures: expect.any(Array) });
    expect(
      result.state === "unavailable"
        ? result.failures.map(failure => failure.reason).join("\n")
        : ""
    ).toMatch(reason);
  };

  it("rejects an official guard_script expression", async () => {
    await unavailable(
      `
'on': [pull_request]
jobs:
  gate:
    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@main
    with:
      guard_script: \${{ inputs.guard }}
`,
      /literal/u
    );
  });

  it("rejects a dynamic official reusable reference", async () => {
    await unavailable(
      `
'on': [pull_request]
jobs:
  gate:
    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@\${{ inputs.ref }}
`,
      /official reusable reference|static literal/u
    );
  });

  it.each([
    ["dynamic expression", "node ${{ env.GUARD }}"],
    ["command substitution", "node $(printf scripts/guard.mjs)"],
    ["absolute path", "node /tmp/guard.mjs"],
    ["escaping path", "node ../guard.mjs"],
    ["multiple commands", "node scripts/guard.mjs && echo done"],
    ["unsupported extension", "node scripts/guard.ts"],
  ])("rejects %s in a bypass-bearing direct caller", async (_label, run) => {
    await unavailable(
      directCaller(CANONICAL_GUARD, run),
      /unsupported|relative|literal/u
    );
  });

  it("rejects an unresolved one-level environment path", async () => {
    await unavailable(
      directCaller(CANONICAL_GUARD, 'node "$GUARD"'),
      /GUARD|resolve/u
    );
  });

  it("fails closed when a bypass-bearing job has no supported Node target", async () => {
    await unavailable(
      directCaller().replace(`node ${CANONICAL_GUARD}`, "bash scripts/gate.sh"),
      /Node guard target|unsupported/u
    );
  });

  it("rejects ambiguous direct targets", async () => {
    await unavailable(
      directCaller().replace(
        `      - run: node ${CANONICAL_GUARD}`,
        `      - run: node ${CANONICAL_GUARD}\n      - run: node ${OFF_PATH_GUARD}`
      ),
      /ambiguous|multiple/u
    );
  });

  it("uses explicit ASCII path predicates", async () => {
    await unavailable(directCaller("scripts/guéard.mjs"), /ASCII|unsupported/u);
  });
});

describe("nightly guard scanner: availability and traversal bounds", () => {
  it("treats a missing workflow directory as a readable determinate zero", async () => {
    await rm(path.join(projectRoot, ".github"), { recursive: true });
    await expect(scanNightlyE2eGuardCallers(projectRoot)).resolves.toEqual({
      state: "ok",
      callers: [],
    });
  });

  it("treats an empty workflow directory as a readable determinate zero", async () => {
    await expect(scanNightlyE2eGuardCallers(projectRoot)).resolves.toEqual({
      state: "ok",
      callers: [],
    });
  });

  it("fails unavailable on malformed YAML", async () => {
    await workflow(ACTIVE_NAME, "'on': [pull_request\njobs: [");
    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result.state).toBe("unavailable");
  });

  it("fails unavailable when a workflow YAML root is not a mapping", async () => {
    await workflow(ACTIVE_NAME, "- pull_request\n");
    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result).toMatchObject({
      state: "unavailable",
      failures: [{ reason: expect.stringMatching(/root.*mapping/u) }],
    });
  });

  it("fails unavailable on an unreadable workflow", async () => {
    const absolute = path.join(
      projectRoot,
      ".github",
      "workflows",
      ACTIVE_NAME
    );
    await workflow(ACTIVE_NAME, directCaller());
    await chmod(absolute, 0o000);
    const result = await scanNightlyE2eGuardCallers(projectRoot);
    await chmod(absolute, 0o600);
    expect(result.state).toBe("unavailable");
  });

  it("fails explicitly when one workflow exceeds 1 MiB", async () => {
    await workflow(ACTIVE_NAME, "x".repeat(1024 * 1024 + 1));
    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result.state).toBe("unavailable");
    expect(
      result.state === "unavailable" ? result.failures[0]?.reason : ""
    ).toContain("1 MiB");
  });

  it("fails explicitly when readable workflows exceed 8 MiB together", async () => {
    const prefix = "'on': [workflow_call]\njobs: {}\n#";
    const source = prefix + "x".repeat(1024 * 1024 - prefix.length);
    for (let index = 0; index < 9; index += 1) {
      await workflow(`large-${index}.yml`, source);
    }
    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result.state).toBe("unavailable");
    expect(
      result.state === "unavailable" ? result.failures[0]?.reason : ""
    ).toContain("8 MiB");
  });

  it("fails unavailable on a symlinked workflow", async () => {
    const { symlink } = await import("node:fs/promises");
    const outside = path.join(projectRoot, "outside.yml");
    await writeFile(outside, directCaller());
    await symlink(
      outside,
      path.join(projectRoot, ".github", "workflows", ACTIVE_NAME)
    );
    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result.state).toBe("unavailable");
  });

  it("fails unavailable on a non-regular workflow entry", async () => {
    await mkdir(
      path.join(projectRoot, ".github", "workflows", "directory.yml")
    );
    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result).toMatchObject({
      state: "unavailable",
      failures: [{ reason: expect.stringMatching(/regular/u) }],
    });
  });

  it("fails on a reachable local workflow cycle", async () => {
    await workflow(
      "root.yml",
      `
'on': [pull_request]
jobs:
  call:
    uses: ./.github/workflows/shared.yml
`
    );
    await workflow(
      "shared.yml",
      `
'on': [workflow_call]
jobs:
  call:
    uses: ./.github/workflows/shared.yml
`
    );
    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result.state).toBe("unavailable");
    expect(
      result.state === "unavailable" ? result.failures[0]?.reason : ""
    ).toMatch(/cycle/u);
  });

  it("fails on a missing reachable local reusable", async () => {
    await workflow(
      "root.yml",
      `
'on': [pull_request]
jobs:
  call:
    uses: ./.github/workflows/missing.yml
`
    );
    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result.state).toBe("unavailable");
    expect(
      result.state === "unavailable" ? result.failures[0]?.reason : ""
    ).toMatch(/missing|unresolved/u);
  });

  it("rejects a reachable local reusable outside the supported root shape", async () => {
    await workflow(
      "root.yml",
      `
'on': [pull_request]
jobs:
  nested:
    uses: ./.github/workflows/nested/shared.yml
`
    );
    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result).toMatchObject({
      state: "unavailable",
      failures: [{ reason: expect.stringMatching(/unsupported|escapes/u) }],
    });
  });

  it("fails when reachable local workflow depth exceeds eight", async () => {
    for (let index = 0; index <= 9; index += 1) {
      const root =
        index === 0 ? "'on': [pull_request]" : "'on': [workflow_call]";
      const next =
        index < 9
          ? `\n  call:\n    uses: ./.github/workflows/w${index + 1}.yml`
          : "";
      await workflow(`w${index}.yml`, `${root}\njobs:${next || " {}"}\n`);
    }
    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result.state).toBe("unavailable");
    expect(
      result.state === "unavailable"
        ? result.failures.map(failure => failure.reason).join(" ")
        : ""
    ).toMatch(/depth|8/u);
  });

  it("fails explicitly above the file-count bound", async () => {
    for (let index = 0; index <= MAX_NIGHTLY_GUARD_FILES; index += 1) {
      await workflow(
        `w${String(index).padStart(3, "0")}.yml`,
        "'on': [workflow_call]\njobs: {}\n"
      );
    }
    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result.state).toBe("unavailable");
    expect(
      result.state === "unavailable" ? result.failures[0]?.reason : ""
    ).toContain(String(MAX_NIGHTLY_GUARD_FILES));
  });

  it("fails explicitly above the caller-count bound", async () => {
    const jobs = Array.from(
      { length: MAX_NIGHTLY_GUARD_CALLERS + 1 },
      (_, index) => `
  gate_${index}:
    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@main`
    ).join("");
    await workflow(ACTIVE_NAME, `'on': [pull_request]\njobs:${jobs}\n`);
    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result.state).toBe("unavailable");
    expect(
      result.state === "unavailable" ? result.failures[0]?.reason : ""
    ).toContain(String(MAX_NIGHTLY_GUARD_CALLERS));
  });

  it("fails explicitly above the distinct-target bound", async () => {
    const jobs = Array.from(
      { length: MAX_NIGHTLY_GUARD_TARGETS + 1 },
      (_, index) => `
  gate_${index}:
    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@main
    with:
      guard_script: scripts/guard-${index}.mjs`
    ).join("");
    await workflow(ACTIVE_NAME, `'on': [pull_request]\njobs:${jobs}\n`);
    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result.state).toBe("unavailable");
    expect(
      result.state === "unavailable" ? result.failures[0]?.reason : ""
    ).toContain(String(MAX_NIGHTLY_GUARD_TARGETS));
  });
});
/* eslint-enable max-lines -- restore repository default */
