import { execFileSync } from "node:child_process";
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const ROOT = process.cwd();
const CLAUDE_INSTALL_PKGS = path.join(
  ROOT,
  "plugins/src/base/hooks/install-pkgs.sh"
);
const CODEX_INSTALL_PKGS = path.join(ROOT, "src/codex/scripts/install-pkgs.sh");

describe("install-pkgs worktree node_modules handoff", () => {
  let tempDir: string;
  let primaryRoot: string;
  let worktreeRoot: string;
  let fakeBin: string;
  let installMarker: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    primaryRoot = path.join(tempDir, "project");
    worktreeRoot = path.join(primaryRoot, ".claude", "worktrees", "feature");
    fakeBin = path.join(tempDir, "bin");
    installMarker = path.join(tempDir, "package-manager-ran");

    await fs.ensureDir(path.join(primaryRoot, "node_modules", ".bin"));
    await fs.ensureDir(worktreeRoot);
    await fs.writeFile(
      path.join(worktreeRoot, "package.json"),
      '{"name":"fixture"}\n',
      "utf8"
    );
    await fs.ensureDir(fakeBin);
    await writeExecutable(
      path.join(fakeBin, "git"),
      '#!/usr/bin/env bash\nif [ "$1" = "rev-parse" ] && [ "$2" = "--show-toplevel" ]; then pwd; exit 0; fi\nexit 1\n'
    );
    await writeExecutable(
      path.join(fakeBin, "uname"),
      "#!/usr/bin/env bash\necho Darwin\n"
    );

    for (const name of ["bun", "npm", "pnpm", "yarn"]) {
      await writeExecutable(
        path.join(fakeBin, name),
        `#!/usr/bin/env bash\ntouch "${installMarker}"\nexit 42\n`
      );
    }
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it.each([
    ["Claude/plugin", CLAUDE_INSTALL_PKGS],
    ["Codex", CODEX_INSTALL_PKGS],
  ])(
    "%s hook links primary node_modules before installing",
    (_name, script) => {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- Test-only PATH shim fakes git and package managers.
      const output = execFileSync("bash", [script], {
        cwd: worktreeRoot,
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
        stdio: "pipe",
      });

      expect(output.toString("utf8")).toBe("");
      expect(fs.realpathSync(path.join(worktreeRoot, "node_modules"))).toBe(
        fs.realpathSync(path.join(primaryRoot, "node_modules"))
      );
      expect(fs.existsSync(installMarker)).toBe(false);
    }
  );

  it.each([
    ["Claude/plugin", CLAUDE_INSTALL_PKGS],
    ["Codex", CODEX_INSTALL_PKGS],
  ])(
    "%s hook keeps package-manager output off stdout",
    async (_name, script) => {
      const projectRoot = path.join(tempDir, `install-${_name}`);
      fs.ensureDirSync(projectRoot);
      fs.writeFileSync(
        path.join(projectRoot, "package.json"),
        '{"name":"fixture","engines":{"npm":"please-use-npm"}}\n',
        "utf8"
      );

      await writeExecutable(
        path.join(fakeBin, "npm"),
        `#!/usr/bin/env bash\necho "fake npm stdout"\necho "fake npm stderr" >&2\ntouch "${installMarker}"\nexit 0\n`
      );

      // eslint-disable-next-line sonarjs/no-os-command-from-path -- Test-only PATH shim fakes git and package managers.
      const output = execFileSync("bash", [script], {
        cwd: projectRoot,
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
        stdio: "pipe",
      });

      expect(output.toString("utf8")).toBe("");
      expect(fs.existsSync(installMarker)).toBe(true);
    }
  );
});

/**
 * Write a small executable helper used by the shell-hook fixture.
 *
 * @param file - Destination file path.
 * @param content - Complete script body.
 */
async function writeExecutable(file: string, content: string): Promise<void> {
  await fs.writeFile(file, content, "utf8");
  // eslint-disable-next-line sonarjs/file-permissions -- Fixture scripts need execute bits to behave like real CLIs.
  await fs.chmod(file, 0o755);
}
