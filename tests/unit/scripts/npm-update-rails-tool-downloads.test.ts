/** Synthetic network chunks exercise actual exclusive file/integrity guards, not vendor download qualification. */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
  readFileSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  downloadRailsTool,
  extractRailsBrowser,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-rails-tool-downloads.mjs";

const RETAINED = "retained synthetic foreign bytes";

async function fixture(operation: (root: string) => Promise<void>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rails-download-")));
  try {
    await operation(root);
  } finally {
    rmSync(root, { recursive: true });
  }
}
afterEach(() => vi.unstubAllGlobals());
describe("closed fixed vendor downloads", () => {
  it("refuses unknown selections and expiry before creating a file or making a network request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await fixture(async root => {
      await expect(
        downloadRailsTool("other", root, Date.now() + 10000)
      ).rejects.toThrow(/unsupported/);
      await expect(
        downloadRailsTool("docker", root, Date.now() - 1)
      ).rejects.toThrow(/deadline/);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
  it.each([false, true])(
    "preserves an existing archive leaf including a foreign symlink (alias %s)",
    async alias => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await fixture(async root => {
        const foreign = join(root, "foreign");
        const target = join(root, "docker.archive");
        writeFileSync(foreign, RETAINED, {
          flag: "wx",
          mode: 0o600,
        });
        if (alias) symlinkSync(foreign, target);
        else
          writeFileSync(target, "retained archive", {
            flag: "wx",
            mode: 0o600,
          });
        await expect(
          downloadRailsTool("docker", root, Date.now() + 10000)
        ).rejects.toMatchObject({ code: "EEXIST" });
        expect(readFileSync(foreign, "utf8")).toBe(RETAINED);
        expect(readFileSync(target, "utf8")).toBe(
          alias ? RETAINED : "retained archive"
        );
        expect(fetch).not.toHaveBeenCalled();
      });
    }
  );
  it("rejects streamed substituted bytes while retaining the private failed capture", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        url: "https://synthetic.invalid/archive",
        body: (async function* () {
          yield Buffer.from("substituted vendor bytes");
        })(),
      }))
    );
    await fixture(async root => {
      await expect(
        downloadRailsTool("docker", root, Date.now() + 10000)
      ).rejects.toThrow(/integrity/);
      const file = join(root, "docker.archive");
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(readFileSync(file, "utf8")).toBe("substituted vendor bytes");
    });
  });
  it("refuses a substituted archive before any extraction subprocess or directory write", async () => {
    await fixture(async root => {
      const file = join(root, "chrome.archive");
      writeFileSync(file, "not vendor bytes", { mode: 0o600, flag: "wx" });
      const step = vi.fn();
      await expect(
        extractRailsBrowser("chrome", file, root, step)
      ).rejects.toThrow(/integrity/);
      expect(step).not.toHaveBeenCalled();
    });
  });
});
