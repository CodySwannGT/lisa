/** A PATH directory with Node's own tools and no Bun, on any machine. */
import { existsSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { createTempDir } from "../../helpers/test-utils.js";

/**
 * Node's bin dir is not Bun-free: a global `npm i -g bun`, or a version
 * manager, puts `bun` right beside `node`. Mirror that install with every bin
 * entry except Bun, keeping the `bin`/`lib` layout because some `npm` launchers
 * find Node and npm relative to their own path. The caller removes the
 * returned directory's parent with `cleanupTempDir`.
 * @param nodeExecutable - Absolute path of the Node in use
 * @returns `{ root, bin }`: the owned mirror and the dir to put first on PATH
 */
export async function bunFreeNodeBin(
  nodeExecutable: string
): Promise<{ readonly root: string; readonly bin: string }> {
  const root = await createTempDir();
  const sourceBin = dirname(nodeExecutable);
  const bin = join(root, "bin");
  const lib = join(sourceBin, "..", "lib");
  mkdirSync(bin);
  for (const entry of readdirSync(sourceBin))
    if (entry !== "bun" && entry !== "bunx")
      symlinkSync(join(sourceBin, entry), join(bin, entry));
  if (existsSync(lib)) symlinkSync(lib, join(root, "lib"));
  return { root, bin };
}
