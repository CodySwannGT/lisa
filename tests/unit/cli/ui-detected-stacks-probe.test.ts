import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDetectedStacksProbe,
  DETECTED_STACKS_PROBE_ID,
  runProbe,
  runUi,
} from "../../../src/cli/ui-cmd.js";
import { readConfinedDetectedStacks } from "../../../src/cli/ui-detected-stacks.js";
import { DetectorRegistry } from "../../../src/detection/index.js";

/** Holder for per-test temp resources. */
interface TestResources {
  dir: string;
  server: Server | undefined;
}

const resources: TestResources = { dir: "", server: undefined };

beforeEach(async () => {
  resources.dir = await mkdtemp(path.join(tmpdir(), "lisa-detected-stacks-"));
  resources.server = undefined;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (resources.server !== undefined) {
    await new Promise(resolve => resources.server?.close(resolve));
    resources.server = undefined;
  }
  await rm(resources.dir, { recursive: true, force: true });
});

describe("createDetectedStacksProbe", () => {
  it("rejects package evidence that is an external symlink", async () => {
    const outside = await mkdtemp(
      path.join(tmpdir(), "lisa-detected-stacks-outside-")
    );
    try {
      const target = path.join(outside, "package.json");
      await writeFile(target, '{"dependencies":{"expo":"latest"}}\n');
      await symlink(target, path.join(resources.dir, "package.json"));

      await expect(readConfinedDetectedStacks(resources.dir)).rejects.toThrow(
        /Unsafe/u
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("registers with the detected-stacks id and a bounded timeout", () => {
    const probe = createDetectedStacksProbe(resources.dir);

    expect(probe.id).toBe(DETECTED_STACKS_PROBE_ID);
    expect(Number.isFinite(probe.timeoutMs)).toBe(true);
    expect(probe.timeoutMs).toBeGreaterThan(0);
  });

  it("returns expanded, ordered project types for a detected fixture", async () => {
    await writeFile(path.join(resources.dir, "tsconfig.json"), "{}", "utf8");
    await writeFile(path.join(resources.dir, "app.json"), "{}", "utf8");

    const result = await runProbe(createDetectedStacksProbe(resources.dir));

    expect(result).toEqual({ state: "value", value: ["typescript", "expo"] });
  });

  it("returns an explicit empty value when no stack is detected", async () => {
    const result = await runProbe(createDetectedStacksProbe(resources.dir));

    expect(result).toEqual({ state: "value", value: [] });
  });

  it("degrades to unknown when the detector registry throws", async () => {
    const registry = new DetectorRegistry([
      {
        type: "typescript",
        detect: async (): Promise<boolean> => {
          throw new Error("detector exploded");
        },
      },
    ]);

    const result = await runProbe(
      createDetectedStacksProbe(resources.dir, registry)
    );

    expect(result.state).toBe("unknown");
    if (result.state === "unknown") {
      expect(result.reason).toBe("probe-failed");
      expect(result.message).toContain("detector exploded");
    }
  });

  it("registers in the default /api/status snapshot with sibling probes", async () => {
    await writeFile(path.join(resources.dir, "tsconfig.json"), "{}", "utf8");
    await writeFile(path.join(resources.dir, "app.json"), "{}", "utf8");

    resources.server = await runUi(resources.dir, { port: "0", sync: false });

    const address = resources.server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/api/status`);
    const snapshot = (await response.json()) as {
      probes: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(snapshot.probes[DETECTED_STACKS_PROBE_ID]).toEqual({
      state: "value",
      value: ["typescript", "expo"],
    });
    expect(snapshot.probes).toHaveProperty("github-auth");
    expect(snapshot.probes).toHaveProperty("enabled-plugins");
    expect(snapshot.probes).toHaveProperty("lisa-version");
    expect(snapshot.probes).toHaveProperty("deploy-pipeline-stages");
  });
});
