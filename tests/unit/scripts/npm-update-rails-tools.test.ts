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
