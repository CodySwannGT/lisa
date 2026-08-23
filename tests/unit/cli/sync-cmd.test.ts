import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSync } from "../../../src/cli/sync-cmd.js";
import { readJson, writeJson } from "../../../src/utils/index.js";

const CONFIG = ".lisa.config.json";
const STRYKER = "stryker.conf.json";

/** Holder for the per-test temp project directory. */
interface TempProject {
  dir: string;
}

const project: TempProject = { dir: "" };

beforeEach(async () => {
  project.dir = await mkdtemp(path.join(tmpdir(), "lisa-sync-cmd-"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(project.dir, { recursive: true, force: true });
});

describe("runSync", () => {
  it("populates the config and returns 1 while required keys are missing", async () => {
    const code = await runSync(project.dir);

    const config = await readJson<Record<string, unknown>>(
      path.join(project.dir, CONFIG)
    );
    expect(config.harness).toBe("claude");
    expect(code).toBe(1);
  });

  it("returns 0 when every relevant required key is present", async () => {
    await writeJson(path.join(project.dir, CONFIG), {
      tracker: "github",
      github: { org: "acme", repo: "acme-app" },
    });

    const code = await runSync(project.dir);

    expect(code).toBe(0);
  });

  it("does not write anything in --dry-run mode", async () => {
    await runSync(project.dir, { dryRun: true });

    await expect(readJson(path.join(project.dir, CONFIG))).rejects.toThrow();
  });

  it("refuses with an operator-readable message when the two mutation floors disagree", async () => {
    const errorSpy = vi.spyOn(console, "error");
    await writeJson(path.join(project.dir, CONFIG), {
      tracker: "github",
      github: { org: "acme", repo: "acme-app" },
      quality: {
        mutation: { strykerThresholds: { high: 80, low: 60, break: 60 } },
      },
    });
    await writeJson(path.join(project.dir, STRYKER), {
      testRunner: "vitest",
      thresholds: { high: 80, low: 40, break: 32 },
    });

    const code = await runSync(project.dir);

    const output = errorSpy.mock.calls.map(call => String(call[0])).join("\n");
    expect(code).toBe(1);
    expect(output).toContain("quality.mutation.strykerThresholds");
    expect(output).toContain(STRYKER);
    expect(output).toContain('"break":60');
    expect(output).toContain('"break":32');
    expect(output.split("\n")[0]).toBe(
      "Mutation-score floor divergence — refusing to sync."
    );
  });

  it("proceeds and reports when the divergence is recorded in the file", async () => {
    const logSpy = vi.spyOn(console, "log");
    await writeJson(path.join(project.dir, CONFIG), {
      tracker: "github",
      github: { org: "acme", repo: "acme-app" },
      quality: {
        mutation: { strykerThresholds: { high: 80, low: 60, break: 60 } },
      },
    });
    await writeJson(path.join(project.dir, STRYKER), {
      testRunner: "vitest",
      _thresholdsDivergence: {
        reason: "deferred until the true aggregate score is measurable",
        enforced: { high: 80, low: 40, break: 32 },
        declared: { high: 80, low: 60, break: 60 },
      },
      thresholds: { high: 80, low: 40, break: 32 },
    });

    const code = await runSync(project.dir);

    const output = logSpy.mock.calls.map(call => String(call[0])).join("\n");
    expect(code).toBe(0);
    expect(output).toContain("divergence-honoured");
    expect(output).toContain('"break":32');
    expect(output).toContain('"break":60');
    const artifact = await readJson<Record<string, unknown>>(
      path.join(project.dir, STRYKER)
    );
    expect(artifact.thresholds).toEqual({ high: 80, low: 40, break: 32 });
  });

  it("emits JSON when --json is passed", async () => {
    const logSpy = vi.spyOn(console, "log");

    await runSync(project.dir, { json: true });

    const output = logSpy.mock.calls.map(call => call[0]).join("\n");
    const parsed = JSON.parse(output) as { actions: unknown[] };
    expect(Array.isArray(parsed.actions)).toBe(true);
  });
});
