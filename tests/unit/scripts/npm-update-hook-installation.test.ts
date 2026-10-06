/** Installation readback fixtures exercise bytes and paths, not a qualified hook-manager runtime. */
import { describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sha256 } from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";
import { originalHookInstallation } from "../../../all/copy-overwrite/scripts/lib/npm-update-hook-installation.mjs";

const hooks = ["pre-commit", "prepare-commit-msg", "commit-msg", "pre-push"];
const CONFIGURATION_FILE = "lefthook.yml";

async function fixture(operation: (state: any) => Promise<void>) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "lisa-original-hooks-")));
  const directory = join(cwd, ".git/hooks");
  mkdirSync(directory, { recursive: true });
  const configuration = Buffer.from(
    "pre-push:\n  commands:\n    original:\n      run: original-fixture-command\n"
  );
  writeFileSync(join(cwd, CONFIGURATION_FILE), configuration);
  const digests: Record<string, string> = {};
  for (const name of hooks) {
    const bytes = Buffer.from(
      `#!/bin/sh\nexec original-fixture-manager run ${name} "$@"\n`
    );
    writeFileSync(join(directory, name), bytes, { mode: 0o700 });
    digests[name] = sha256(bytes);
  }
  const calls: string[][] = [];
  const command = async (args: string[]) => {
    calls.push(args);
    if (args.join(" ") === "rev-parse --git-path hooks")
      return { stdout: Buffer.from(`${directory}\n`) };
    if (args.join(" ") === "show HEAD:lefthook.yml")
      return { stdout: configuration };
    throw Error("unexpected fixture Git request");
  };
  try {
    await operation({
      cwd,
      directory,
      command,
      calls,
      authority: { manager: "lefthook", wrappers: digests },
    });
  } finally {
    rmSync(cwd, { recursive: true });
  }
}

describe("original hook installation readback", () => {
  it("uses Git's resolved installed path and preserves the observed original wrapper/configuration", async () => {
    await fixture(async state => {
      const result = await originalHookInstallation(
        state.cwd,
        state.command,
        state.authority
      );
      expect(result.manager).toBe("lefthook");
      expect(result.path).toBe(join(state.directory, "pre-push"));
      expect(result.source).toBe(CONFIGURATION_FILE);
      expect(result.wrapperSha256).toBe(state.authority.wrappers["pre-push"]);
      expect(state.calls[0]).toEqual(["rev-parse", "--git-path", "hooks"]);
    });
  });
  it("refuses any changed original commit or push wrapper before returning execution authority", async () => {
    await fixture(async state => {
      writeFileSync(join(state.directory, "commit-msg"), "#!/bin/sh\nexit 0\n");
      await expect(
        originalHookInstallation(state.cwd, state.command, state.authority)
      ).rejects.toThrow(/wrapper/);
    });
  });
  it("refuses configuration bytes changed after the committed baseline", async () => {
    await fixture(async state => {
      writeFileSync(
        join(state.cwd, CONFIGURATION_FILE),
        "pre-push:\n  skip: true\n"
      );
      await expect(
        originalHookInstallation(state.cwd, state.command, state.authority)
      ).rejects.toThrow(/committed source/);
    });
  });
  it("refuses aliases and refuses an unqualified Lefthook installation", async () => {
    await fixture(async state => {
      await expect(
        originalHookInstallation(state.cwd, state.command)
      ).rejects.toThrow(/qualification/);
      rmSync(join(state.directory, "pre-push"));
      symlinkSync(
        join(state.directory, "pre-commit"),
        join(state.directory, "pre-push")
      );
      await expect(
        originalHookInstallation(state.cwd, state.command, state.authority)
      ).rejects.toThrow(/aliased/);
    });
  });
});
