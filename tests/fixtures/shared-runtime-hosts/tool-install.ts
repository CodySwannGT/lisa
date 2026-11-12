/**
 * Install the packed tool through the loopback registry, the way every host
 * installs Lisa (CodySwannGT/lisa#4636).
 *
 * The tool used to install from `file:<tarball>` with Bun's default registry
 * while every host installed through the loopback registry. Bun keys its cache
 * entries by the registry a package came from, so Lisa's dependency tree was
 * expected to be stored twice in the shared install cache, with the last
 * installer freeing both copies inside its case budget; see
 * CodySwannGT/lisa#4636 for the measured counts. Installing the tool through
 * the same registry and cache is expected to store each package once. The bytes the tool installs are still
 * compared, member by member, with the packed tarball.
 * @module tests/fixtures/shared-runtime-hosts/tool-install
 */
import * as path from "node:path";

import { assertInstalledBytes, type Candidate } from "./artifact.js";
import { toolInstallArgs } from "./install-args.js";
import { write } from "./host.js";
import { run } from "./process.js";

/** The published package the tool installs. */
const LISA = "@codyswann/lisa";

/**
 * The tool's manifest: the candidate version, requested by name.
 * @param version - The packed candidate's version
 * @returns The tool's package.json
 */
export function toolManifest(version: string) {
  return {
    name: "packed-runtime-tool",
    version: "1.0.0",
    private: true,
    dependencies: { [LISA]: version },
  } as const;
}

/**
 * Install the packed tool through the loopback registry and prove it is
 * byte-identical to the packed tarball.
 * @param candidate - The packed candidate
 * @param registry - The loopback registry URL serving it
 */
export async function installTool(
  candidate: Candidate,
  registry: string
): Promise<void> {
  const tool = path.join(candidate.root, "tool");
  const cache = candidate.env["BUN_INSTALL_CACHE_DIR"];
  if (cache === undefined) throw new Error("the candidate has no shared cache");
  write(tool, "package.json", toolManifest(candidate.version));
  await run(
    "bun",
    toolInstallArgs(registry, cache),
    tool,
    candidate.env,
    candidate.logs,
    "install-tool",
    180_000
  );
  assertInstalledBytes(candidate, path.join(tool, "node_modules", LISA));
}
