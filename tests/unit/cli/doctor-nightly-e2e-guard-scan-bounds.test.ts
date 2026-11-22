/**
 * Scanner contract for the nightly-e2e guard doctor check: availability and traversal bounds.
 *
 * Shared fixtures and the rationale for their generic workflow names live in
 * `doctor-nightly-e2e-guard-scan-fixtures.ts`.
 * @module tests/unit/cli/doctor-nightly-e2e-guard-scan-bounds.test
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_NIGHTLY_GUARD_CALLERS,
  MAX_NIGHTLY_GUARD_FILES,
  MAX_NIGHTLY_GUARD_TARGETS,
  scanNightlyE2eGuardCallers,
} from "../../../src/cli/doctor-nightly-e2e-guard-scan.js";
import {
  ACTIVE_NAME,
  SHARED_REFERENCE,
  WORKFLOW_DIRECTORY_PREFIX,
  directCaller,
  writeWorkflow,
} from "./doctor-nightly-e2e-guard-scan-fixtures.js";
import { createSymlink } from "../../support/borrowed-node-modules.mjs";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(
    path.join(os.tmpdir(), WORKFLOW_DIRECTORY_PREFIX)
  );
  await mkdir(path.join(projectRoot, ".github", "workflows"), {
    recursive: true,
  });
});

afterEach(async () => {
  await rm(projectRoot, { force: true, recursive: true });
});

/**
 * Write one workflow fixture into the current temporary project.
 * @param name - File name beneath `.github/workflows`
 * @param source - Complete YAML document
 * @returns Resolves once the file is written
 */
const workflow = (name: string, source: string): Promise<void> =>
  writeWorkflow(projectRoot, name, source);

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
    createSymlink(
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
    createSymlink(external, path.join(projectRoot, ".github", "workflows"));

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
