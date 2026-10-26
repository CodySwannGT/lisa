/** Owned executable/pipe fixtures exercise qualification; synthetic Docker replies are not vendor/runtime proof. */
import { describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();

const observation = vi.hoisted(() => ({ path: "", reads: 0 }));
vi.mock("node:fs", async importOriginal => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    readFileSync: (...args: Parameters<typeof original.readFileSync>) => {
      if (args[0] === observation.path) observation.reads++;
      return original.readFileSync(...args);
    },
  };
});

const digest = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

async function fixture(operation: (value: any) => Promise<void>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rails-tools-")));
  const config = join(root, "docker-config");
  mkdirSync(config, { mode: 0o700 });
  writeFileSync(join(config, "config.json"), "{}\n", {
    mode: 0o600,
    flag: "wx",
  });
  const file = join(root, "docker");
  writeFileSync(
    file,
    '#!/bin/sh\ncase "$1" in --version) echo "Docker version 29.8.2, build synthetic" ;; info) echo \'{"ID":"synthetic-engine","OSType":"linux"}\' ;; *) exit 17 ;; esac\n',
    { mode: 0o700, flag: "wx" }
  );
  const docker = {
    path: file,
    sha256: digest(file),
    version: "29.8.2",
    engineId: "synthetic-engine",
    env: { HOME: root, PATH: "/usr/bin:/bin", DOCKER_CONFIG: config },
  };
  try {
    await operation({ root, file, docker, config });
  } finally {
    rmSync(root, { recursive: true });
  }
}

describe("closed native Rails tool qualification", () => {
  it.each([false, true])(
    "uses one immutable Ubuntu snapshot for native package update and install (browser=%s)",
    async browser => {
      const { installRailsPackages } =
        await import("../../../all/copy-overwrite/scripts/lib/npm-update-rails-tools.mjs");
      const { runProcess } =
        await import("../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs");
      await fixture(async ({ root }) => {
        // The native child models a retired moving-mirror pin, not an Ubuntu install.
        const entry = join(root, "apt-transport.mjs");
        writeFileSync(
          entry,
          'const args = process.argv.slice(2); if (args[0] !== "-n" || args[1] !== "/usr/bin/apt-get" || !args.includes("--snapshot=20261013T000000Z")) process.exit(17); process.stdout.write(JSON.stringify(args));\n',
          { flag: "wx", mode: 0o600 }
        );
        const calls: string[][] = [];
        const libraries = await installRailsPackages(
          async (command: string, args: string[]) => {
            expect(command).toBe("/usr/bin/sudo");
            const result = await runProcess(
              process.execPath,
              [entry, ...args],
              {
                env: { HOME: root, PATH: "/usr/bin:/bin" },
                timeout: 2000,
                maximum: 4096,
              }
            );
            calls.push(JSON.parse(result.stdout.toString()));
            return result;
          },
          browser
        );
        expect(calls).toHaveLength(2);
        expect(calls[0]).toContain("update");
        expect(calls[1]).toContain("install");
        expect(calls[1]).toContain(
          "libmariadb-dev=1:10.11.14-0ubuntu0.24.04.1"
        );
        expect(calls[1]).toContain(
          "libmariadb-dev-compat=1:10.11.14-0ubuntu0.24.04.1"
        );
        expect(calls[1]?.filter(value => value.includes("="))).toHaveLength(
          browser ? 22 : 3
        );
        expect(libraries).toHaveLength(browser ? 19 : 0);
      });
    }
  );
  it("keeps the complete browser roster while pinning the libx11 security update", async () => {
    const { installRailsPackages } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-rails-tools.mjs");
    const calls: string[][] = [];
    const libraries = await installRailsPackages(
      async (_command: string, args: string[]) => {
        calls.push(args);
        return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      },
      true
    );
    expect(libraries).toContain("libx11-xcb1=2:1.8.7-1ubuntu0.1");
    expect(libraries.map((value: string) => value.split("=")[0])).toEqual([
      "fonts-liberation",
      "libasound2t64",
      "libatk-bridge2.0-0t64",
      "libatk1.0-0t64",
      "libcairo2",
      "libcups2t64",
      "libdbus-1-3",
      "libdrm2",
      "libgbm1",
      "libglib2.0-0t64",
      "libnss3",
      "libpango-1.0-0",
      "libx11-xcb1",
      "libxcomposite1",
      "libxdamage1",
      "libxext6",
      "libxfixes3",
      "libxkbcommon0",
      "libxrandr2",
    ]);
    expect(calls.flat()).not.toContain("--allow-downgrades");
  });
  it.each(["update", "install"])(
    "retains the original native %s refusal with its finite package phase",
    async operation => {
      const tools =
        await import("../../../all/copy-overwrite/scripts/lib/npm-update-rails-tools.mjs");
      const failure = Object.freeze(
        new Error("private native package refusal")
      );
      await expect(
        tools.installRailsPackages(async (_command: string, args: string[]) => {
          if (args.includes(operation)) throw failure;
          return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
        }, true)
      ).rejects.toBe(failure);
      expect(tools.railsPackageFailurePhase(failure)).toBe(`apt-${operation}`);
      expect(tools.railsPackageFailurePhase(new Error("unknown"))).toBe(null);
    }
  );
  it("refuses an aliased Ruby path before reading its synthetic foreign target", async () => {
    const { qualifyRailsRuby } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-rails-tool-identity.mjs");
    await fixture(async ({ root, file }) => {
      const alias = join(root, "ruby");
      symlinkSync(file, alias);
      observation.path = alias;
      observation.reads = 0;
      try {
        await expect(
          qualifyRailsRuby({ PATH: root, HOME: root }, Date.now() + 10000)
        ).rejects.toThrow(/aliased/);
        expect(observation.reads).toBe(0);
      } finally {
        observation.path = "";
      }
    });
  });
  it("pins actual owned Ruby/Bundler command files around their synthetic native version replies", async () => {
    const { qualifyRailsRuby } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-rails-tool-identity.mjs");
    await fixture(async ({ root }) => {
      const tools: [string, string][] = [
        ["ruby", "ruby 3.4.11 synthetic"],
        ["bundle", "Bundler version 2.4.10"],
      ];
      for (const [name, text] of tools)
        writeFileSync(
          join(root, name),
          `#!/bin/sh\nprintf '%s\\n' '${text}'\n`,
          { flag: "wx", mode: 0o700 }
        );
      const result = await qualifyRailsRuby(
        { PATH: root, HOME: root },
        Date.now() + 10000
      );
      expect(result).toMatchObject({
        ruby: { sha256: digest(join(root, "ruby")) },
        bundle: { sha256: digest(join(root, "bundle")) },
      });
      writeFileSync(
        join(root, "ruby"),
        '#!/bin/sh\nprintf "replacement" > "$0"\nprintf "ruby 3.4.11 synthetic\\n"\n'
      );
      await expect(
        qualifyRailsRuby({ PATH: root, HOME: root }, Date.now() + 10000)
      ).rejects.toThrow(/identity changed/);
    });
  });
  it("refuses a mismatched signed runtime before any native installation or private write", async () => {
    const { prepareRailsTools } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-rails-tools.mjs");
    await fixture(async ({ root }) => {
      const profile = {
        profile: "rails-mysql",
        database: "runtime",
        browser: false,
        dockerFixtures: false,
      };
      const before = readFileSync(join(root, "docker-config/config.json"));
      await expect(
        prepareRailsTools(
          {
            policy: { runtime: profile },
            proposal: { runtimeSha256: "0".repeat(64) },
          },
          root,
          {},
          profile
        )
      ).rejects.toThrow(/committed Rails runtime/);
      expect(readFileSync(join(root, "docker-config/config.json"))).toEqual(
        before
      );
    });
  });
  it("rechecks real executable bytes and genuine child status for each Docker identity observation", async () => {
    const { assertDockerQualified } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-rails-tools.mjs");
    await fixture(async ({ docker, file }) => {
      await assertDockerQualified(docker, Date.now() + 10000);
      writeFileSync(file, "#!/bin/sh\nexit 0\n");
      await expect(
        assertDockerQualified(docker, Date.now() + 10000)
      ).rejects.toThrow(/identity/);
    });
  });
  it("refuses native symlink aliases before executing and preserves the foreign executable", async () => {
    const { assertDockerQualified } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-rails-tools.mjs");
    await fixture(async ({ docker, file, root }) => {
      const alias = join(root, "alias");
      symlinkSync(file, alias);
      const before = readFileSync(file);
      await expect(
        assertDockerQualified({ ...docker, path: alias }, Date.now() + 10000)
      ).rejects.toThrow(/identity/);
      expect(readFileSync(file)).toEqual(before);
    });
  });
  it.each(["foreign-engine", "windows"])(
    "refuses changed synthetic daemon identity %s from an actual child",
    async value => {
      const { assertDockerQualified } =
        await import("../../../all/copy-overwrite/scripts/lib/npm-update-rails-tools.mjs");
      await fixture(async ({ docker, file }) => {
        const data = {
          ID: value === "windows" ? docker.engineId : value,
          OSType: value === "windows" ? value : "linux",
        };
        writeFileSync(
          file,
          `#!/bin/sh\ncase "$1" in --version) echo "Docker version 29.8.2, build synthetic" ;; info) echo '${JSON.stringify(data)}' ;; esac\n`
        );
        await expect(
          assertDockerQualified(
            { ...docker, sha256: digest(file) },
            Date.now() + 10000
          )
        ).rejects.toThrow(/daemon/);
      });
    }
  );
  it("never interprets native query failure as missing daemon state", async () => {
    const { assertDockerQualified } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-rails-tools.mjs");
    await fixture(async ({ docker, file }) => {
      writeFileSync(
        file,
        '#!/bin/sh\ncase "$1" in --version) echo "Docker version 29.8.2, build synthetic" ;; *) exit 17 ;; esac\n'
      );
      await expect(
        assertDockerQualified(
          { ...docker, sha256: digest(file) },
          Date.now() + 10000
        )
      ).rejects.toMatchObject({ code: 17 });
    });
  });
  it("refuses inherited credential helpers or controller authority before native tool invocation", async () => {
    const { assertDockerQualified } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-rails-tools.mjs");
    await fixture(async ({ docker, config }) => {
      await expect(
        assertDockerQualified(
          { ...docker, env: { ...docker.env, GH_TOKEN: "synthetic" } },
          Date.now() + 10000
        )
      ).rejects.toThrow(/environment/);
      writeFileSync(
        join(config, "config.json"),
        '{"credsStore":"synthetic"}\n'
      );
      await expect(
        assertDockerQualified(docker, Date.now() + 10000)
      ).rejects.toThrow(/configuration/);
    });
  });
  it("refuses an expired original deadline before executing the owned native tool", async () => {
    const { assertDockerQualified } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-rails-tools.mjs");
    await fixture(async ({ docker }) => {
      await expect(
        assertDockerQualified(docker, Date.now() - 1)
      ).rejects.toThrow(/deadline/);
    });
  });
});
