/**
 * The shapes the always-promotable contract (CodySwannGT/lisa#5188) has to
 * survive in real trackers and real configs: JIRA wiki headings, dashes as
 * people type them, bodies that quote the section, Windows line endings,
 * settings with a typo, a search started from a subfolder, and a production
 * branch written the way other tools report it. Each case here was a defect
 * found by review of the first implementation.
 * @module tests/unit/scripts/release-switch-shapes
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv, GIT_BIN } from "../../support/git-executable.js";
import { runCli } from "../../../all/copy-overwrite/scripts/lisa-release-switch.mjs";
import {
  LIVE_DECLARATION,
  RELEASE_DECISION_CLASS,
  checkDeclaration,
  parseDeclaration,
  productionBranch,
  productionNotice,
  readProjectConfig,
  removalObligation,
  renderDeclaration,
  resolveReleaseSetting,
  runtimeScope,
  switchReferences,
  turnOnOwner,
  upsertDeclaration,
} from "../../../all/copy-overwrite/scripts/lib/release-switch.mjs";
import { normalizeGateText } from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";

const LIVE_USERS = { liveUsers: true };
const SWITCH = "new-checkout";
const LIVE = { mode: "live" };
const SECTION = "## Release Switch";
const LIVE_SECTION = renderDeclaration({ mode: "live" });
const FREE_TEXT = "We will see";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * A fresh directory removed after the test.
 * @returns Absolute path
 */
function scratch(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-release-shapes-"));
  roots.push(root);
  return root;
}

describe("JIRA wiki-markup tickets", () => {
  const wiki = (declaration?: string, environment = "production"): string =>
    [
      "h2. Context / Business Value",
      "Work.",
      "",
      "h2. Target Backend Environment",
      environment,
      "",
      ...(declaration === undefined
        ? []
        : ["h2. Release Switch", declaration, ""]),
      "h2. Repository",
      "repo",
      "",
    ].join("\n");

  it("reads the environment and the declaration under h2. headings", () => {
    expect(runtimeScope(wiki())).toBe("runtime");
    expect(parseDeclaration(wiki(LIVE_DECLARATION))).toEqual(LIVE);
    expect(checkDeclaration(wiki(LIVE_DECLARATION), LIVE_USERS).verdict).toBe(
      "PASS"
    );
  });

  it("treats a doc-only JIRA ticket as not applicable, not as a failure", () => {
    const body = wiki(undefined, "None — no runtime behavior change: doc-only");
    expect(checkDeclaration(body, LIVE_USERS).verdict).toBe("N/A");
  });

  it("fails an existing JIRA ticket whose declaration is malformed", () => {
    expect(
      checkDeclaration(wiki(FREE_TEXT), LIVE_USERS, { existing: true }).verdict
    ).toBe("FAIL");
  });

  it("writes the section with the ticket's own heading spelling, and it passes", () => {
    const body = upsertDeclaration(wiki(), LIVE_SECTION);
    expect(body).toContain("h2. Release Switch\n\nLive — complete");
    expect(body).not.toContain(SECTION);
    expect(checkDeclaration(body, LIVE_USERS).verdict).toBe("PASS");
  });

  it("replaces a JIRA section in place and keeps the sections after it", () => {
    const body = upsertDeclaration(
      wiki(FREE_TEXT),
      renderDeclaration({ mode: "off", switchName: SWITCH })
    );
    expect(parseDeclaration(body)).toMatchObject({
      mode: "off",
      switchName: SWITCH,
    });
    expect(body).toContain("h2. Repository\nrepo");
    expect(body.match(/Release Switch/g)).toHaveLength(1);
  });
});

describe("dashes and case as people type them", () => {
  const item = (declaration: string): string =>
    `## Target Backend Environment\n\nproduction\n\n${SECTION}\n\n${declaration}\n`;

  it.each([
    ["an em dash", "Live — complete and proven at merge"],
    ["an en dash", "Live – complete and proven at merge"],
    ["a hyphen", "Live - complete and proven at merge"],
    ["a double hyphen", "Live -- complete and proven at merge"],
  ])("reads the live form written with %s", (_name, declaration) => {
    expect(parseDeclaration(item(declaration))).toEqual(LIVE);
  });

  it.each([["–"], ["--"], ["-"]])(
    "reads the switched-off form written with %s",
    dash => {
      expect(
        parseDeclaration(item(`Switched off ${dash} ${SWITCH}; removed by #12`))
      ).toEqual({ mode: "off", switchName: SWITCH, removedBy: "#12" });
    }
  );

  it("finds the section whatever the case of its heading", () => {
    const body = `## Target Backend Environment\n\nproduction\n\n## release switch\n\n${LIVE_DECLARATION}\n`;
    expect(parseDeclaration(body)).toEqual(LIVE);
    const replaced = upsertDeclaration(
      body,
      renderDeclaration({ mode: "off", switchName: SWITCH })
    );
    expect(replaced.match(/release switch/gi)).toHaveLength(1);
    expect(parseDeclaration(replaced)).toMatchObject({ mode: "off" });
  });

  it("recognises the item as its own remover whatever the case of the reference", () => {
    const body = item(`Switched off — ${SWITCH}; removed by Owner/Repo#12`);
    expect(removalObligation(body, "owner/repo#12")).toEqual({
      switchName: SWITCH,
    });
  });
});

describe("writing the section into awkward bodies", () => {
  it("never rewrites an example quoted inside a code fence", () => {
    const body = [
      "## Target Backend Environment",
      "",
      "production",
      "",
      "## Technical Approach",
      "",
      "```text",
      SECTION,
      "",
      "Switched off — example; removed by this item",
      "```",
      "",
    ].join("\n");
    expect(parseDeclaration(body)).toBeNull();
    const written = upsertDeclaration(body, LIVE_SECTION);
    expect(written).toContain(
      "```text\n## Release Switch\n\nSwitched off — example; removed by this item\n```"
    );
    expect(parseDeclaration(written)).toEqual(LIVE);
  });

  it("keeps Windows line endings throughout", () => {
    const body =
      "## Target Backend Environment\r\n\r\nproduction\r\n\r\n## Release Switch\r\n\r\nWe will see\r\n\r\n## Repository\r\n\r\nrepo\r\n";
    const written = upsertDeclaration(body, LIVE_SECTION);
    expect(written.replace(/\r\n/g, "")).not.toContain("\n");
    expect(written).toContain(`## Release Switch\r\n\r\n${LIVE_DECLARATION}`);
    expect(written).toContain("## Repository\r\n\r\nrepo\r\n");
  });

  it("keeps text a person left after the declaration instead of deleting it", () => {
    const body = `## Target Backend Environment\n\nproduction\n\n${SECTION}\n\nWe will see\n\nFiled by: a person\n`;
    const written = upsertDeclaration(body, LIVE_SECTION);
    expect(written).toContain(LIVE_DECLARATION);
    expect(written).toContain("Filed by: a person");
    expect(written).not.toContain(FREE_TEXT);
    // It is kept, not blessed: the declaration must still be the only line.
    expect(checkDeclaration(written, LIVE_USERS).verdict).toBe("FAIL");
  });
});

describe("settings a person might really write", () => {
  it("names a misspelt key instead of leaving the rule on in silence", () => {
    const setting = resolveReleaseSetting({ release: { liveusers: false } });
    expect(setting.liveUsers).toBe(true);
    expect(setting.problems.join(" ")).toContain("release.liveusers");
    expect(setting.problems.join(" ")).toContain(
      "did you mean release.liveUsers?"
    );
  });

  it("names an unknown key under release.switch", () => {
    const setting = resolveReleaseSetting({
      release: { switch: { tool: "hosted-flags" } },
    });
    expect(setting.problems.join(" ")).toContain("release.switch.tool");
  });

  it("reads a local null as a declared invalid value, not as absent", () => {
    const root = scratch();
    writeFileSync(
      path.join(root, ".lisa.config.json"),
      JSON.stringify({ release: { liveUsers: false } })
    );
    writeFileSync(
      path.join(root, ".lisa.config.local.json"),
      JSON.stringify({ release: { liveUsers: null } })
    );
    const setting = resolveReleaseSetting(readProjectConfig(root));
    expect(setting.liveUsers).toBe(true);
    expect(setting.liveUsersSource).toBe("invalid");
  });

  it.each([
    ["feature-release"],
    ["Feature-Release"],
    ["feature release"],
    ["feature_release"],
  ])(
    "reserves the production turn-on for a person when the project lists %j",
    entry => {
      expect(turnOnOwner({ humanGate: { humanOnly: [entry] } })).toBe("human");
      // The hold classifier is what accepts a hold naming this class. If the two
      // normalised differently, a ticket could be held for a person while the
      // agent was told to go ahead.
      expect(normalizeGateText(entry)).toBe(
        normalizeGateText(RELEASE_DECISION_CLASS)
      );
    }
  );

  it("leaves the turn-on with the agent when the class is not listed", () => {
    expect(turnOnOwner({})).toBe("agent");
    expect(turnOnOwner({ humanGate: { humanOnly: ["pricing"] } })).toBe(
      "agent"
    );
    expect(turnOnOwner({ humanGate: { humanOnly: "feature-release" } })).toBe(
      "agent"
    );
  });
});

describe("the production branch, read as the completion checker reads it", () => {
  it("ignores a refs/heads/ prefix and the case of the environment name", () => {
    expect(
      productionBranch({
        deploy: { branches: { Production: "refs/heads/main" } },
      })
    ).toBe("main");
  });

  it("falls back to the default branch when no deploy branches are configured", () => {
    expect(productionBranch({})).toBe("main");
    expect(
      productionBranch({ policy: { repository: { default_branch: "trunk" } } })
    ).toBe("trunk");
  });

  it("does not guess when deploy branches name no production environment", () => {
    expect(
      productionBranch({ deploy: { branches: { staging: "dev" } } })
    ).toBeNull();
  });

  it("prints the notice for a base reported with its refs/heads/ prefix", () => {
    const notice = productionNotice(
      { release: { liveUsers: false } },
      "refs/heads/main"
    );
    expect(notice).toContain("release.liveUsers");
    expect(notice).toContain("from main");
  });
});

describe("searching the whole repository", () => {
  /**
   * A git repository with a root file that references the switch and a
   * subfolder that does not.
   * @returns Repository root
   */
  function repository(): string {
    const root = scratch();
    const git = (...args: string[]): string =>
      boundedExecFileSync({
        label: `git ${args[0] ?? ""} (release-switch shapes fixture)`,
        command: GIT_BIN,
        args,
        cwd: root,
        env: cleanGitEnv(),
      });
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "Test");
    git("config", "commit.gpgsign", "false");
    writeFileSync(path.join(root, "app.js"), `flag("${SWITCH}");\n`);
    mkdirSync(path.join(root, "docs"));
    writeFileSync(path.join(root, "docs", "guide.md"), "# Guide\n");
    git("add", ".");
    git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "fixture");
    return root;
  }

  it("finds a reference at the root when started from a subfolder", () => {
    const root = repository();
    const docs = path.join(root, "docs");
    expect(switchReferences(SWITCH, { cwd: docs })).toEqual(["app.js"]);
    expect(switchReferences(SWITCH, { cwd: docs, revision: "main" })).toEqual([
      "app.js",
    ]);
  });
});

describe("command-line edges", () => {
  /**
   * Run the CLI and capture its exit code and error text.
   * @param argv - Arguments after the script name
   * @returns Exit code and stderr
   */
  function run(argv: string[]): { code: number; err: string } {
    const err: string[] = [];
    const code = runCli(argv, {
      stdout: { write: () => true },
      stderr: { write: (text: string) => err.push(text) },
    });
    return { code, err: err.join("") };
  }

  it("exits 2, not the failing 1, when the body cannot be read", () => {
    const root = scratch();
    const result = run(["check", "--cwd", root, "--body-file", root]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("lisa-release-switch:");
  });

  it("keeps the notice at exit 0 when the project folder does not exist", () => {
    const missing = path.join(scratch(), "nope");
    expect(run(["notice", "--cwd", missing, "--base", "main"]).code).toBe(0);
  });
});
