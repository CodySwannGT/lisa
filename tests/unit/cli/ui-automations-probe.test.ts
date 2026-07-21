/**
 * Unit coverage for the harness-scheduler automations live-status probe (#1544).
 *
 * READ-ONLY: never fabricates demo automations; absent/unreadable schedulers
 * resolve to unknown with a reason; only `lisa-auto-<project>-` matches appear.
 * @module tests/unit/cli/ui-automations-probe
 */
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createAutomationsProbe,
  type ClaudeScheduleListingReader,
  type CodexAutomationLister,
  type HarnessAutomationObservation,
  type ProjectIdentityResolver,
} from "../../../src/cli/ui-automations.js";
import {
  defaultResolveIdentity,
  resolveExpectedAutomationEntries,
} from "../../../src/cli/ui-automations-adapters.js";
import { runProbe } from "../../../src/cli/ui-status.js";

const AUTOMATIONS_PROBE_ID = "automations";
const PROJECT_PREFIX = "lisa-auto-codyswanngt-lisa-";
const MATCHING_ID = `${PROJECT_PREFIX}intake-tickets`;
const UNRELATED_ID = "lisa-auto-other-repo-intake-tickets";
const TEN_MINUTE_CADENCE = "every 10 minutes";
const HOURLY_CADENCE = "every 60 minutes";

/** Temp dirs created this file, removed in afterEach. */
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

/**
 * Create a tracked temporary directory.
 * @returns Absolute path
 */
async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-automations-"));
  tempDirs.push(dir);
  return dir;
}

/**
 * Fixed identity resolver for CodySwannGT/lisa.
 * @returns Project identity with the stable Lisa automation prefix
 */
const resolveLisaIdentity: ProjectIdentityResolver = async () => ({
  owner: "CodySwannGT",
  repo: "lisa",
  project: "codyswanngt-lisa",
  automationPrefix: PROJECT_PREFIX,
});

/**
 * Build a Codex lister that returns fixed observations.
 * @param observations - Observed automations
 * @returns Codex lister
 */
function fixedCodexLister(
  observations: readonly HarnessAutomationObservation[]
): CodexAutomationLister {
  return async () => observations;
}

/**
 * Build a Claude schedule reader that returns a fixed listing or null.
 * @param listing - Schedule listing payload, or null when unavailable
 * @returns Claude schedule listing reader
 */
function fixedClaudeReader(
  listing: unknown | null
): ClaudeScheduleListingReader {
  return async () => listing;
}

describe("createAutomationsProbe", () => {
  it("rejects unsafe project config before scheduler identity resolution", async () => {
    const project = await makeTempDir();
    const outside = await makeTempDir();
    const target = path.join(outside, "config.json");
    await writeFile(target, '{"github":{"org":"unsafe","repo":"unsafe"}}\n');
    await symlink(target, path.join(project, ".lisa.config.json"));

    await expect(
      defaultResolveIdentity(project, AbortSignal.timeout(1_000))
    ).rejects.toThrow(/Unsafe/u);
  });

  it("uses the GitHub origin for Jira and Notion fleets without github config", async () => {
    const expected = await resolveExpectedAutomationEntries(
      {
        tracker: "jira",
        source: "notion",
        jira: { project: "ENG" },
        notion: { workspaceId: "workspace", prdDatabaseId: "database" },
      },
      ["typescript"],
      "git@github.com:Acme/service.git"
    );

    expect(expected).toContainEqual(
      expect.objectContaining({
        id: "intake-repair",
        automationId: "lisa-auto-acme-service-intake-repair",
      })
    );
    expect(
      expected.every(entry =>
        entry.automationId.startsWith("lisa-auto-acme-service-")
      )
    ).toBe(true);
  });

  it("lists matching Codex automations with real cadence", async () => {
    const probe = createAutomationsProbe({
      cwd: await makeTempDir(),
      resolveIdentity: resolveLisaIdentity,
      listCodexAutomations: fixedCodexLister([
        {
          automationId: MATCHING_ID,
          observedCadence: TEN_MINUTE_CADENCE,
          status: "ACTIVE",
        },
        {
          automationId: UNRELATED_ID,
          observedCadence: HOURLY_CADENCE,
        },
      ]),
      codexAutomationsDirReadable: async () => true,
      readClaudeScheduleListing: fixedClaudeReader(null),
    });

    expect(probe.id).toBe(AUTOMATIONS_PROBE_ID);
    await expect(runProbe(probe)).resolves.toEqual({
      state: "value",
      value: {
        prefix: PROJECT_PREFIX,
        runtime: "codex",
        automations: [
          {
            id: MATCHING_ID,
            cadence: TEN_MINUTE_CADENCE,
            runtime: "codex",
            status: "ACTIVE",
            lastRunAt: null,
          },
        ],
      },
    });
  });

  it("reads Claude /schedule when Codex is absent", async () => {
    const probe = createAutomationsProbe({
      cwd: await makeTempDir(),
      resolveIdentity: resolveLisaIdentity,
      codexAutomationsDirReadable: async () => false,
      readClaudeScheduleListing: fixedClaudeReader({
        routines: [
          {
            name: MATCHING_ID,
            cadence: TEN_MINUTE_CADENCE,
            status: "ACTIVE",
          },
          {
            name: UNRELATED_ID,
            cadence: HOURLY_CADENCE,
            status: "ACTIVE",
          },
        ],
      }),
      listClaudeAutomations: ({ scheduleListing, automationPrefix }) => {
        const routines =
          typeof scheduleListing === "object" &&
          scheduleListing !== null &&
          "routines" in scheduleListing &&
          Array.isArray(scheduleListing.routines)
            ? scheduleListing.routines
            : [];
        return routines
          .filter(
            (
              entry
            ): entry is { name: string; cadence: string; status: string } =>
              typeof entry === "object" &&
              entry !== null &&
              typeof Reflect.get(entry, "name") === "string"
          )
          .filter(entry => entry.name.startsWith(automationPrefix))
          .map(entry => ({
            automationId: entry.name,
            observedCadence: entry.cadence,
            status: entry.status,
          }));
      },
    });

    await expect(runProbe(probe)).resolves.toEqual({
      state: "value",
      value: {
        prefix: PROJECT_PREFIX,
        runtime: "claude",
        automations: [
          {
            id: MATCHING_ID,
            cadence: TEN_MINUTE_CADENCE,
            runtime: "claude",
            status: "ACTIVE",
            lastRunAt: null,
          },
        ],
      },
    });
  });

  it("returns unknown when no harness scheduler is configured", async () => {
    const probe = createAutomationsProbe({
      cwd: await makeTempDir(),
      resolveIdentity: resolveLisaIdentity,
      codexAutomationsDirReadable: async () => false,
      readClaudeScheduleListing: fixedClaudeReader(null),
    });

    await expect(runProbe(probe)).resolves.toEqual({
      state: "unknown",
      reason: "scheduler-unavailable",
      message:
        "No harness scheduler is configured (Codex automations directory absent and Claude /schedule listing unavailable)",
    });
  });

  it("returns unknown when project identity cannot be resolved", async () => {
    const probe = createAutomationsProbe({
      cwd: await makeTempDir(),
      resolveIdentity: async () => {
        throw new Error(
          "Unable to resolve repo identity for automation naming"
        );
      },
      codexAutomationsDirReadable: async () => true,
      listCodexAutomations: fixedCodexLister([
        {
          automationId: MATCHING_ID,
          observedCadence: TEN_MINUTE_CADENCE,
        },
      ]),
    });

    await expect(runProbe(probe)).resolves.toEqual({
      state: "unknown",
      reason: "identity-unavailable",
      message: "Unable to resolve repo identity for automation naming",
    });
  });

  it("returns unknown when the Codex directory is unreadable", async () => {
    const probe = createAutomationsProbe({
      cwd: await makeTempDir(),
      resolveIdentity: resolveLisaIdentity,
      codexAutomationsDirReadable: async () => true,
      listCodexAutomations: async () => {
        throw new Error("EACCES: permission denied");
      },
      readClaudeScheduleListing: fixedClaudeReader(null),
    });

    await expect(runProbe(probe)).resolves.toEqual({
      state: "unknown",
      reason: "scheduler-unreadable",
      message: "EACCES: permission denied",
    });
  });
});
