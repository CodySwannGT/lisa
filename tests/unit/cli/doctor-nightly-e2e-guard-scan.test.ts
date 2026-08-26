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
import {
  chmod,
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
const SHARED_REFERENCE = "./.github/workflows/shared.yml";
const SHARED_NAME = "shared.yml";
const SHARED_WORKFLOW = `.github/workflows/${SHARED_NAME}`;
const RUNS_ON_LINE = "    runs-on: ubuntu-latest";
const BYPASS_ENV_MAPPING =
  "    env:\n      GATE_BYPASS: ${{ contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}\n";

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
          callPath: `${ACTIVE_WORKFLOW}#gate`,
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

  it.each([
    ['node "scripts/check-nightly-e2e-health.mjs"', "double quoted"],
    ["node 'scripts/check-nightly-e2e-health.mjs'", "single quoted"],
  ])("accepts a safely %s literal direct target", async (run, _label) => {
    await workflow(ACTIVE_NAME, directCaller(CANONICAL_GUARD, run));

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
    uses: ${SHARED_REFERENCE}
`
    );
    await workflow(
      SHARED_NAME,
      directCaller().replace(PULL_REQUEST_TRIGGER, WORKFLOW_CALL_TRIGGER)
    );

    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result).toMatchObject({
      state: "ok",
      callers: [{ workflow: SHARED_WORKFLOW, target: CANONICAL_GUARD }],
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

  it("preserves both root-to-job paths when two active roots share one reusable", async () => {
    for (const root of ["root-a.yml", "root-b.yml"] as const) {
      await workflow(
        root,
        `
'on': [pull_request]
jobs:
  call:
    uses: ${SHARED_REFERENCE}
`
      );
    }
    await workflow(
      SHARED_NAME,
      directCaller().replace(PULL_REQUEST_TRIGGER, WORKFLOW_CALL_TRIGGER)
    );

    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result).toMatchObject({
      state: "ok",
      callers: [
        {
          callPath: `.github/workflows/root-a.yml#call -> ${SHARED_WORKFLOW}#gate`,
          target: CANONICAL_GUARD,
        },
        {
          callPath: `.github/workflows/root-b.yml#call -> ${SHARED_WORKFLOW}#gate`,
          target: CANONICAL_GUARD,
        },
      ],
    });
  });

  it("ignores an unrelated remote action with a similar nightly name", async () => {
    await workflow(
      ACTIVE_NAME,
      `
'on': [pull_request]
jobs:
  unrelated:
    uses: example/tools/.github/workflows/nightly-e2e-health.yml@v1
`
    );

    await expect(scanNightlyE2eGuardCallers(projectRoot)).resolves.toEqual({
      state: "ok",
      callers: [],
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

  it("rejects a single-quoted environment target because the shell keeps it literal", async () => {
    await unavailable(
      directCaller(CANONICAL_GUARD, "node '$GUARD'").replace(
        "    steps:",
        `      GUARD: ${CANONICAL_GUARD}\n    steps:`
      ),
      /single-quoted|literal.*\$GUARD|environment target/u
    );
  });

  it.each(["NIGHTLY_E2E_BYPASS", "Nightly.E2E-Bypass", "nightly e2e bypass"])(
    "normalizes the %s label comparison before rejecting a guard-skipping if",
    async label => {
      await unavailable(
        directCaller().replace(
          RUNS_ON_LINE,
          `    if: \${{ !contains(github.event.pull_request.labels.*.name, '${label}') }}\n    runs-on: ubuntu-latest`
        ),
        /if.*bypass|skip.*guard/u
      );
    }
  );

  it.each(["job", "step"])(
    "fails closed when a %s if condition can skip the guard by bypass label",
    async level => {
      const source =
        level === "job"
          ? directCaller().replace(
              RUNS_ON_LINE,
              "    if: ${{ !contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}\n    runs-on: ubuntu-latest"
            )
          : directCaller().replace(
              `      - run: node ${CANONICAL_GUARD}`,
              `      - if: \${{ !contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}\n        run: node ${CANONICAL_GUARD}`
            );
      await unavailable(source, /if.*bypass|skip.*guard/u);
    }
  );

  it("fails closed on constructed bypass-label logic around a guard", async () => {
    await unavailable(
      directCaller().replace(
        RUNS_ON_LINE,
        "    if: ${{ !contains(github.event.pull_request.labels.*.name, format('nightly-{0}-bypass', 'e2e')) }}\n    runs-on: ubuntu-latest"
      ),
      /if.*bypass|skip.*guard/u
    );
  });

  it.each([
    [
      "official reusable",
      `
'on': [pull_request]
jobs:
  gate:
    if: \${{ !contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}
    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@main
`,
    ],
    [
      "local reusable",
      `
'on': [pull_request]
jobs:
  gate:
    if: \${{ !contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}
    uses: ${SHARED_REFERENCE}
`,
    ],
  ])(
    "fails closed when an %s job-level if can skip guard invocation",
    async (_label, source) => {
      await unavailable(source, /if.*bypass|skip.*guard/u);
    }
  );

  it("fails closed on dynamic inline GATE_BYPASS wiring", async () => {
    await unavailable(
      directCaller()
        .replace(BYPASS_ENV_MAPPING, "")
        .replace(
          `node ${CANONICAL_GUARD}`,
          `GATE_BYPASS=\${{ contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }} node ${CANONICAL_GUARD}`
        ),
      /inline|GATE_BYPASS|unsupported/u
    );
  });

  it.each(["nightly-e2e-bypass", "NIGHTLY_E2E_BYPASS"])(
    "fails closed on quoted env-command bypass wiring for %s",
    async label => {
      await unavailable(
        directCaller()
          .replace(BYPASS_ENV_MAPPING, "")
          .replace(
            `node ${CANONICAL_GUARD}`,
            `env "GATE_BYPASS=\${{ contains(github.event.pull_request.labels.*.name, '${label}') }}" node ${CANONICAL_GUARD}`
          ),
        /inline|env.*GATE_BYPASS|unsupported/u
      );
    }
  );

  it("fails closed when a quoted bypass expression is written to GITHUB_ENV before the guard", async () => {
    await unavailable(
      directCaller()
        .replace(BYPASS_ENV_MAPPING, "")
        .replace(
          `      - run: node ${CANONICAL_GUARD}`,
          `      - run: echo "GATE_BYPASS=\${{ contains(github.event.pull_request.labels.*.name, 'Nightly_E2E.Bypass') }}" >> "$GITHUB_ENV"\n      - run: node ${CANONICAL_GUARD}`
        ),
      /GITHUB_ENV|indirect|unsupported/u
    );
  });

  it("strips shell comments before looking for bypass wiring", async () => {
    await workflow(
      ACTIVE_NAME,
      `
'on': [pull_request]
jobs:
  ordinary:
    runs-on: ubuntu-latest
    steps:
      - run: |
          node scripts/ordinary.mjs # GATE_BYPASS=not-executable
`
    );

    await expect(scanNightlyE2eGuardCallers(projectRoot)).resolves.toEqual({
      state: "ok",
      callers: [],
    });
  });

  it("accepts a supported guard command with a trailing shell comment", async () => {
    await workflow(
      ACTIVE_NAME,
      directCaller().replace(
        `      - run: node ${CANONICAL_GUARD}`,
        `      - run: |\n          node ${CANONICAL_GUARD} # audit note`
      )
    );

    await expect(
      scanNightlyE2eGuardCallers(projectRoot)
    ).resolves.toMatchObject({
      state: "ok",
      callers: [{ target: CANONICAL_GUARD }],
    });
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
    const outside = path.join(projectRoot, "outside.yml");
    await writeFile(outside, directCaller());
    await symlink(
      outside,
      path.join(projectRoot, ".github", "workflows", ACTIVE_NAME)
    );
    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result.state).toBe("unavailable");
  });

  it("fails unavailable when the workflows directory itself is a symlink", async () => {
    const external = await mkdtemp(
      path.join(os.tmpdir(), "lisa-nightly-workflows-")
    );
    await writeFile(path.join(external, ACTIVE_NAME), directCaller());
    await rm(path.join(projectRoot, ".github", "workflows"), {
      recursive: true,
    });
    await symlink(external, path.join(projectRoot, ".github", "workflows"));

    const result = await scanNightlyE2eGuardCallers(projectRoot);
    await rm(external, { force: true, recursive: true });
    expect(result).toMatchObject({
      state: "unavailable",
      failures: [{ reason: expect.stringMatching(/symlink/u) }],
    });
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
    uses: ${SHARED_REFERENCE}
`
    );
    await workflow(
      "shared.yml",
      `
'on': [workflow_call]
jobs:
  call:
    uses: ${SHARED_REFERENCE}
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

  it("rejects an oversized job identifier without reflecting its bytes", async () => {
    const huge = `gate_${"x".repeat(200)}`;
    await workflow(
      ACTIVE_NAME,
      `'on': [pull_request]\njobs:\n  ${huge}:\n    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@main\n`
    );
    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result).toMatchObject({
      state: "unavailable",
      failures: [{ reason: expect.stringMatching(/job identifier.*limit/u) }],
    });
    expect(JSON.stringify(result)).not.toContain(huge);
  });

  it("rejects aggregate caller attribution before 64 long roots amplify output", async () => {
    for (let index = 0; index < MAX_NIGHTLY_GUARD_CALLERS; index += 1) {
      const suffix = `${index}`.padStart(2, "0");
      await workflow(
        `root-${suffix}-${"w".repeat(48)}.yml`,
        `'on': [pull_request]\njobs:\n  gate_${suffix}_${"j".repeat(48)}:\n    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@main\n`
      );
    }
    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result).toMatchObject({
      state: "unavailable",
      failures: [
        {
          workflow: ".github/workflows",
          reason: expect.stringMatching(/caller attribution.*byte limit/u),
        },
      ],
    });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(1024);
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
