/**
 * The `lisa-release-switch` command (CodySwannGT/lisa#5188): what every agent
 * runs to read the `release.*` setting, run readiness gate S22, render the
 * `## Release Switch` declaration, find leftover switch references and print
 * the no-live-users notice.
 * @module tests/unit/scripts/lisa-release-switch-cli
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv, GIT_BIN } from "../../support/git-executable.js";

import { runCli } from "../../../all/copy-overwrite/scripts/lisa-release-switch.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

const RUNTIME_BODY =
  "## Context / Business Value\n\nWork.\n\n## Target Backend Environment\n\nproduction\n";
const CWD = "--cwd";
const BODY_FILE = "--body-file";
const SWITCH = "new-checkout";
const SOURCE_FILE = "checkout.js";
const PRODUCTION = { deploy: { branches: { production: "main" } } };

/**
 * A project root holding a committed config (or raw config text) and a body.
 * @param config - `.lisa.config.json` contents, or raw text to write as-is.
 * @param body - Work-item body.
 * @returns Root path and body file path.
 */
function project(
  config: object | string,
  body = RUNTIME_BODY
): { root: string; body: string } {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-release-cli-"));
  roots.push(root);
  writeFileSync(
    path.join(root, ".lisa.config.json"),
    typeof config === "string" ? config : JSON.stringify(config)
  );
  const bodyFile = path.join(root, "body.md");
  writeFileSync(bodyFile, body);
  return { root, body: bodyFile };
}

/**
 * Run the CLI and capture its output.
 * @param argv - Arguments after the script name.
 * @returns Exit code and captured streams.
 */
function run(argv: string[]): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = runCli(argv, {
    stdout: { write: (text: string) => out.push(text) },
    stderr: { write: (text: string) => err.push(text) },
  });
  return { code, out: out.join(""), err: err.join("") };
}

describe("lisa-release-switch config", () => {
  it("shows a project that says nothing as having live users, with the fallback mechanism", () => {
    const { root } = project(PRODUCTION);
    const result = run(["config", CWD, root]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toMatchObject({
      liveUsers: true,
      liveUsersSource: "default",
      mechanism: "config-value",
      mechanismSource: "default",
      guide: null,
      problems: [],
      productionBranch: "main",
      turnOn: "agent",
    });
  });

  it("shows a pre-launch project as having no live users", () => {
    const { root } = project({ release: { liveUsers: false } });
    expect(JSON.parse(run(["config", CWD, root]).out)).toMatchObject({
      liveUsers: false,
      liveUsersSource: "declared",
    });
  });

  it("reports an invalid value by name and assumes nothing weaker", () => {
    const { root } = project({ release: { liveUsers: "nope" } });
    const setting = JSON.parse(run(["config", CWD, root]).out);
    expect(setting.liveUsers).toBe(true);
    expect(setting.liveUsersSource).toBe("invalid");
    expect(setting.problems.join(" ")).toContain("release.liveUsers");
  });

  it("shows the named mechanism, its guide, and a reserved turn-on", () => {
    const { root } = project({
      release: {
        switch: { mechanism: "hosted-flags", guide: "docs/flags.md" },
      },
      humanGate: { humanOnly: ["feature-release"] },
    });
    expect(JSON.parse(run(["config", CWD, root]).out)).toMatchObject({
      mechanism: "hosted-flags",
      mechanismSource: "declared",
      guide: "docs/flags.md",
      turnOn: "human",
    });
  });

  it("lets the local override win", () => {
    const { root } = project({ release: { liveUsers: true } });
    writeFileSync(
      path.join(root, ".lisa.config.local.json"),
      JSON.stringify({ release: { liveUsers: false } })
    );
    expect(JSON.parse(run(["config", CWD, root]).out).liveUsers).toBe(false);
  });
});

describe("lisa-release-switch check (gate S22)", () => {
  it("fails a proposed runtime-changing item with no declaration", () => {
    const { root, body } = project({});
    const result = run(["check", CWD, root, BODY_FILE, body]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("S22 release switch: FAIL");
  });

  it("does not fail an existing item with no declaration", () => {
    const { root, body } = project({});
    const result = run([
      "check",
      CWD,
      root,
      "--existing",
      "true",
      BODY_FILE,
      body,
    ]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("S22 release switch: N/A");
  });

  it("passes a declared item", () => {
    const { root, body } = project(
      {},
      `${RUNTIME_BODY}\n## Release Switch\n\nLive — complete and proven at merge\n`
    );
    const result = run(["check", CWD, root, BODY_FILE, body]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("S22 release switch: PASS");
  });

  it("is not applicable in a project without live users", () => {
    const { root, body } = project({ release: { liveUsers: false } });
    const result = run(["check", CWD, root, BODY_FILE, body]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("S22 release switch: N/A");
  });
});

describe("lisa-release-switch render", () => {
  it("prints the body with the declaration in place, and the result passes the gate", () => {
    const { root, body } = project({});
    const rendered = run([
      "render",
      CWD,
      root,
      "--mode",
      "off",
      "--switch",
      SWITCH,
      "--removed-by",
      "#12",
      BODY_FILE,
      body,
    ]);
    expect(rendered.code).toBe(0);
    expect(rendered.out).toContain(`Switched off — ${SWITCH}; removed by #12`);
    writeFileSync(body, rendered.out);
    expect(run(["check", CWD, root, BODY_FILE, body]).code).toBe(0);
    expect(readFileSync(body, "utf8")).toContain("## Context / Business Value");
  });

  it("exits 2 on a mode it does not know", () => {
    const { root } = project({});
    const result = run(["render", CWD, root, "--mode", "maybe"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("--mode must be live or off");
  });
});

describe("lisa-release-switch references", () => {
  /**
   * Turn a project root into a git repository with one source file.
   * @param root - Project root.
   * @param source - Contents of `checkout.js`.
   */
  function commit(root: string, source: string): void {
    const git = (...args: string[]): string =>
      boundedExecFileSync({
        label: `git ${args[0] ?? ""} (release-switch CLI fixture)`,
        command: GIT_BIN,
        args,
        cwd: root,
        env: cleanGitEnv(),
      });
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "Test");
    git("config", "commit.gpgsign", "false");
    writeFileSync(path.join(root, SOURCE_FILE), source);
    git("add", SOURCE_FILE);
    git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "fixture");
  }

  it("names the files and exits 1 while the switch is still referenced", () => {
    const { root } = project({});
    commit(root, `if (flag("${SWITCH}")) show();\n`);
    const result = run(["references", CWD, root, "--switch", SWITCH]);
    expect(result.code).toBe(1);
    expect(result.out).toContain(SOURCE_FILE);
  });

  it("exits 0 once the switch is gone", () => {
    const { root } = project({});
    commit(root, "show();\n");
    const result = run(["references", CWD, root, "--switch", SWITCH]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("not referenced");
  });
});

describe("lisa-release-switch notice", () => {
  it("prints the notice for a production deployment with the rule off, and exits 0", () => {
    const { root } = project({ ...PRODUCTION, release: { liveUsers: false } });
    const result = run(["notice", CWD, root, "--base", "main"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("release.liveUsers");
    expect(result.out).toContain("Nothing was blocked");
  });

  it("prints nothing for a project with live users", () => {
    const { root } = project(PRODUCTION);
    const result = run(["notice", CWD, root, "--base", "main"]);
    expect(result).toEqual({ code: 0, out: "", err: "" });
  });

  it("never fails a deployment report, even when the config cannot be read", () => {
    const { root } = project("{ not json");
    const result = run(["notice", CWD, root, "--base", "main"]);
    expect(result.code).toBe(0);
    expect(result.err).toContain("lisa-release-switch:");
  });
});

describe("lisa-release-switch usage", () => {
  it("exits 2 on an unknown command or flag", () => {
    expect(run(["nope"]).code).toBe(2);
    const { root } = project({});
    expect(run(["check", CWD, root, "--bogus", "1"]).code).toBe(2);
  });

  it("exits 2 when the config cannot be read for a check", () => {
    const { root, body } = project("{ not json");
    expect(run(["check", CWD, root, BODY_FILE, body]).code).toBe(2);
  });
});
