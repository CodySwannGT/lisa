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
  setupProblems,
  switchReferences,
  turnOnOwner,
  turnOnProblems,
  upsertDeclaration,
} from "../../../all/copy-overwrite/scripts/lib/release-switch.mjs";
import { normalizeGateText } from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";

const LIVE_USERS = { liveUsers: true };
const SWITCH = "new-checkout";
const LIVE = { mode: "live" };
const SECTION = "## Release Switch";
const LIVE_SECTION = renderDeclaration({ mode: "live" });
const FREE_TEXT = "We will see";
const WIKI_ENVIRONMENT = "h2. Target Backend Environment";
const WIKI_SECTION = "h2. Release Switch";
const WIKI_NOTES = "h2. Notes";
const QUOTED_EXAMPLE = "Switched off — example; removed by this item";

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
      WIKI_ENVIRONMENT,
      environment,
      "",
      ...(declaration === undefined ? [] : [WIKI_SECTION, declaration, ""]),
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

describe("a JIRA ticket that quotes the section in a code block", () => {
  const body = [
    WIKI_ENVIRONMENT,
    "production",
    "",
    "h2. Technical Approach",
    "{code}",
    WIKI_SECTION,
    QUOTED_EXAMPLE,
    "{code}",
    "",
  ].join("\n");

  it("does not read the quoted example as the declaration", () => {
    expect(parseDeclaration(body)).toBeNull();
  });

  it("leaves the code block intact and adds the real section", () => {
    const written = upsertDeclaration(body, LIVE_SECTION);
    expect(written).toContain(
      "{code}\nh2. Release Switch\nSwitched off — example; removed by this item\n{code}"
    );
    expect(parseDeclaration(written)).toEqual(LIVE);
  });
});

describe("a code marker that is never closed", () => {
  // A pasted log often leaves a lone `{code}` line. Reading it as a block that
  // runs to the end of the body once hid the declaration below it, and the done
  // gate then closed an item whose switch was still in use.
  const declaration = `Switched off — ${SWITCH}; removed by this item`;
  const markdown = [
    "## Target Backend Environment",
    "",
    "production",
    "",
    "## Notes",
    "",
    "The error was pasted from the tracker:",
    "{code}",
    "Error: boom",
    "",
    SECTION,
    "",
    declaration,
    "",
  ].join("\n");
  const jira = [
    WIKI_ENVIRONMENT,
    "production",
    "",
    WIKI_NOTES,
    "{code}",
    "Error: boom",
    "",
    WIKI_SECTION,
    declaration,
    "",
  ].join("\n");

  it.each([
    ["a markdown body", markdown],
    ["a JIRA body", jira],
  ])("still reads the declaration below it in %s", (_name, body) => {
    expect(parseDeclaration(body)).toMatchObject({
      mode: "off",
      switchName: SWITCH,
    });
    expect(removalObligation(body, "acme/code#42")).toEqual({
      switchName: SWITCH,
    });
    expect(checkDeclaration(body, LIVE_USERS).verdict).toBe("PASS");
  });

  it("still fails a malformed declaration below it on an existing item", () => {
    const body = jira.replace(declaration, FREE_TEXT);
    expect(checkDeclaration(body, LIVE_USERS, { existing: true }).verdict).toBe(
      "FAIL"
    );
  });

  it("replaces the section in place instead of appending a new one each run", () => {
    const once = upsertDeclaration(jira, LIVE_SECTION);
    const twice = upsertDeclaration(once, LIVE_SECTION);
    expect(twice).toBe(once);
    expect(once.match(/Release Switch/g)).toHaveLength(1);
    expect(parseDeclaration(once)).toEqual(LIVE);
  });

  it("is not fooled by a {code} line inside a closed {noformat} block", () => {
    const body = [
      WIKI_ENVIRONMENT,
      "production",
      "",
      WIKI_NOTES,
      "{noformat}",
      "{code}",
      WIKI_SECTION,
      QUOTED_EXAMPLE,
      "{noformat}",
      "",
      WIKI_SECTION,
      declaration,
      "",
    ].join("\n");
    expect(parseDeclaration(body)).toMatchObject({ switchName: SWITCH });
  });
});

describe("setup problems reported in one place", () => {
  it("is empty for a sound setup", () => {
    expect(setupProblems({})).toEqual([]);
    expect(setupProblems({ release: { liveUsers: false } })).toEqual([]);
  });

  it("says when the no-live-users notice could never print", () => {
    const problems = setupProblems({
      release: { liveUsers: false },
      deploy: { branches: { prod: "release", production: "main" } },
    });
    expect(problems.join(" ")).toContain("notice");
    expect(problems.join(" ")).toContain("deploy.branches");
  });

  it("says so when the configuration is not an object at all", () => {
    expect(setupProblems([]).join(" ")).toContain("not a JSON object");
    expect(setupProblems(null).join(" ")).toContain("not a JSON object");
  });

  it("includes release and human-gate problems", () => {
    const problems = setupProblems({
      release: { liveusers: false },
      humanGate: { humanOnly: RELEASE_DECISION_CLASS },
    }).join(" ");
    expect(problems).toContain("release.liveusers");
    expect(problems).toContain("humanGate.humanOnly");
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
      QUOTED_EXAMPLE,
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
    expect(turnOnProblems({ humanGate: { humanOnly: ["pricing"] } })).toEqual(
      []
    );
  });

  it("reads a class written as a bare string as reserved, and reports the mistake", () => {
    const config = { humanGate: { humanOnly: RELEASE_DECISION_CLASS } };
    expect(turnOnOwner(config)).toBe("human");
    expect(turnOnProblems(config).join(" ")).toContain("humanGate.humanOnly");
    expect(turnOnProblems(config).join(" ")).toContain("not a list");
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

  it("accepts prod and production naming the same branch, and refuses two different ones", () => {
    expect(
      productionBranch({
        deploy: { branches: { prod: "main", production: "main" } },
      })
    ).toBe("main");
    expect(
      productionBranch({
        deploy: { branches: { prod: "release", production: "main" } },
      })
    ).toBeNull();
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
   * Track everything currently in a fixture repository.
   * @param root - Repository root
   */
  function stage(root: string): void {
    boundedExecFileSync({
      label: "git add (release-switch shapes fixture)",
      command: GIT_BIN,
      args: ["add", "--all"],
      cwd: root,
      env: cleanGitEnv(),
    });
  }

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

  it("does not count records: root evidence and changelogs", () => {
    const root = repository();
    writeFileSync(path.join(root, "app.js"), "show();\n");
    mkdirSync(path.join(root, "evidence", "42"), { recursive: true });
    writeFileSync(
      path.join(root, "evidence", "42", "switch-off-in-production.json"),
      `{"switch":"${SWITCH}","production":false}\n`
    );
    writeFileSync(
      path.join(root, "CHANGELOG.md"),
      `Removed the ${SWITCH} switch.\n`
    );
    writeFileSync(path.join(root, "CHANGELOG"), `Removed ${SWITCH}.\n`);
    stage(root);
    expect(switchReferences(SWITCH, { cwd: root })).toEqual([]);
    // The same files do count once they are not records: proof that they were
    // searched and set aside, not simply never seen.
    writeFileSync(path.join(root, "notes.md"), `Uses ${SWITCH}.\n`);
    stage(root);
    expect(switchReferences(SWITCH, { cwd: root })).toEqual(["notes.md"]);
  });

  it("counts every other file, because prose and text can switch behavior too", () => {
    const root = repository();
    writeFileSync(path.join(root, "app.js"), "show();\n");
    mkdirSync(path.join(root, "pages"));
    mkdirSync(path.join(root, "src", "evidence"), { recursive: true });
    writeFileSync(
      path.join(root, "pages", "checkout.mdx"),
      `{flags["${SWITCH}"] ? <New /> : <Old />}\n`
    );
    writeFileSync(
      path.join(root, "pages", "checkout.md"),
      `{% if site.flags.${SWITCH} %}new{% endif %}\n`
    );
    writeFileSync(path.join(root, "enabled-features.txt"), `${SWITCH}\n`);
    writeFileSync(
      path.join(root, "src", "evidence", "collector.js"),
      `collect("${SWITCH}");\n`
    );
    stage(root);
    expect(switchReferences(SWITCH, { cwd: root })).toEqual([
      "enabled-features.txt",
      "pages/checkout.md",
      "pages/checkout.mdx",
      "src/evidence/collector.js",
    ]);
  });

  it("counts code that merely looks like a record by its name or folder", () => {
    const root = repository();
    writeFileSync(path.join(root, "app.js"), "show();\n");
    mkdirSync(path.join(root, "src", "pages"), { recursive: true });
    mkdirSync(path.join(root, "evidence"));
    writeFileSync(
      path.join(root, "src", "pages", "ChangelogPage.tsx"),
      `export const Page = () => (flags["${SWITCH}"] ? 1 : 2);\n`
    );
    writeFileSync(
      path.join(root, "src", "changelog.ts"),
      `export const on = flag("${SWITCH}");\n`
    );
    writeFileSync(
      path.join(root, "evidence", "collector.js"),
      `collect("${SWITCH}");\n`
    );
    stage(root);
    expect(switchReferences(SWITCH, { cwd: root })).toEqual([
      "evidence/collector.js",
      "src/changelog.ts",
      "src/pages/ChangelogPage.tsx",
    ]);
  });

  it("does not count Lisa's machine state under .lisa/", () => {
    const root = repository();
    writeFileSync(path.join(root, "app.js"), "show();\n");
    mkdirSync(path.join(root, ".lisa"));
    writeFileSync(
      path.join(root, ".lisa", "PROJECT_LEARNINGS.md"),
      `Removed the ${SWITCH} switch.\n`
    );
    stage(root);
    expect(switchReferences(SWITCH, { cwd: root })).toEqual([]);
  });

  it("refuses a revision that is really a folder, or an option", () => {
    const root = repository();
    expect(() =>
      switchReferences(SWITCH, { cwd: root, revision: "docs" })
    ).toThrow(/Could not search/);
    expect(() =>
      switchReferences(SWITCH, { cwd: root, revision: "--cached" })
    ).toThrow(/not a revision/);
  });

  it("finds the name in any letter case", () => {
    const root = repository();
    writeFileSync(path.join(root, "app.js"), 'flag("New-Checkout");\n');
    expect(switchReferences(SWITCH, { cwd: root })).toEqual(["app.js"]);
  });

  it("is not narrowed by git's literal-pathspec mode, which a hook can inherit", () => {
    const root = repository();
    const before = process.env.GIT_LITERAL_PATHSPECS;
    process.env.GIT_LITERAL_PATHSPECS = "1";
    try {
      expect(
        switchReferences(SWITCH, { cwd: path.join(root, "docs") })
      ).toEqual(["app.js"]);
    } finally {
      if (before === undefined) delete process.env.GIT_LITERAL_PATHSPECS;
      else process.env.GIT_LITERAL_PATHSPECS = before;
    }
  });

  it("matches the name as a whole token, not inside another word", () => {
    const root = repository();
    writeFileSync(
      path.join(root, "app.js"),
      'const banner = "renew-checkout-banner";\n'
    );
    expect(switchReferences(SWITCH, { cwd: root })).toEqual([]);
    writeFileSync(
      path.join(root, "app.js"),
      `settings["${SWITCH}.enabled"] = true;\n`
    );
    expect(switchReferences(SWITCH, { cwd: root })).toEqual(["app.js"]);
    writeFileSync(path.join(root, "app.js"), `const v2 = "${SWITCH}-v2";\n`);
    expect(switchReferences(SWITCH, { cwd: root })).toEqual(["app.js"]);
  });

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
