/**
 * Tests for bounded, no-follow project stack detection.
 * @module tests/unit/cli/detected-stacks
 */
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConfinedDetectedStacks } from "../../../src/cli/detected-stacks.js";

/** Holder for per-test temp resources. */
interface TestResources {
  dir: string;
}

const resources: TestResources = { dir: "" };

beforeEach(async () => {
  resources.dir = await mkdtemp(path.join(tmpdir(), "lisa-detected-stacks-"));
});

afterEach(async () => {
  await rm(resources.dir, { recursive: true, force: true });
});

describe("readConfinedDetectedStacks", () => {
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

  it("returns expanded, ordered project types for a detected fixture", async () => {
    await writeFile(path.join(resources.dir, "tsconfig.json"), "{}", "utf8");
    await writeFile(path.join(resources.dir, "app.json"), "{}", "utf8");

    expect(await readConfinedDetectedStacks(resources.dir)).toEqual([
      "typescript",
      "expo",
    ]);
  });

  it("returns an explicit empty list when no stack is detected", async () => {
    expect(await readConfinedDetectedStacks(resources.dir)).toEqual([]);
  });
});
