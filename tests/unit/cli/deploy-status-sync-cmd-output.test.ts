import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrackerAdapter } from "../../../src/cli/deploy-status-adapter.js";
import { runDeployStatusSync } from "../../../src/cli/deploy-status-sync-cmd.js";
import type { DeployStatusSyncDependencies } from "../../../src/cli/deploy-status-sync-cmd.js";
import type { TrackerItemState } from "../../../src/core/deploy-status-transition.js";
import {
  createFixtureDir,
  fakeAdapter,
  makeDeps,
  RANGE,
  type FixtureDir,
  type WriteCall,
} from "../../helpers/deploy-status-cmd-fixture.js";

/** Parsed --json payload shape shared by the assertions. */
interface JsonPayload {
  readonly env?: string;
  readonly plan?: { readonly kind?: string; readonly reason?: string };
  readonly results?: readonly { ref?: string; outcome?: string }[];
}

describe("deploy-status-sync command --json output", () => {
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

  it("strips ANSI/control characters from echoed skipped tokens", async () => {
    const adapter = adapterOf({});
    const code = await runDeployStatusSync(
      { environment: "dev", range: RANGE },
      {
        ...deps(adapter),
        extractRefs: () =>
          Promise.resolve({
            refs: [],
            skipped: [
              {
                token: "\u001b[31mevil\u001b[0m#x",
                reason: "not a GitHub work-item ref",
              },
            ],
            headSha: "def456",
          }),
      }
    );
    expect(code).toBe(0);
    const output = logs.join("\n");
    expect(output).toContain("skipped token [31mevil[0m#x");
    expect(output).not.toContain("\u001b");
  });

  it("emits a parseable no-op payload for an unconfigured env", async () => {
    const code = await runDeployStatusSync(
      { environment: "qa", range: RANGE, json: true },
      deps(adapterOf({}))
    );
    expect(code).toBe(0);
    const payload = JSON.parse(logs.join("\n")) as JsonPayload;
    expect(payload.env).toBe("qa");
    expect(payload.plan?.kind).toBe("no-op");
    expect(payload.plan?.reason).toContain("github.labels.build.done.qa");
    expect(payload.results).toEqual([]);
  });

  it("emits a parseable no-op payload when the range has no refs", async () => {
    const code = await runDeployStatusSync(
      { environment: "dev", range: RANGE, json: true },
      deps(adapterOf({}), [])
    );
    expect(code).toBe(0);
    const payload = JSON.parse(logs.join("\n")) as JsonPayload;
    expect(payload.env).toBe("dev");
    expect(payload.plan?.kind).toBe("no-op");
    expect(payload.plan?.reason).toContain("no work-item refs");
    expect(payload.results).toEqual([]);
  });
});
