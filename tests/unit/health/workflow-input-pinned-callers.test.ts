/**
 * `lisa health`'s `ci.workflows` finding on pinned and unreadable callers
 * (CodySwannGT/lisa#4641).
 *
 * Lisa's pin step writes `uses: …@<sha> # v<version>`. The shared parser used
 * to skip that shape, so `inspectWorkflowInputs` found no callers on a pinned
 * host and `ci.workflows` reported a pass having compared nothing. These cases
 * run the real parser and finding against temporary Lisa and host roots:
 *   - a pinned caller with a stale input must FAIL, naming the input;
 *   - a Lisa caller line the parser cannot read must WARN, never pass.
 * @module tests/unit/health/workflow-input-pinned-callers
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { workflowFinding } from "../../../src/health/governance-probes.js";
import { inspectWorkflowInputs } from "../../../src/health/template-inspection.js";

const temporaryRoots: string[] = [];

/** The create-only template path the caller ships from. */
const TEMPLATE_CALLER = "typescript/create-only/.github/workflows/caller.yml";

/** Where the caller lands in the host project. */
const HOST_CALLER = ".github/workflows/caller.yml";

/** A reusable workflow declaring only `current_input`. */
const CONTRACT =
  "on:\n  workflow_call:\n    inputs:\n      current_input:\n        type: boolean\n";

/**
 * Create a temporary directory that is removed after each test.
 * @param prefix - Directory name prefix
 * @returns The canonical directory path
 */
async function temporaryRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  temporaryRoots.push(root);
  return root;
}

/**
 * Write a file, creating parent directories.
 * @param root - Base directory
 * @param relativePath - Path under `root`
 * @param content - File content
 */
async function write(
  root: string,
  relativePath: string,
  content: string
): Promise<void> {
  const destination = path.join(root, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

/**
 * Lay out a Lisa root shipping `caller` and a host carrying it verbatim.
 * @param caller - Caller workflow text
 * @returns The Lisa and host roots
 */
async function hostWithCaller(
  caller: string
): Promise<{ lisaRoot: string; projectRoot: string }> {
  const lisaRoot = await temporaryRoot("lisa-health-pinned-source-");
  const projectRoot = await temporaryRoot("lisa-health-pinned-host-");
  await write(lisaRoot, TEMPLATE_CALLER, caller);
  await write(lisaRoot, ".github/workflows/reusable.yml", CONTRACT);
  await write(projectRoot, HOST_CALLER, caller);
  return { lisaRoot, projectRoot };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(root => rm(root, { recursive: true, force: true }))
  );
});

describe("ci.workflows on pinned reusable-workflow callers", () => {
  const pinned = `jobs:\n  verify:\n    uses: CodySwannGT/lisa/.github/workflows/reusable.yml@35d0951f9250572d16872c36b242d679cbc22d72 # v4.87.7\n    with:\n      stale_input: true\n`;

  it("finds a stale input on a caller pinned with Lisa's version comment", async () => {
    const { lisaRoot, projectRoot } = await hostWithCaller(pinned);

    await expect(
      inspectWorkflowInputs(lisaRoot, projectRoot, ["typescript"])
    ).resolves.toEqual({
      stale: [".github/workflows/caller.yml#reusable.yml:stale_input"],
      unknown: [],
    });
  });

  it("fails ci.workflows naming the stale input on a pinned caller", async () => {
    const { lisaRoot, projectRoot } = await hostWithCaller(pinned);

    const finding = await workflowFinding(
      lisaRoot,
      projectRoot,
      ["typescript"],
      {}
    );

    expect(finding.status).toBe("fail");
    expect(finding.reason).toContain(
      ".github/workflows/caller.yml#reusable.yml:stale_input"
    );
  });
});

describe("ci.workflows on an unreadable Lisa caller", () => {
  const unreadable = `jobs:\n  verify:\n    uses: CodySwannGT/lisa/.github/workflows/reusable.yml\n    with:\n      stale_input: true\n`;

  it("reports the unreadable caller line as unknown", async () => {
    const { lisaRoot, projectRoot } = await hostWithCaller(unreadable);

    await expect(
      inspectWorkflowInputs(lisaRoot, projectRoot, ["typescript"])
    ).resolves.toEqual({
      stale: [],
      unknown: [".github/workflows/caller.yml line 3 (unreadable uses line)"],
    });
  });

  it("reports a flow-mapping Lisa caller as unknown", async () => {
    const { lisaRoot, projectRoot } = await hostWithCaller(
      "jobs:\n  verify: { uses: CodySwannGT/lisa/.github/workflows/reusable.yml@main }\n"
    );

    await expect(
      inspectWorkflowInputs(lisaRoot, projectRoot, ["typescript"])
    ).resolves.toEqual({
      stale: [],
      unknown: [".github/workflows/caller.yml line 2 (unreadable uses line)"],
    });
  });

  it("warns rather than passes", async () => {
    const { lisaRoot, projectRoot } = await hostWithCaller(unreadable);

    const finding = await workflowFinding(
      lisaRoot,
      projectRoot,
      ["typescript"],
      {}
    );

    expect(finding.status).toBe("warn");
    expect(finding.reason).toContain(
      ".github/workflows/caller.yml line 3 (unreadable uses line)"
    );
  });
});
