/** An immutable local candidate, without claiming a public release or tag. */
import { accessSync, constants } from "node:fs";
import { cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { boundedExecFileSync } from "../../scripts/lib/bounded-spawn.mjs";

const GIT_CANDIDATES = [
  "/Library/Developer/CommandLineTools/usr/bin/git",
  "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
  "/usr/bin/git",
  "/opt/homebrew/bin/git",
  "/usr/local/bin/git",
];
const MANIFEST = "package.json";
const GIT_BIN = GIT_CANDIDATES.find(candidate => {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
});
const IDENTITY_PATHS = [
  "src/codex/hooks-installer.ts",
  "src/codex/project-hooks-cleanup.ts",
  "src/codex/project-overlay.ts",
  "dist/codex/hooks-installer.js",
  "dist/codex/project-hooks-cleanup.js",
  "dist/codex/project-overlay.js",
];

/**
 * Copy the index and existing build into an isolated unpublished candidate.
 * @param source Original checkout, whose metadata is never changed.
 * @param destination Disposable candidate path.
 * @returns Actual source/index/build identity and original manifest bytes.
 */
export async function createCompatibilityCandidate(source, destination) {
  if (!GIT_BIN)
    throw new Error("Git executable unavailable for candidate identity");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))
  );
  const invoke = args =>
    boundedExecFileSync(GIT_BIN, args, { cwd: source, env, encoding: "utf8" });
  const sourceHead = invoke(["rev-parse", "HEAD"]).trim();
  const indexTree = invoke(["write-tree"]).trim();
  if (![sourceHead, indexTree].every(value => /^[a-f0-9]{40}$/u.test(value)))
    throw new Error("Candidate requires actual immutable Git identities");
  const originalManifest = await readFile(path.join(source, MANIFEST));
  const copiedHashes = await copyCandidateSources(source, destination, invoke);
  const manifest = JSON.parse(
    await readFile(path.join(destination, MANIFEST), "utf8")
  );
  // Same private candidate convention as shared-runtime-hosts/artifact.ts.
  // This is actual source/index provenance, never a public publication claim.
  await writeFile(
    path.join(destination, MANIFEST),
    JSON.stringify({
      ...manifest,
      lisaReleaseCommit: sourceHead,
      gitHead: sourceHead,
      lisaReleaseTag: `v${manifest.version}`,
    })
  );
  return {
    sourceHead,
    indexTree,
    version: manifest.version,
    publicPublication: false,
    copiedHashes,
    originalManifest,
  };
}

/**
 * Copy the indexed source and verify the owning built-code bytes.
 * @param source Original checkout.
 * @param destination Disposable candidate.
 * @param invoke Bounded Git invocation against the source checkout.
 * @returns Verified source/build digests.
 */
async function copyCandidateSources(source, destination, invoke) {
  await mkdir(destination);
  invoke(["checkout-index", "--all", `--prefix=${destination}/`]);
  await cp(path.join(source, "dist"), path.join(destination, "dist"), {
    recursive: true,
  });
  await symlink(
    path.join(source, "node_modules"),
    path.join(destination, "node_modules"),
    "dir"
  );
  return Object.fromEntries(
    await Promise.all(
      IDENTITY_PATHS.map(async file => {
        const before = await readFile(path.join(source, file));
        const copied = await readFile(path.join(destination, file));
        if (!before.equals(copied))
          throw new Error(`Candidate source/build bytes differ: ${file}`);
        return [file, createHash("sha256").update(copied).digest("hex")];
      })
    )
  );
}
