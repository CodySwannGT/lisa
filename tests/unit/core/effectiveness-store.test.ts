import { execFileSync, execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as atomicWriter from "../../../src/utils/atomic-file-write.js";
import {
  parseRecurrences,
  readEffectivenessReport,
  recordEffectiveness,
  recordRecurrence,
  RECURRENCE_LEDGER,
  type FailureRecurrence,
} from "../../../src/core/effectiveness-store.js";

const directories: string[] = [];
const PORCELAIN = "--porcelain";
const RECURRENCE: FailureRecurrence = {
  invariant: "Preserve every observed occurrence",
  surface: "ledger:recurrence",
  controlRef: "commit:control-1",
  controlShippedAt: "2026-09-10T00:00:00.000Z",
  occurrenceRef: "tracker:failure-1",
  occurredAt: "2026-09-16T00:00:00.000Z",
};
const OBSERVATION = {
  schema: 1,
  lisaVersion: "4.62.3",
  workerConfigRevision: null,
  feedbackMs: null,
  workerWallMs: null,
  workerSource: null,
  attention: [{ id: "comment-1", source: "tracker:comment-1" }],
  readyAt: "2026-09-15T00:00:00.000Z",
  acceptedAt: "2026-09-16T00:00:00.000Z",
  lifecycleSources: ["tracker:ready", "tracker:accepted"],
  reworkSources: null,
};

/**
 * Run Git inside an isolated test repository.
 * @param root - Fixture root
 * @param args - Git arguments
 * @returns Trimmed output
 */
function git(root: string, ...args: string[]) {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed git executable in an isolated fixture
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * Create a repository with the shipped storage configuration.
 * @returns Fixture root
 */
async function repository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lisa-effectiveness-"));
  directories.push(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.com");
  await writeFile(
    path.join(root, ".gitattributes"),
    `${RECURRENCE_LEDGER} merge=union\n`
  );
  await writeFile(path.join(root, ".gitignore"), ".lisa/effectiveness/\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "fixture");
  return root;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map(root => rm(root, { recursive: true, force: true }))
  );
});

describe("durable recurrence history", () => {
  it("preserves an external ledger replacement during atomic publication", async () => {
    const root = await repository();
    await recordRecurrence(root, RECURRENCE);
    const originalWriter = atomicWriter.writeFileAtomically;
    const external = `${JSON.stringify(RECURRENCE)}\n${JSON.stringify({ ...RECURRENCE, occurrenceRef: "tracker:external-merge" })}\n`;
    vi.spyOn(atomicWriter, "writeFileAtomically").mockImplementationOnce(
      async (target, content, options) => {
        await writeFile(target, external);
        return originalWriter(target, content, options);
      }
    );
    await expect(
      recordRecurrence(root, {
        ...RECURRENCE,
        occurrenceRef: "tracker:local-append",
      })
    ).rejects.toThrow("changed during write");
    expect(await readFile(path.join(root, RECURRENCE_LEDGER), "utf8")).toBe(
      external
    );
  });

  it("counts distinct occurrences and preserves bytes on replay", async () => {
    const root = await repository();
    expect(await recordRecurrence(root, RECURRENCE)).toBe(1);
    const before = await readFile(path.join(root, RECURRENCE_LEDGER), "utf8");
    expect(
      await recordRecurrence(root, {
        ...RECURRENCE,
        invariant: "  Preserve EVERY observed\noccurrence ",
      })
    ).toBe(1);
    expect(await readFile(path.join(root, RECURRENCE_LEDGER), "utf8")).toBe(
      before
    );
    expect(
      await recordRecurrence(root, {
        ...RECURRENCE,
        occurrenceRef: "tracker:failure-2",
      })
    ).toBe(2);
  });

  it("rejects pre-control failures and conflicting observations", async () => {
    const root = await repository();
    await expect(
      recordRecurrence(root, {
        ...RECURRENCE,
        occurredAt: RECURRENCE.controlShippedAt,
      })
    ).rejects.toThrow("after");
    await recordRecurrence(root, RECURRENCE);
    await expect(
      recordRecurrence(root, {
        ...RECURRENCE,
        occurredAt: "2026-09-17T00:00:00.000Z",
      })
    ).rejects.toThrow("Conflicting");
  });

  it("retains independent writers in separate processes", async () => {
    const root = await repository();
    const modulePath = path.resolve("dist/core/effectiveness-store.js");
    const script = `const {recordRecurrence}=await import(process.argv[1]); await recordRecurrence(process.argv[2],JSON.parse(process.argv[3]));`;
    await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        promisify(execFile)(process.execPath, [
          "--input-type=module",
          "-e",
          script,
          modulePath,
          root,
          JSON.stringify({
            ...RECURRENCE,
            occurrenceRef: `tracker:failure-${i}`,
          }),
        ])
      )
    );
    expect((await readEffectivenessReport(root)).recurrences[0]?.count).toBe(4);
  });

  it("retains divergent occurrences through a real union merge and fresh clone", async () => {
    const root = await repository();
    await recordRecurrence(root, RECURRENCE);
    git(root, "add", RECURRENCE_LEDGER);
    git(root, "commit", "-m", "first occurrence");
    git(root, "checkout", "-b", "other");
    await recordRecurrence(root, {
      ...RECURRENCE,
      occurrenceRef: "tracker:failure-2",
    });
    git(root, "add", RECURRENCE_LEDGER);
    git(root, "commit", "-m", "second occurrence");
    git(root, "checkout", "main");
    await recordRecurrence(root, {
      ...RECURRENCE,
      occurrenceRef: "tracker:failure-3",
    });
    git(root, "add", RECURRENCE_LEDGER);
    git(root, "commit", "-m", "third occurrence");
    git(root, "merge", "other", "--no-edit");
    const clone = `${root}-clone`;
    directories.push(clone);
    git(root, "clone", root, clone);
    expect((await readEffectivenessReport(clone)).recurrences[0]?.count).toBe(
      3
    );
    expect(
      git(clone, "check-attr", "merge", "--", RECURRENCE_LEDGER)
    ).toContain("union");
  });

  it("refuses missing merge setup and malformed history", async () => {
    const root = await repository();
    await writeFile(path.join(root, ".gitattributes"), "");
    await expect(recordRecurrence(root, RECURRENCE)).rejects.toThrow(
      "merge=union"
    );
    expect(() => parseRecurrences("conflict garbage")).toThrow();
  });

  it("refuses escaped storage parents", async () => {
    const root = await repository();
    const outside = await repository();
    await symlink(outside, path.join(root, ".lisa"));
    await expect(recordRecurrence(root, RECURRENCE)).rejects.toThrow("escapes");
    expect(git(outside, "status", PORCELAIN)).toBe("");
  });
});

describe("local timing and operator reports", () => {
  it("exposes the real CLI report and fingerprint without changing the repository", async () => {
    const root = await repository();
    const cli = path.resolve("dist/index.js");
    await recordRecurrence(root, RECURRENCE);
    const before = git(root, "status", PORCELAIN);
    const output = execFileSync(
      process.execPath,
      [cli, "effectiveness", "report"],
      { cwd: root, encoding: "utf8" }
    );
    expect(JSON.parse(output).recurrences[0].count).toBe(1);
    expect(git(root, "status", PORCELAIN)).toBe(before);
  });

  it("stores ignored reports and counts attention once per accepted outcome", async () => {
    const root = await repository();
    await recordEffectiveness(root, {
      entryId: "run-1",
      artifactRef: "ticket:1",
      effectiveness: OBSERVATION,
    });
    await recordEffectiveness(root, {
      entryId: "run-2",
      artifactRef: "ticket:1",
      effectiveness: OBSERVATION,
    });
    const report = await readEffectivenessReport(root);
    expect(report.attention).toMatchObject({
      acceptedOutcomes: 1,
      observedInterventions: 1,
      interventionsPerAcceptedOutcome: 1,
      sources: ["tracker:comment-1"],
    });
    expect(git(root, "status", PORCELAIN)).toBe("");
    await recordEffectiveness(root, {
      entryId: "run-3",
      artifactRef: "ticket:1",
      effectiveness: { ...OBSERVATION, attention: null },
    });
    expect(
      (await readEffectivenessReport(root)).attention
        .interventionsPerAcceptedOutcome
    ).toBeNull();
  });

  it("refuses tracked reports and preserves unknown when there are no local observations", async () => {
    const root = await repository();
    expect(
      (await readEffectivenessReport(root)).attention
        .interventionsPerAcceptedOutcome
    ).toBeNull();
    await writeFile(path.join(root, ".gitignore"), "");
    await expect(
      recordEffectiveness(root, {
        entryId: "run-1",
        artifactRef: "ticket:1",
        effectiveness: OBSERVATION,
      })
    ).rejects.toThrow();
  });
});
