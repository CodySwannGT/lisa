import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  readBoundedHealthInput,
  runHealthCli,
  type HealthCliDependencies,
} from "../../../src/cli/health-cmd.js";
import type { HealthResult } from "../../../src/health/index.js";

const ROOT = path.resolve("test-output", "lisa-health-cli");
const FINAL_JSON = '{"final":true}\n';

/** A complete persisted result; the command only forwards its serialized bytes. */
const PERSISTED_RESULT: HealthResult = {
  schemaVersion: 1,
  runId: "health-cli-test",
  mode: "deterministic",
  startedAt: "2026-01-01T00:00:00.000Z",
  completedAt: "2026-01-01T00:00:00.000Z",
  findings: [],
  summary: { verdict: "in band", counts: { pass: 0, warn: 0, fail: 0 } },
};

/**
 * Build isolated process/health boundaries for one command test.
 * @returns Injectable command dependencies
 */
function dependencies() {
  return {
    cwd: ROOT,
    prepare: vi.fn<HealthCliDependencies["prepare"]>(async () => undefined),
    runPersisted: vi.fn<HealthCliDependencies["runPersisted"]>(async () => ({
      writeOutcome: { status: "written", path: ROOT, result: PERSISTED_RESULT },
      result: PERSISTED_RESULT,
      serialized: FINAL_JSON,
    })),
    serializeRequest: vi.fn<HealthCliDependencies["serializeRequest"]>(
      () => '{"prepared":true}\n'
    ),
    readStdin: vi.fn<HealthCliDependencies["readStdin"]>(
      async () => '{"evaluation":{"status":"unavailable"}}'
    ),
    write: vi.fn<HealthCliDependencies["write"]>(),
  };
}

describe("runHealthCli", () => {
  it("prepares evidence without running the persisted consumer", async () => {
    const deps = dependencies();
    deps.prepare.mockResolvedValueOnce({ request: {} } as never);

    await runHealthCli(undefined, { prepareAgentic: true }, deps);

    expect(deps.prepare).toHaveBeenCalledWith(ROOT);
    expect(deps.runPersisted).not.toHaveBeenCalled();
    expect(deps.write).toHaveBeenCalledWith('{"prepared":true}\n');
  });

  it("reports unavailable preparation without persisting", async () => {
    const deps = dependencies();

    await runHealthCli(undefined, { prepareAgentic: true }, deps);

    expect(deps.runPersisted).not.toHaveBeenCalled();
    expect(JSON.parse(String(deps.write.mock.calls[0]?.[0]))).toEqual({
      protocolVersion: 1,
      status: "unavailable",
    });
  });

  it("persists deterministic health once and writes its canonical bytes", async () => {
    const deps = dependencies();

    await runHealthCli(undefined, {}, deps);

    expect(deps.runPersisted).toHaveBeenCalledWith(ROOT, undefined);
    expect(deps.readStdin).not.toHaveBeenCalled();
    expect(deps.write).toHaveBeenCalledWith(FINAL_JSON);
  });

  it("passes hostile evaluation JSON as unknown to the shared consumer", async () => {
    const deps = dependencies();
    deps.readStdin.mockResolvedValueOnce(
      '{"protocolVersion":1,"requestDigest":"digest","evaluation":{"status":"unavailable"}}'
    );

    await runHealthCli(undefined, { agenticEvaluation: true }, deps);

    expect(deps.runPersisted).toHaveBeenCalledWith(ROOT, {
      agentic: {
        enabled: true,
        response: {
          protocolVersion: 1,
          requestDigest: "digest",
          evaluation: { status: "unavailable" },
        },
      },
    });
    expect(deps.write).toHaveBeenCalledWith(FINAL_JSON);
  });

  it("rejects ambiguous modes but degrades malformed input through one final run", async () => {
    const deps = dependencies();
    await expect(
      runHealthCli(
        undefined,
        { prepareAgentic: true, agenticEvaluation: true },
        deps
      )
    ).rejects.toThrow("mutually exclusive");
    deps.readStdin.mockResolvedValueOnce("not-json");
    await runHealthCli(undefined, { agenticEvaluation: true }, deps);
    expect(deps.runPersisted).toHaveBeenCalledWith(ROOT, {
      agentic: { enabled: true, response: "not-json" },
    });
    expect(deps.write).toHaveBeenCalledWith(FINAL_JSON);
  });

  it("degrades bounded-reader failures through one final run", async () => {
    const deps = dependencies();
    deps.readStdin.mockRejectedValueOnce(new Error("invalid UTF-8"));

    await runHealthCli(undefined, { agenticEvaluation: true }, deps);

    expect(deps.runPersisted).toHaveBeenCalledWith(ROOT, {
      agentic: { enabled: true, response: null },
    });
    expect(deps.write).toHaveBeenCalledWith(FINAL_JSON);
  });
});

describe("readBoundedHealthInput", () => {
  it("decodes strict UTF-8 and rejects aggregate over-budget input", async () => {
    /** Yield one valid response in separate chunks.
     * @yields UTF-8 chunks for one valid response.
     */
    async function* small() {
      yield Buffer.from('{"ok":');
      yield Buffer.from("true}");
    }
    /** Yield one response beyond the aggregate protocol bound.
     * @yields A response beyond the aggregate protocol bound.
     */
    async function* large() {
      yield Buffer.alloc(128 * 1024 + 1, 97);
    }

    await expect(readBoundedHealthInput(small())).resolves.toBe('{"ok":true}');
    await expect(readBoundedHealthInput(large())).rejects.toThrow("128 KiB");
  });
});
