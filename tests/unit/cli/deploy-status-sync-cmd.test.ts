import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrackerAdapter } from "../../../src/cli/deploy-status-adapter.js";
import {
  runDeployStatusSync,
  type DeployStatusSyncDependencies,
} from "../../../src/cli/deploy-status-sync-cmd.js";
import type { TrackerItemState } from "../../../src/core/deploy-status-transition.js";

const DEV_LABEL = "status:on-dev";
const STAGING_LABEL = "status:on-stg";
const REF_101 = "acme/app#101";
const RANGE = "abc..def";
const TRANSITION = "transitionToDone";
const UPSERT = "upsertManagedComment";
const CLOSE_NATIVELY = "closeNatively";
const ENV_FLAG = "--environment";

/** One recorded adapter write. */
interface WriteCall {
  readonly method: string;
  readonly ref: string;
  readonly detail?: string;
}

/**
 * Build a fake adapter whose writes are recorded.
 * @param states - Item state per ref
 * @param failTransitionRefs - Refs whose transition should throw
 * @returns Adapter plus recorded writes
 */
function fakeAdapter(
  states: Readonly<Record<string, TrackerItemState>>,
  failTransitionRefs: readonly string[] = []
): { readonly adapter: TrackerAdapter; readonly writes: WriteCall[] } {
  const writes: WriteCall[] = [];
  return {
    writes,
    adapter: {
      fetchItemState: ref => {
        const state = states[ref];
        return state === undefined
          ? Promise.reject(new Error(`no state for ${ref}`))
          : Promise.resolve(state);
      },
      transitionToDone: (ref, doneStatus) => {
        if (failTransitionRefs.includes(ref)) {
          return Promise.reject(new Error(`transition failed for ${ref}`));
        }
        writes.push({ method: TRANSITION, ref, detail: doneStatus });
        return Promise.resolve();
      },
      upsertManagedComment: (ref, body) => {
        writes.push({ method: UPSERT, ref, detail: body });
        return Promise.resolve("created" as const);
      },
      closeNatively: ref => {
        writes.push({ method: CLOSE_NATIVELY, ref });
        return Promise.resolve();
      },
    },
  };
}

/**
 * Write the fixture .lisa.config.json.
 * @param cwd - Fixture directory
 * @param value - Config object (or raw string)
 */
async function writeConfig(cwd: string, value: unknown): Promise<void> {
  await writeFile(
    path.join(cwd, ".lisa.config.json"),
    typeof value === "string" ? value : JSON.stringify(value),
    "utf8"
  );
}

describe("deploy-status-sync command", () => {
  let cwd: string;
  let logs: string[];
  let errors: string[];

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(os.tmpdir(), "lisa-dss-cmd-"));
    logs = [];
    errors = [];
    await writeConfig(cwd, {
      tracker: "github",
      github: { org: "acme", repo: "app" },
      deploy: {
        branches: { dev: "dev", staging: "staging", production: "main" },
      },
    });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  /**
   * Build injectable deps around a fake adapter and static refs.
   * @param adapter - Fake adapter
   * @param refs - Extracted refs to report
   * @returns Cmd dependencies
   */
  function deps(
    adapter: TrackerAdapter,
    refs: readonly string[] = [REF_101]
  ): DeployStatusSyncDependencies {
    return {
      cwd,
      log: message => logs.push(message),
      error: message => errors.push(message),
      extractRefs: () =>
        Promise.resolve({ refs, skipped: [], headSha: "def456" }),
      adapterFactory: () => adapter,
    };
  }

  it("rejects when neither environment nor branch is given", async () => {
    const { adapter } = fakeAdapter({});
    const code = await runDeployStatusSync({ range: RANGE }, deps(adapter));
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain(ENV_FLAG);
  });

  it("rejects when both environment and branch are given", async () => {
    const { adapter } = fakeAdapter({});
    const code = await runDeployStatusSync(
      { environment: "dev", branch: "dev", range: RANGE },
      deps(adapter)
    );
    expect(code).toBe(1);
  });

  it("rejects when no commit range is given", async () => {
    const { adapter } = fakeAdapter({});
    const code = await runDeployStatusSync(
      { environment: "dev" },
      deps(adapter)
    );
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("--range");
  });

  it("normalizes --before/--after into a range", async () => {
    const { adapter } = fakeAdapter({
      [REF_101]: { ref: REF_101, openChildren: 0, closed: false },
    });
    const seen: string[] = [];
    const code = await runDeployStatusSync(
      { environment: "dev", before: "abc", after: "def" },
      {
        ...deps(adapter),
        extractRefs: options => {
          seen.push(options.range);
          return Promise.resolve({
            refs: [REF_101],
            skipped: [],
            headSha: "def",
          });
        },
      }
    );
    expect(code).toBe(0);
    expect(seen).toEqual(["abc..def"]);
  });

  it("promotes a leaf and reports it (exit 0)", async () => {
    const { adapter, writes } = fakeAdapter({
      [REF_101]: { ref: REF_101, openChildren: 0, closed: false },
    });
    const code = await runDeployStatusSync(
      { environment: "dev", range: RANGE },
      deps(adapter)
    );
    expect(code).toBe(0);
    expect(writes.map(write => write.method)).toEqual([TRANSITION, UPSERT]);
    expect(writes[0]?.detail).toBe(DEV_LABEL);
    expect(logs.join("\n")).toContain(`promoted ${REF_101}`);
  });

  it("closes natively at the production rung", async () => {
    const { adapter, writes } = fakeAdapter({
      [REF_101]: {
        ref: REF_101,
        openChildren: 0,
        closed: false,
        currentStatus: STAGING_LABEL,
      },
    });
    const code = await runDeployStatusSync(
      { environment: "production", range: RANGE },
      deps(adapter)
    );
    expect(code).toBe(0);
    expect(writes.map(write => write.method)).toEqual([
      TRANSITION,
      UPSERT,
      CLOSE_NATIVELY,
    ]);
  });

  it("resolves the environment from --branch via the ladder", async () => {
    const { adapter, writes } = fakeAdapter({
      [REF_101]: { ref: REF_101, openChildren: 0, closed: false },
    });
    const code = await runDeployStatusSync(
      { branch: "staging", range: RANGE },
      deps(adapter)
    );
    expect(code).toBe(0);
    expect(writes[0]?.detail).toBe(STAGING_LABEL);
  });

  it("asks for --environment when a branch maps to multiple envs", async () => {
    await writeConfig(cwd, {
      tracker: "github",
      github: { org: "acme", repo: "app" },
      deploy: {
        branches: { dev: "main", staging: "main", production: "main" },
      },
    });
    const { adapter } = fakeAdapter({});
    const code = await runDeployStatusSync(
      { branch: "main", range: RANGE },
      deps(adapter)
    );
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain(ENV_FLAG);
  });

  it("performs zero writes on skip and dry-run", async () => {
    const { adapter, writes } = fakeAdapter({
      [REF_101]: {
        ref: REF_101,
        openChildren: 0,
        closed: false,
        currentStatus: STAGING_LABEL,
      },
    });
    const skipCode = await runDeployStatusSync(
      { environment: "dev", range: RANGE },
      deps(adapter)
    );
    expect(skipCode).toBe(0);
    expect(writes).toHaveLength(0);
    const dryLogs: string[] = [];
    const { adapter: promotable, writes: promoteWrites } = fakeAdapter({
      [REF_101]: { ref: REF_101, openChildren: 0, closed: false },
    });
    const dryCode = await runDeployStatusSync(
      { environment: "dev", range: RANGE, dryRun: true },
      { ...deps(promotable), log: message => dryLogs.push(message) }
    );
    expect(dryCode).toBe(0);
    expect(promoteWrites).toHaveLength(0);
    expect(dryLogs.join("\n")).toContain("dry-run");
  });

  it("continues past a failing item and exits 1", async () => {
    const other = "acme/app#102";
    const { adapter, writes } = fakeAdapter(
      {
        [REF_101]: { ref: REF_101, openChildren: 0, closed: false },
        [other]: { ref: other, openChildren: 0, closed: false },
      },
      [REF_101]
    );
    const code = await runDeployStatusSync(
      { environment: "dev", range: RANGE },
      deps(adapter, [REF_101, other])
    );
    expect(code).toBe(1);
    expect(writes.filter(write => write.method === TRANSITION)).toHaveLength(1);
    expect(errors.join("\n")).toContain(REF_101);
  });

  it("reports the unconfigured-env no-op naming the config key (exit 0)", async () => {
    const { adapter, writes } = fakeAdapter({});
    const code = await runDeployStatusSync(
      { environment: "qa", range: RANGE },
      deps(adapter)
    );
    expect(code).toBe(0);
    expect(writes).toHaveLength(0);
    expect(logs.join("\n")).toContain("github.labels.build.done.qa");
  });

  it("emits the machine-readable plan with --json", async () => {
    const { adapter } = fakeAdapter({
      [REF_101]: { ref: REF_101, openChildren: 0, closed: false },
    });
    const code = await runDeployStatusSync(
      { environment: "dev", range: RANGE, json: true },
      deps(adapter)
    );
    expect(code).toBe(0);
    const payload = JSON.parse(logs.join("\n")) as {
      env?: string;
      results?: readonly { ref?: string; outcome?: string }[];
    };
    expect(payload.env).toBe("dev");
    expect(payload.results?.[0]).toMatchObject({
      ref: REF_101,
      outcome: "promoted",
    });
  });

  it("fails decision-readably when tracker is missing from config", async () => {
    await writeConfig(cwd, "{}");
    const { adapter } = fakeAdapter({});
    const code = await runDeployStatusSync(
      { environment: "dev", range: RANGE },
      deps(adapter)
    );
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("tracker");
  });
});
