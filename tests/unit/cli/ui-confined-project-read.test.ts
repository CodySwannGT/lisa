/** Red-leg coverage for bounded localhost project reads. */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readConfinedMergedConfig } from "../../../src/cli/ui-confined-project-read.js";

const roots: string[] = [];
const CONFIG_RELATIVE = ".lisa.config.json";

/**
 * Create a disposable fixture root tracked for cleanup.
 * @param prefix - Temporary-directory prefix
 * @returns Created fixture root
 */
async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true }))
  );
});

describe("confined UI project reads", () => {
  it("rejects an external config symlink instead of importing its values", async () => {
    const project = await temporaryRoot("lisa-ui-confined-project-");
    const outside = await temporaryRoot("lisa-ui-confined-outside-");
    const target = path.join(outside, "config.json");
    await writeFile(target, '{"tracker":"github"}\n');
    await symlink(target, path.join(project, CONFIG_RELATIVE));

    await expect(readConfinedMergedConfig(project)).rejects.toThrow(/Unsafe/u);
  });

  it("rejects a FIFO without opening or blocking on it", async () => {
    const project = await temporaryRoot("lisa-ui-confined-fifo-");
    execFileSync("/usr/bin/mkfifo", [path.join(project, CONFIG_RELATIVE)]);

    await expect(readConfinedMergedConfig(project)).rejects.toThrow(/Unsafe/u);
  });

  it("rejects oversized config before JSON parsing", async () => {
    const project = await temporaryRoot("lisa-ui-confined-oversize-");
    await writeFile(
      path.join(project, CONFIG_RELATIVE),
      "x".repeat(512 * 1024 + 1)
    );

    await expect(readConfinedMergedConfig(project)).rejects.toThrow(
      /exceeds size limit/u
    );
  });
});
