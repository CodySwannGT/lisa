/** Actual installed OpenCode callback → canonical wrapper → real built detector. */
import * as fs from "fs-extra";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installHooks } from "../../../src/opencode/hooks-installer.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

useIoLatencyBudget();
const ROOT = process.cwd();
const GIT = resolveGit();
const ADAPTER = "lisa-block-host-name-leak.ts";
const NAME = "notarealhostproject";
const REFUSAL = "BLOCKED: this tracker write names a host project.";
const INACTIVE_WARNING = "NOT active";
const CALLBACK = path.join(
  ROOT,
  "tests/fixtures/opencode/host-name-guard-callback.mjs"
);
const SUPPORT = [
  "block-host-name-leak.sh",
  "block-host-name-leak.mjs",
  "host-name-command-context.mjs",
];

/**
 * Keep fixture Git/gh reads isolated from real credentials and repository state.
 * @returns Isolated child environment with the synthetic name extension.
 */
const fixtureEnv = (): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(?:GIT_|GH_|GITHUB_)/u.test(key)
    )
  ),
  GH_TOKEN: "isolated-fixture-no-network-token",
  GH_PROMPT_DISABLED: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  CDPATH: "",
  LISA_DOWNSTREAM_NAMES: NAME,
});

describe("OpenCode installed host-name guard callback (#4540)", () => {
  let temporary: string;
  let project: string;
  let host: string;
  let pluginDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    temporary = await createTempDir();
    project = path.join(temporary, "protected");
    host = path.join(project, "host");
    pluginDir = path.join(project, ".opencode/plugin");
    env = { ...fixtureEnv(), GH_CONFIG_DIR: path.join(temporary, "gh-config") };
    await fs.ensureDir(env.GH_CONFIG_DIR as string);
    await fs.ensureDir(host);
    for (const [cwd, repository] of [
      [project, "CodySwannGT/lisa"],
      [host, `acme/${NAME}`],
    ] as const) {
      for (const args of [
        ["init", "-q"],
        ["remote", "add", "origin", `https://github.com/${repository}.git`],
      ]) {
        const result = boundedSpawnSync({
          label: "isolated OpenCode Git fixture",
          command: GIT,
          args,
          cwd,
          env,
        });
        expect(result.status, result.stderr).toBe(0);
      }
    }
    await fs.ensureDir(path.join(project, "node_modules/@codyswann/lisa"));
    await fs.symlink(
      path.join(ROOT, "dist"),
      path.join(project, "node_modules/@codyswann/lisa/dist")
    );
    await installHooks(ROOT, project, [], []);
  });

  afterEach(async () => {
    await cleanupTempDir(temporary);
  });

  /**
   * Invoke only the installed adapter callback under Bun, never the tool command.
   * @param command - Command text to inspect as data.
   * @param tool - Native tool name supplied to the callback.
   * @param workdir - Actual tool directory, separate from the detector root.
   * @returns The callback verdict, refusal reason and preserved warning output.
   */
  function invoke(
    command: string,
    tool = "bash",
    workdir = project
  ): { verdict: string; reason?: string; warnings: string } {
    const result = boundedSpawnSync({
      label: "installed OpenCode host-name callback fixture",
      command: "bun",
      args: [CALLBACK, path.join(pluginDir, ADAPTER), command, tool, workdir],
      cwd: project,
      env,
      baseMs: 30_000,
    });
    expect(result.status, result.stderr).toBe(0);
    return {
      ...(JSON.parse(result.stdout.trim()) as {
        verdict: string;
        reason?: string;
      }),
      warnings: result.stderr,
    };
  }

  it.each(["sh", "bash"])(
    "refuses a protected literal %s launcher",
    launcher => {
      const result = invoke(
        `${launcher} -c 'gh issue create --repo CodySwannGT/lisa --body ${NAME}'`
      );
      expect(result.verdict).toBe("deny");
      expect(result.reason).toContain(REFUSAL);
      expect(result.reason).not.toContain(INACTIVE_WARNING);
    }
  );

  it.each(["sh", "bash"])(
    "allows a proven host literal %s launcher",
    launcher => {
      expect(
        invoke(
          `${launcher} -c 'gh issue create --repo acme/${NAME} --body ${NAME}'`
        ).verdict
      ).toBe("allow");
    }
  );

  it.each(["sh", "bash"])(
    "allows a read inside a literal %s launcher",
    launcher => {
      expect(
        invoke(
          `${launcher} -c 'gh issue view 1 --repo CodySwannGT/lisa --json body --jq "${NAME}"'`
        ).verdict
      ).toBe("allow");
    }
  );

  it("allows harmless quoted launcher prose", () => {
    expect(
      invoke(
        `printf "%s" 'bash -c gh issue create --repo CodySwannGT/lisa --body ${NAME}'`
      ).verdict
    ).toBe("allow");
  });

  it("refuses a wrapped write whose explicit repository is unresolved", () => {
    const result = invoke(
      `sh -c 'gh issue create --repo "$UNKNOWN_REPOSITORY" --body ${NAME}'`
    );
    expect(result.verdict).toBe("deny");
    expect(result.reason).toContain(REFUSAL);
  });

  it("uses the actual tool workdir independently from the detector root", () => {
    expect(
      invoke(`sh -c 'gh issue create --body ${NAME}'`, "bash", host).verdict
    ).toBe("allow");
    expect(invoke(`sh -c 'gh issue create --body ${NAME}'`).verdict).toBe(
      "deny"
    );
  });

  it("does not execute an inspected script or later command", async () => {
    const sentinel = path.join(project, "must-not-exist");
    expect(
      invoke(
        `bash -c 'gh issue create --repo CodySwannGT/lisa --body ${NAME}'; touch '${sentinel}'`
      ).verdict
    ).toBe("deny");
    expect(await fs.pathExists(sentinel)).toBe(false);
  });

  it.each(SUPPORT.slice(1))(
    "allows with a visible NOT-active warning when %s is absent",
    async filename => {
      await fs.remove(path.join(pluginDir, filename));
      const result = invoke(
        `sh -c 'gh issue create --repo CodySwannGT/lisa --body ${NAME}'`
      );
      expect(result.verdict).toBe("allow");
      expect(result.warnings).toContain(INACTIVE_WARNING);
    }
  );

  it("allows with a visible NOT-active warning when the real detector is absent", async () => {
    await fs.remove(path.join(project, "node_modules/@codyswann/lisa/dist"));
    const result = invoke(
      `sh -c 'gh issue create --repo CodySwannGT/lisa --body ${NAME}'`
    );
    expect(result.verdict).toBe("allow");
    expect(result.warnings).toContain("denylist not found");
    expect(result.warnings).toContain(INACTIVE_WARNING);
  });

  it("reports a non-policy failure from an explicitly labelled isolated shim", async () => {
    await fs.writeFile(
      path.join(pluginDir, SUPPORT[0] as string),
      "#!/bin/bash\nexec 0<&-\necho isolated-fixture-failure >&2\nexit 127\n"
    );
    const result = invoke("printf clean");
    expect(result.verdict).toBe("deny");
    expect(result.reason).toContain("guard environment failure (status 127)");
    expect(result.reason).toContain("isolated-fixture-failure");
    expect(result.reason).not.toContain("EPIPE");
  });

  it("ignores a non-bash tool and an empty command", () => {
    expect(invoke(`gh issue create --body ${NAME}`, "edit").verdict).toBe(
      "allow"
    );
    expect(invoke("").verdict).toBe("allow");
  });

  it("installs the actual adapter and byte-identical canonical companions", async () => {
    expect(await fs.readFile(path.join(pluginDir, ADAPTER))).toEqual(
      await fs.readFile(
        path.join(ROOT, "src/opencode/plugin-templates", ADAPTER)
      )
    );
    for (const filename of SUPPORT)
      expect(
        await fs.readFile(path.join(pluginDir, filename)),
        filename
      ).toEqual(
        await fs.readFile(path.join(ROOT, "plugins/lisa/hooks", filename))
      );
  });
});
