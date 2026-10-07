/** Owned filesystem fixtures; package metadata is protocol data, not release proof. */
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const BOTH_GUARDS = "parity-safety-net,block-no-verify";
export const DIRTY_TEXT = "uncommitted application work\n";
export const HOOK_DIRECTORY = "scripts/lisa-hooks";
export const COPY_DIRECTORY = "all/copy-overwrite";
export const PARITY_NAME = "parity-safety-net.sh";
export const PARITY = `${HOOK_DIRECTORY}/${PARITY_NAME}`;
export const DEDUPE_NAME = "guard-dedupe.bash";
export const DEDUPE = `${HOOK_DIRECTORY}/${DEDUPE_NAME}`;
export const OLD_PARITY = "# old parity-safety-net.sh\n";
export const OLD_DEDUPE = "# old guard-dedupe.bash\n";
export const CONFIG_TEXT = '{"harness":"codex"}\n';
export const hookNames = [
  PARITY_NAME,
  "parity-safety-net-heredoc.py",
  "guard-dedupe.bash",
  "block-no-verify.sh",
];

/** Keep cleanup authority limited to roots created by this fixture instance. */
class Fixtures {
  private readonly roots: string[] = [];

  /**
   * Create a dirty host and complete package identity/ledger fixture.
   * @returns Owned paths and synthetic shipping hashes.
   */
  async create() {
    const root = await mkdtemp(path.join(os.tmpdir(), "lisa-hooks-refresh-"));
    this.roots.push(root);
    const host = path.join(root, "host");
    const packageDir = path.join(root, "package");
    await mkdir(path.join(host, HOOK_DIRECTORY), { recursive: true });
    await mkdir(path.join(packageDir, COPY_DIRECTORY, HOOK_DIRECTORY), {
      recursive: true,
    });
    await writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({
        name: "@codyswann/lisa",
        version: "4.71.2",
        lisaReleaseTag: "v4.71.2",
        lisaReleaseCommit: "a".repeat(40),
      })
    );
    const ledger = Object.fromEntries(
      hookNames.map(name => [
        `${HOOK_DIRECTORY}/${name}`,
        ["old", "current"].map(version =>
          createHash("sha256").update(`# ${version} ${name}\n`).digest("hex")
        ),
      ])
    );
    for (const name of hookNames) {
      await writeFile(path.join(host, HOOK_DIRECTORY, name), `# old ${name}\n`);
      await writeFile(
        path.join(packageDir, COPY_DIRECTORY, HOOK_DIRECTORY, name),
        `# current ${name}\n`
      );
    }
    await writeFile(path.join(host, "dirty.txt"), DIRTY_TEXT);
    await writeFile(path.join(host, ".lisa.config.json"), CONFIG_TEXT);
    return { host, packageDir, ledger };
  }

  /** Remove only registered roots created by the current fixture. */
  async cleanup(): Promise<void> {
    await Promise.all(
      this.roots.splice(0).map(async root => {
        await rm(root, { recursive: true, force: true });
        await lstat(root).then(
          () => {
            throw new Error("Owned refresh fixture remains after cleanup");
          },
          error => {
            if (
              !(error instanceof Error) ||
              !("code" in error) ||
              error.code !== "ENOENT"
            )
              throw error;
          }
        );
      })
    );
  }
}

const fixtures = new Fixtures();
/**
 * Create one owned protocol fixture.
 * @returns A new fixture.
 */
export const fixture = () => fixtures.create();
/**
 * Remove only registered fixture roots.
 * @returns Completion of owned fixture cleanup.
 */
export const cleanupFixtures = () => fixtures.cleanup();
