import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrackerAdapter } from "../../../src/cli/deploy-status-adapter.js";
import { runDeployStatusSync } from "../../../src/cli/deploy-status-sync-cmd.js";
import type { DeployStatusSyncDependencies } from "../../../src/cli/deploy-status-sync-cmd.js";
import type { TrackerItemState } from "../../../src/core/deploy-status-transition.js";
import {
  createFixtureDir,
  fakeAdapter,
  makeDeps,
  CLOSE_NATIVELY,
  RANGE,
  REF_101,
  TRANSITION,
  UPSERT,
  type FixtureDir,
  type WriteCall,
} from "../../helpers/deploy-status-cmd-fixture.js";

const STAGING_LABEL = "status:on-stg";

describe("deploy-status-sync command execution", () => {
  let fixture: FixtureDir;
  let logs: string[];
  let errors: string[];
  let writes: WriteCall[];

  beforeEach(async () => {
    fixture = await createFixtureDir();
    logs = [];
    errors = [];
    writes = [];
  });

  afterEach(async () => {
    await fixture.dispose();
  });

  /**
   * Build a recording fake adapter bound to this test's write log.
   * @param states - Item state per ref
   * @param failTransitionRefs - Refs whose transition should throw
   * @returns The fake adapter
   */
  function adapterOf(
    states: Readonly<Record<string, TrackerItemState>>,
    failTransitionRefs: readonly string[] = []
  ): TrackerAdapter {
    return fakeAdapter(states, {
      onWrite: write => writes.push(write),
      failTransitionRefs,
    });
  }

  /**
   * Build injectable deps bound to this test's sinks and fixture dir.
   * @param adapter - Fake adapter
   * @param refs - Extracted refs to report
   * @returns Cmd dependencies
   */
  function deps(
    adapter: TrackerAdapter,
    refs?: readonly string[]
  ): DeployStatusSyncDependencies {
    return makeDeps({
      cwd: fixture.cwd,
      adapter,
      ...(refs === undefined ? {} : { refs }),
      log: message => logs.push(message),
      error: message => errors.push(message),
    });
  }

  it("promotes a leaf and reports it (exit 0)", async () => {
    const adapter = adapterOf({
      [REF_101]: { ref: REF_101, openChildren: 0, closed: false },
    });
    const code = await runDeployStatusSync(
      { environment: "dev", range: RANGE },
      deps(adapter)
    );
    expect(code).toBe(0);
    // Comment-FIRST ordering: a retry after any partial failure finds the
    // idempotent marker comment already in place and heals.
    expect(writes.map(write => write.method)).toEqual([UPSERT, TRANSITION]);
    expect(writes[1]?.detail).toBe("status:on-dev");
    expect(logs.join("\n")).toContain(`promoted ${REF_101}`);
  });

  it("closes natively at the production rung", async () => {
    const adapter = adapterOf({
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
    // Ordering pin: comment → transition → native closure, so every
    // partial-failure prefix is retry-healable (upsert is idempotent).
    expect(writes.map(write => write.method)).toEqual([
      UPSERT,
      TRANSITION,
      CLOSE_NATIVELY,
    ]);
  });

  it("heals on retry after a partial failure (comment written, transition failed)", async () => {
    const state: TrackerItemState = {
      ref: REF_101,
      openChildren: 0,
      closed: false,
    };
    const comments = new Map<string, string>();
    const upsertResults: string[] = [];
    /**
     * Build a stateful adapter whose transition can be toggled to fail.
     * @param failTransition - Whether transitionToDone rejects
     * @returns Adapter over the shared comment store
     */
    function statefulAdapter(failTransition: boolean): TrackerAdapter {
      return {
        fetchItemState: () => Promise.resolve(state),
        transitionToDone: () =>
          failTransition
            ? Promise.reject(new Error("transient 502"))
            : Promise.resolve(),
        upsertManagedComment: (ref, body) => {
          const outcome =
            comments.get(ref) === body
              ? ("unchanged" as const)
              : comments.has(ref)
                ? ("updated" as const)
                : ("created" as const);
          comments.set(ref, body);
          upsertResults.push(outcome);
          return Promise.resolve(outcome);
        },
        closeNatively: () => Promise.resolve(),
      };
    }
    const firstCode = await runDeployStatusSync(
      { environment: "dev", range: RANGE },
      deps(statefulAdapter(true))
    );
    expect(firstCode).toBe(1);
    expect(comments.size).toBe(1);
    const secondCode = await runDeployStatusSync(
      { environment: "dev", range: RANGE },
      deps(statefulAdapter(false))
    );
    expect(secondCode).toBe(0);
    expect(upsertResults).toEqual(["created", "unchanged"]);
    expect(logs.join("\n")).toContain(`promoted ${REF_101}`);
  });

  it("performs zero writes on skip and dry-run", async () => {
    const adapter = adapterOf({
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
    const promotable = adapterOf({
      [REF_101]: { ref: REF_101, openChildren: 0, closed: false },
    });
    const dryCode = await runDeployStatusSync(
      { environment: "dev", range: RANGE, dryRun: true },
      deps(promotable)
    );
    expect(dryCode).toBe(0);
    expect(writes).toHaveLength(0);
    expect(logs.join("\n")).toContain("dry-run");
  });

  it("continues past a failing item and exits 1", async () => {
    const other = "acme/app#102";
    const adapter = adapterOf(
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

  it("emits the machine-readable plan with --json", async () => {
    const adapter = adapterOf({
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
});
