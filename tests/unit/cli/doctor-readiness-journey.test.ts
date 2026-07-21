/**
 * Unit coverage for the readiness journey-evidence wiring (RRR-6, #1858).
 *
 * PRD #1739 requires the execution/proof dimension to be backed by a
 * representative journey executed by the configured worker — not assumed. This
 * suite pins that the dimension reuses #1742's shipped journey machinery (the
 * shared runner in `doctor-worker-journey.ts`) rather than a second harness:
 * fresh qualification evidence is consumed without running a journey; absent or
 * stale evidence triggers a `lisa-use-the-product` journey; a journey that
 * cannot run reports the operability claim as not established (SKIP with a
 * stated reason, never a guessed pass); a failing journey files a build-ready
 * ticket through the existing #1742 path and stands up blocker 7; and a
 * mutation policy forbidding the journey renders SKIP naming the policy. The
 * proportionality dimension surfaces #1742's scaffolding-subtraction count into
 * `machinery_to_remove` — surfaced, never auto-deleted.
 * @module tests/unit/cli/doctor-readiness-journey
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EXECUTION_PROOF_DIMENSION_ID,
  PROPORTIONALITY_DIMENSION_ID,
  assessExecutionProofDimension,
  assessProportionalityDimension,
  type JourneyOutcome,
  type JourneyTicketRequest,
  resolveMutationPolicy,
} from "../../../src/cli/doctor-readiness-journey.js";
import { assessReadiness } from "../../../src/cli/doctor-readiness-blockers.js";

const CODEX_HOST = "codex";
const CURRENT_MODEL = "gpt-5.2";
const CURRENT_VERSION = "26.8.0";
/** An artifact head far in the past: recorded evidence reads as fresh against it. */
const OLD_ARTIFACT_HEAD = "2000-01-01T00:00:00.000Z";
/** An artifact head far in the future: recorded evidence reads as stale against it. */
const FUTURE_ARTIFACT_HEAD = "2999-01-01T00:00:00.000Z";

let tempDir: string | undefined;
let envRestores: Array<() => void> = [];

/**
 * Resolve a temporary directory for one journey test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await mkdtemp(path.join(os.tmpdir(), "lisa-readiness-journey-"));
  return tempDir;
}

afterEach(async () => {
  for (const restore of envRestores.toReversed()) {
    restore();
  }
  envRestores = [];
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

/**
 * Set one environment variable and restore it after the test.
 * @param name - Environment variable name
 * @param value - Environment variable value
 */
function setEnv(name: string, value: string): void {
  const previous = process["env"][name];
  process["env"][name] = value;
  envRestores.push(() => {
    if (previous === undefined) {
      delete process["env"][name];
    } else {
      process["env"][name] = previous;
    }
  });
}

/**
 * Point the runtime worker signature at the recorded Codex epoch.
 */
function setWorkerEnv(): void {
  setEnv("LISA_WORKER_HOST", CODEX_HOST);
  setEnv("LISA_WORKER_MODEL", CURRENT_MODEL);
  setEnv("LISA_WORKER_VERSION", CURRENT_VERSION);
}

/**
 * Seed a `.lisa/worker-config.json` record in a temporary Lisa project.
 * @param cwd - Temporary project root
 * @param record - Worker epoch record body
 */
async function seedWorkerRecord(
  cwd: string,
  record: Record<string, unknown>
): Promise<void> {
  await writeFile(path.join(cwd, ".lisa.config.json"), "{}\n");
  await mkdir(path.join(cwd, ".lisa"), { recursive: true });
  await writeFile(
    path.join(cwd, ".lisa", "worker-config.json"),
    JSON.stringify(record)
  );
}

describe("resolveMutationPolicy", () => {
  it("defaults to read-only when no exploration block is configured", () => {
    expect(resolveMutationPolicy({})).toBe("read-only");
  });

  it("reads the mutation level for the default environment", () => {
    expect(
      resolveMutationPolicy({
        exploration: {
          default: "staging",
          environments: { staging: { mutation: "forbidden" } },
        },
      })
    ).toBe("forbidden");
  });

  it("downgrades a production env to forbidden without a prodMutationAck", () => {
    expect(
      resolveMutationPolicy({
        exploration: {
          default: "production",
          environments: { production: { mutation: "full" } },
        },
      })
    ).toBe("forbidden");
  });
});

describe("assessExecutionProofDimension", () => {
  it("reuses fresh qualification evidence without running a journey", async () => {
    const cwd = await getTempDir();
    setWorkerEnv();
    await seedWorkerRecord(cwd, {
      agents: {
        codex: {
          host: CODEX_HOST,
          modelId: CURRENT_MODEL,
          version: CURRENT_VERSION,
          qualificationEvidence: "runs/current.md",
          qualifiedAt: FUTURE_ARTIFACT_HEAD,
        },
      },
    });
    let ran = false;

    const dimension = await assessExecutionProofDimension(cwd, {
      artifactHead: new Date(OLD_ARTIFACT_HEAD),
      runJourney: async () => {
        ran = true;
        return { result: "passed", evidence: "should-not-run" };
      },
    });

    expect(dimension.id).toBe(EXECUTION_PROOF_DIMENSION_ID);
    expect(dimension.status).toBe("PASS");
    expect(ran).toBe(false);
    const finding = dimension.findings[0] as Record<string, unknown>;
    expect(String(finding.evidence)).toContain("runs/current.md");
    // Fresh evidence establishes the claim: no standing blocker.
    expect(assessReadiness([dimension]).blockers).toEqual([]);
  });

  it("reports the claim as not established when the journey cannot run", async () => {
    const cwd = await getTempDir();
    setWorkerEnv();
    await seedWorkerRecord(cwd, {
      agents: {
        codex: {
          host: CODEX_HOST,
          modelId: CURRENT_MODEL,
          version: CURRENT_VERSION,
        },
      },
    });

    const dimension = await assessExecutionProofDimension(cwd, {
      artifactHead: new Date(OLD_ARTIFACT_HEAD),
    });

    expect(dimension.status).toBe("SKIP");
    const finding = dimension.findings[0] as Record<string, unknown>;
    expect(String(finding.reason).toLowerCase()).toContain("not established");
    // A stated-reason SKIP is never a standing blocker (warn-only, O1).
    expect(assessReadiness([dimension]).blockers).toEqual([]);
    expect(assessReadiness([dimension]).verdict).not.toBe("NOT_READY");
  });

  it("triggers a journey when evidence is stale and consumes a passing run", async () => {
    const cwd = await getTempDir();
    setWorkerEnv();
    await seedWorkerRecord(cwd, {
      agents: {
        codex: {
          host: CODEX_HOST,
          modelId: CURRENT_MODEL,
          version: CURRENT_VERSION,
          qualificationEvidence: "runs/stale.md",
          qualifiedAt: OLD_ARTIFACT_HEAD,
        },
      },
    });
    let ran = false;

    const dimension = await assessExecutionProofDimension(cwd, {
      // Artifact head is newer than the recorded evidence: it is stale.
      artifactHead: new Date(FUTURE_ARTIFACT_HEAD),
      runJourney: async () => {
        ran = true;
        return { result: "passed", evidence: "runs/fresh-journey.md" };
      },
    });

    expect(ran).toBe(true);
    expect(dimension.status).toBe("PASS");
    expect(assessReadiness([dimension]).blockers).toEqual([]);
  });

  it("files a ticket and stands up blocker 7 when the journey fails", async () => {
    const cwd = await getTempDir();
    setWorkerEnv();
    await seedWorkerRecord(cwd, {
      agents: {
        codex: {
          host: CODEX_HOST,
          modelId: CURRENT_MODEL,
          version: CURRENT_VERSION,
        },
      },
    });
    const filed: string[] = [];

    const dimension = await assessExecutionProofDimension(cwd, {
      artifactHead: new Date(OLD_ARTIFACT_HEAD),
      runJourney: async (): Promise<JourneyOutcome> => ({
        result: "failed",
        evidence: "runs/failed.md",
        failureDetail: "sign-in returned 500",
      }),
      fileTicket: async (request: JourneyTicketRequest) => {
        filed.push(String(request.summary));
        return "LISA-9999";
      },
    });

    expect(filed).toHaveLength(1);
    expect(dimension.status).toBe("FAIL");
    const finding = dimension.findings[0] as Record<string, unknown>;
    expect(String(finding.ticket_ref)).toBe("LISA-9999");
    const assessment = assessReadiness([dimension]);
    expect(assessment.blockers.map(blocker => blocker.id)).toContain("B7");
    expect(assessment.verdict).toBe("NOT_READY");
  });

  it("renders SKIP naming the policy when a mutating journey is forbidden", async () => {
    const cwd = await getTempDir();
    setWorkerEnv();
    await writeFile(
      path.join(cwd, ".lisa.config.json"),
      `${JSON.stringify({
        exploration: {
          default: "production",
          environments: { production: { mutation: "full" } },
        },
      })}\n`
    );
    let ran = false;

    const dimension = await assessExecutionProofDimension(cwd, {
      runJourney: async () => {
        ran = true;
        return { result: "passed", evidence: "x" };
      },
    });

    expect(ran).toBe(false);
    expect(dimension.status).toBe("SKIP");
    const finding = dimension.findings[0] as Record<string, unknown>;
    expect(String(finding.reason).toLowerCase()).toContain("policy");
    expect(assessReadiness([dimension]).blockers).toEqual([]);
  });
});

describe("assessProportionalityDimension", () => {
  it("surfaces the scaffolding-subtraction count without deleting anything", async () => {
    const cwd = await getTempDir();
    await mkdir(path.join(cwd, "plugins", "src", "base", "rules"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, "plugins", "src", "base", "rules", "worker.md"),
      "This rule is a Codex model workaround for a worker limitation.\n"
    );

    const dimension = await assessProportionalityDimension(cwd);

    expect(dimension.id).toBe(PROPORTIONALITY_DIMENSION_ID);
    expect(dimension.status).toBe("SKIP");
    const finding = dimension.findings[0] as Record<string, unknown>;
    expect(finding.machinery_to_remove).toBeDefined();
    expect(Array.isArray(finding.machinery_to_remove)).toBe(true);
    expect(String(JSON.stringify(finding))).toContain("1");
    // Surfacing is never a standing blocker.
    expect(assessReadiness([dimension]).blockers).toEqual([]);
  });

  it("emits no findings when there is nothing to subtract", async () => {
    const cwd = await getTempDir();

    const dimension = await assessProportionalityDimension(cwd);

    expect(dimension.status).toBe("SKIP");
    expect(dimension.findings).toEqual([]);
  });
});
