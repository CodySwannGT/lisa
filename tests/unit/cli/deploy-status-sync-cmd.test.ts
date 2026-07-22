import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrackerAdapter } from "../../../src/cli/deploy-status-adapter.js";
import { runDeployStatusSync } from "../../../src/cli/deploy-status-sync-cmd.js";
import type { DeployStatusSyncDependencies } from "../../../src/cli/deploy-status-sync-cmd.js";
import type { TrackerItemState } from "../../../src/core/deploy-status-transition.js";
import {
  createFixtureDir,
  fakeAdapter,
  makeDeps,
  writeConfig,
  RANGE,
  REF_101,
  TRANSITION,
  type FixtureDir,
  type WriteCall,
} from "../../helpers/deploy-status-cmd-fixture.js";

const STAGING_LABEL = "status:on-stg";
const ENV_FLAG = "--environment";

describe("deploy-status-sync command validation", () => {
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
   * @returns The fake adapter
   */
  function adapterOf(
    states: Readonly<Record<string, TrackerItemState>>
  ): TrackerAdapter {
    return fakeAdapter(states, { onWrite: write => writes.push(write) });
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

  it("rejects when neither environment nor branch is given", async () => {
    const code = await runDeployStatusSync(
      { range: RANGE },
      deps(adapterOf({}))
    );
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain(ENV_FLAG);
  });

  it("rejects when both environment and branch are given", async () => {
    const code = await runDeployStatusSync(
      { environment: "dev", branch: "dev", range: RANGE },
      deps(adapterOf({}))
    );
    expect(code).toBe(1);
  });

  it("rejects when no commit range is given", async () => {
    const code = await runDeployStatusSync(
      { environment: "dev" },
      deps(adapterOf({}))
    );
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("--range");
  });

  it("rejects a three-dot range decision-readably", async () => {
    const code = await runDeployStatusSync(
      { environment: "dev", range: "abc...def" },
      deps(adapterOf({}))
    );
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain(
      'Invalid range "abc...def": three-dot "..." selects the symmetric difference, which is never a deploy range. Pass the deployed range as <base>..<head> (two dots).'
    );
  });

  it("normalizes --before/--after into a range", async () => {
    const seen: string[] = [];
    const adapter = adapterOf({
      [REF_101]: { ref: REF_101, openChildren: 0, closed: false },
    });
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

  it("resolves the environment from --branch via the ladder", async () => {
    const adapter = adapterOf({
      [REF_101]: { ref: REF_101, openChildren: 0, closed: false },
    });
    const code = await runDeployStatusSync(
      { branch: "staging", range: RANGE },
      deps(adapter)
    );
    expect(code).toBe(0);
    expect(writes.find(write => write.method === TRANSITION)?.detail).toBe(
      STAGING_LABEL
    );
  });

  it("asks for --environment when a branch maps to multiple envs", async () => {
    await writeConfig(fixture.cwd, {
      tracker: "github",
      github: { org: "acme", repo: "app" },
      deploy: {
        branches: { dev: "main", staging: "main", production: "main" },
      },
    });
    const code = await runDeployStatusSync(
      { branch: "main", range: RANGE },
      deps(adapterOf({}))
    );
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain(ENV_FLAG);
  });

  it("reports the unconfigured-env no-op naming the config key (exit 0)", async () => {
    const code = await runDeployStatusSync(
      { environment: "qa", range: RANGE },
      deps(adapterOf({}))
    );
    expect(code).toBe(0);
    expect(writes).toHaveLength(0);
    expect(logs.join("\n")).toContain("github.labels.build.done.qa");
  });

  it("fails decision-readably when tracker is missing from config", async () => {
    await writeConfig(fixture.cwd, "{}");
    const code = await runDeployStatusSync(
      { environment: "dev", range: RANGE },
      deps(adapterOf({}))
    );
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("tracker");
  });
});
