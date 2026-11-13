/**
 * A repo's setup gap is remembered across cycles (lisa#4820).
 *
 * When `spawn` exits 2 because a worker could not start in a repo (its first
 * prompt never ran, or the workspace is not trusted), it records the gap per
 * repo in the ledger control block. Until the operator runs
 * `ledger clear-setup-gap <repo>`, `queue` leaves that repo's items out and
 * says why once, and `spawn` refuses the repo without launching a worker or
 * counting an attempt. Other repos are unaffected.
 * @module tests/unit/session-manager/cli-setup-gap-persist
 */
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  MEMINFO,
  type Sandbox,
  makeSandbox,
  removeSandboxes,
  runCli,
} from "./support/cli-harness.js";
import {
  callsOf,
  plantTranscript,
  readLedgerFile,
} from "./support/cli-fixtures.js";
import { linearNode, offered, queue } from "./support/setup-gap-queue.js";

afterEach(removeSandboxes);

const MEM = ["--meminfo", MEMINFO];
const UNKNOWN = "unknown-command";
const IMPLEMENT = "/lisa:implement";
const CLEAR = ["ledger", "clear-setup-gap"];

/**
 * A multi-repo sandbox (api, web) whose `api` repo already hit a first-prompt
 * setup gap on `spawn API-1 --repo api`.
 * @returns The sandbox
 */
function multiRepoWithApiGap(): Sandbox {
  const sandbox = makeSandbox({ repos: ["api", "web"] });
  plantTranscript(sandbox, UNKNOWN, {
    cwd: path.join(sandbox.root, "projects/api"),
  });
  if (
    runCli(sandbox, ["spawn", "API-1", "--repo", "api", ...MEM]).status !== 2
  ) {
    throw new Error("expected spawn to exit 2 on the planted setup gap");
  }
  return sandbox;
}

describe("a setup gap is remembered across cycles", () => {
  it("records the gap under the repo key when spawn exits 2", () => {
    const sandbox = multiRepoWithApiGap();
    const ledger = readLedgerFile(sandbox);
    expect(ledger.items).toEqual({});
    expect(ledger.control.setupGaps.api).toMatchObject({
      kind: UNKNOWN,
      detail: IMPLEMENT,
      at: expect.any(String),
    });
  });

  it("queue leaves out the gap repo's items and names the repo and reason", () => {
    const sandbox = multiRepoWithApiGap();
    const json = queue(sandbox, [
      linearNode("API-1", "api"),
      linearNode("API-2", "api"),
      linearNode("WEB-1", "web"),
    ]);
    expect(offered(json)).toEqual(["WEB-1"]);
    expect(json.excluded).toEqual(
      expect.arrayContaining([
        { ref: "API-1", reason: "setup-gap:api" },
        { ref: "API-2", reason: "setup-gap:api" },
      ])
    );
    expect(json.setupGaps).toEqual([
      expect.objectContaining({
        repo: "api",
        kind: UNKNOWN,
        detail: IMPLEMENT,
        clear: "ledger clear-setup-gap api",
      }),
    ]);
  });

  it("queue on a single-repo project leaves out every item while the root has a gap", () => {
    const sandbox = makeSandbox();
    plantTranscript(sandbox, UNKNOWN);
    const first = runCli(sandbox, ["spawn", "DEMO-1", ...MEM]);
    expect(first.status).toBe(2);
    expect(first.json).toMatchObject({ repo: ".", setupGapStatus: "recorded" });
    const json = queue(sandbox, [
      linearNode("DEMO-1", null),
      linearNode("DEMO-2", null),
    ]);
    expect(offered(json)).toEqual([]);
    expect(json.excluded).toEqual(
      expect.arrayContaining([
        { ref: "DEMO-1", reason: "setup-gap:." },
        { ref: "DEMO-2", reason: "setup-gap:." },
      ])
    );
    expect(json.setupGaps[0]).toMatchObject({
      repo: ".",
      clear: "ledger clear-setup-gap .",
    });
  });

  it("queue reports no setup gaps when none is recorded", () => {
    const sandbox = makeSandbox();
    const json = queue(sandbox, [linearNode("DEMO-1", null)]);
    expect(offered(json)).toEqual(["DEMO-1"]);
    expect(json.setupGaps).toEqual([]);
  });
});

describe("spawn refuses a repo with a recorded gap", () => {
  it("exits 2 without launching a worker or recording an attempt, naming the reason and the clear command", () => {
    const sandbox = multiRepoWithApiGap();
    const result = runCli(sandbox, ["spawn", "API-2", "--repo", "api", ...MEM]);
    expect(result.status).toBe(2);
    expect(callsOf(result.calls, "claude", "--bg")).toEqual([]);
    expect(result.stderr).toContain(UNKNOWN);
    expect(result.stderr).toContain(IMPLEMENT);
    expect(result.stderr).toContain("ledger clear-setup-gap api");
    expect(result.json).toMatchObject({
      repo: "api",
      setupGapStatus: "already-recorded",
    });
    expect(readLedgerFile(sandbox).items).toEqual({});
  });

  it("refuses an untrusted-workspace gap the same way", () => {
    const sandbox = makeSandbox();
    const first = runCli(sandbox, ["spawn", "DEMO-1", ...MEM], {
      env: { STUB_BG_EXIT: "1", STUB_BG_STDERR: "Workspace not trusted.\n" },
    });
    expect(first.status).toBe(2);
    expect(first.json.setupGapStatus).toBe("recorded");
    const again = runCli(sandbox, ["spawn", "DEMO-2", ...MEM]);
    expect(again.status).toBe(2);
    expect(callsOf(again.calls, "claude", "--bg")).toEqual([]);
    expect(again.stderr).toContain("untrusted-workspace");
    expect(again.stderr).toContain("ledger clear-setup-gap .");
  });
});

describe("clearing the gap resumes dispatch", () => {
  it("queue offers the repo's items again and spawn launches a worker", () => {
    const sandbox = multiRepoWithApiGap();
    const cleared = runCli(sandbox, [...CLEAR, "api"]);
    expect(cleared.status).toBe(0);
    expect(cleared.json).toEqual({ repo: "api", cleared: true });
    expect(readLedgerFile(sandbox).control.setupGaps).toEqual({});
    const json = queue(sandbox, [linearNode("API-1", "api")]);
    expect(offered(json)).toEqual(["API-1"]);
    expect(json.setupGaps).toEqual([]);
    plantTranscript(sandbox, "healthy", {
      cwd: path.join(sandbox.root, "projects/api"),
    });
    const spawned = runCli(sandbox, [
      "spawn",
      "API-1",
      "--repo",
      "api",
      ...MEM,
    ]);
    expect(spawned.status).toBe(0);
    expect(callsOf(spawned.calls, "claude", "--bg")).toHaveLength(1);
    expect(readLedgerFile(sandbox).items["API-1"].attempts).toBe(1);
  });

  it("reports cleared false for a repo with no recorded gap", () => {
    const sandbox = makeSandbox({ repos: ["api"] });
    const result = runCli(sandbox, [...CLEAR, "api"]);
    expect(result.status).toBe(0);
    expect(result.json).toEqual({ repo: "api", cleared: false });
  });
});

describe("other repositories are unaffected", () => {
  it("queue still offers another repo's items and unlabelled items", () => {
    const sandbox = multiRepoWithApiGap();
    const json = queue(sandbox, [
      linearNode("API-1", "api"),
      linearNode("WEB-1", "web"),
      linearNode("NEW-1", null),
    ]);
    expect(offered(json).sort((a, b) => a.localeCompare(b))).toEqual([
      "NEW-1",
      "WEB-1",
    ]);
  });

  it("spawn still launches a worker in another repo", () => {
    const sandbox = multiRepoWithApiGap();
    const result = runCli(sandbox, ["spawn", "WEB-1", "--repo", "web", ...MEM]);
    expect(result.status).toBe(0);
    expect(callsOf(result.calls, "claude", "--bg")).toHaveLength(1);
    expect(readLedgerFile(sandbox).control.setupGaps.api).toBeDefined();
  });
});
