/**
 * The always-promotable contract (CodySwannGT/lisa#5188): the `release.*`
 * project setting, the `## Release Switch` work-item declaration, readiness
 * gate S22, the switch-removal search and the no-live-users notice.
 * @module tests/unit/scripts/release-switch
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv, GIT_BIN } from "../../support/git-executable.js";

import {
  FALLBACK_MECHANISM,
  LIVE_DECLARATION,
  RELEASE_DECISION_CLASS,
  checkDeclaration,
  parseDeclaration,
  productionBranch,
  productionNotice,
  removalObligation,
  renderDeclaration,
  resolveReleaseSetting,
  runtimeScope,
  switchReferences,
  upsertDeclaration,
} from "../../../all/copy-overwrite/scripts/lib/release-switch.mjs";

const RUNTIME = "## Target Backend Environment\n\nproduction\n";
const NO_RUNTIME =
  "## Target Backend Environment\n\nNone — no runtime behavior change: doc-only\n";
const CONTAINER =
  "## Target Backend Environment\n\nNone — container: state rolls up from children\n";
const SWITCH = "new-checkout";
const LIVE_USERS = { liveUsers: true };
const LIVE_USERS_KEY = "release.liveUsers";
const SOURCE_FILE = "checkout.js";
const OWN_REF = "owner/repo#7";

/**
 * A work-item body with a target environment and an optional declaration.
 * @param declaration - Text of the `## Release Switch` section, when present.
 * @param environment - The `## Target Backend Environment` section.
 * @returns The body.
 */
function item(declaration?: string, environment = RUNTIME): string {
  const release =
    declaration === undefined ? "" : `\n## Release Switch\n\n${declaration}\n`;
  return `## Context / Business Value\n\nWork.\n\n${environment}${release}`;
}

describe("release.* setting", () => {
  it("treats a project that says nothing as having live users", () => {
    expect(resolveReleaseSetting({})).toEqual({
      liveUsers: true,
      liveUsersSource: "default",
      mechanism: FALLBACK_MECHANISM,
      mechanismSource: "default",
      guide: null,
      problems: [],
    });
  });

  it("lets a pre-launch project say it has no live users", () => {
    const setting = resolveReleaseSetting({ release: { liveUsers: false } });
    expect(setting.liveUsers).toBe(false);
    expect(setting.liveUsersSource).toBe("declared");
    expect(setting.problems).toEqual([]);
  });

  it.each([["no"], [0], [null], ["false"]])(
    "reports a live-users value of %j and keeps the stricter reading",
    value => {
      const setting = resolveReleaseSetting({ release: { liveUsers: value } });
      expect(setting.liveUsers).toBe(true);
      expect(setting.liveUsersSource).toBe("invalid");
      expect(setting.problems).toHaveLength(1);
      expect(setting.problems[0]).toContain(LIVE_USERS_KEY);
      expect(setting.problems[0]).toContain(JSON.stringify(value));
    }
  );

  it("carries the project's named mechanism and its guide", () => {
    const setting = resolveReleaseSetting({
      release: {
        switch: { mechanism: "hosted-flags", guide: "docs/feature-flags.md" },
      },
    });
    expect(setting.mechanism).toBe("hosted-flags");
    expect(setting.mechanismSource).toBe("declared");
    expect(setting.guide).toBe("docs/feature-flags.md");
  });

  it("reports a mechanism that is not a non-empty string and falls back", () => {
    const setting = resolveReleaseSetting({
      release: { switch: { mechanism: 7 } },
    });
    expect(setting.mechanism).toBe(FALLBACK_MECHANISM);
    expect(setting.problems[0]).toContain("release.switch.mechanism");
  });

  it("reports a release block that is not an object", () => {
    const setting = resolveReleaseSetting({ release: "off" });
    expect(setting.liveUsers).toBe(true);
    expect(setting.problems[0]).toContain("release is");
  });

  it("names the decision class that reserves the turn-on for a person", () => {
    expect(RELEASE_DECISION_CLASS).toBe("feature-release");
  });
});

describe("runtime scope", () => {
  it("reads an environment as runtime-changing", () => {
    expect(runtimeScope(item())).toBe("runtime");
  });

  it("reads both None declarations as no runtime change", () => {
    expect(runtimeScope(item(undefined, NO_RUNTIME))).toBe("none");
    expect(runtimeScope(item(undefined, CONTAINER))).toBe("none");
  });

  it("never reads an absent section as no runtime change", () => {
    expect(runtimeScope("## Context / Business Value\n\nWork.\n")).toBe(
      "underivable"
    );
  });
});

describe("## Release Switch declaration", () => {
  it("is absent when the section is absent", () => {
    expect(parseDeclaration(item())).toBeNull();
  });

  it("parses the live form", () => {
    expect(parseDeclaration(item(LIVE_DECLARATION))).toEqual({ mode: "live" });
    expect(
      parseDeclaration(item("Live - complete and proven at merge."))
    ).toEqual({ mode: "live" });
  });

  it.each([
    ["this item", "this item"],
    ["This Item", "this item"],
    ["#5190", "#5190"],
    ["owner/repo#12", "owner/repo#12"],
    ["ENG-42", "ENG-42"],
  ])("parses switched off removed by %s", (owner, expected) => {
    expect(
      parseDeclaration(item(`Switched off — ${SWITCH}; removed by ${owner}`))
    ).toEqual({ mode: "off", switchName: SWITCH, removedBy: expected });
  });

  it("refuses switched off with no switch name", () => {
    const parsed = parseDeclaration(
      item("Switched off — ; removed by this item")
    );
    expect(parsed).toMatchObject({ mode: "invalid" });
    expect(JSON.stringify(parsed)).toContain("names no switch");
  });

  it("refuses switched off with no removing work item", () => {
    const parsed = parseDeclaration(item(`Switched off — ${SWITCH}`));
    expect(parsed).toMatchObject({ mode: "invalid" });
    expect(JSON.stringify(parsed)).toContain("which work item removes");
  });

  it("refuses a removal owner that is not a work item", () => {
    const parsed = parseDeclaration(
      item(`Switched off — ${SWITCH}; removed by someone later`)
    );
    expect(parsed).toMatchObject({ mode: "invalid" });
  });

  it("refuses a second line, so nothing can hide behind the declaration", () => {
    const parsed = parseDeclaration(
      item(`${LIVE_DECLARATION}\n\nexcept the new screen`)
    );
    expect(parsed).toMatchObject({ mode: "invalid" });
  });

  it("refuses free text", () => {
    expect(parseDeclaration(item("We will see"))).toMatchObject({
      mode: "invalid",
    });
  });
});

describe("gate S22", () => {
  it("fails a proposed runtime-changing item with no declaration and shows both forms", () => {
    const result = checkDeclaration(item(), LIVE_USERS);
    expect(result.verdict).toBe("FAIL");
    const report = result.lines.join("\n");
    expect(report).toContain("## Release Switch");
    expect(report).toContain(LIVE_DECLARATION);
    expect(report).toContain("Switched off — <switch-name>");
  });

  it("passes a small fix declared live and asks for no switch", () => {
    const result = checkDeclaration(item(LIVE_DECLARATION), LIVE_USERS);
    expect(result.verdict).toBe("PASS");
    expect(result.lines.join("\n")).toContain("no switch");
  });

  it("passes a complete switched-off declaration", () => {
    const result = checkDeclaration(
      item(`Switched off — ${SWITCH}; removed by #5190`),
      LIVE_USERS
    );
    expect(result.verdict).toBe("PASS");
    expect(result.lines.join("\n")).toContain(SWITCH);
  });

  it("fails an incomplete switched-off declaration and names what is missing", () => {
    const result = checkDeclaration(
      item(`Switched off — ${SWITCH}`),
      LIVE_USERS
    );
    expect(result.verdict).toBe("FAIL");
    expect(result.lines.join("\n")).toContain("which work item removes");
  });

  it("does not fail an existing item that has no declaration", () => {
    const result = checkDeclaration(item(), LIVE_USERS, { existing: true });
    expect(result.verdict).toBe("N/A");
    expect(result.lines.join("\n")).toContain("Repair note");
  });

  it("still fails an existing item whose declaration is wrong", () => {
    const result = checkDeclaration(item("We will see"), LIVE_USERS, {
      existing: true,
    });
    expect(result.verdict).toBe("FAIL");
  });

  it("is not applicable in a project without live users", () => {
    const result = checkDeclaration(item(), { liveUsers: false });
    expect(result.verdict).toBe("N/A");
    expect(result.lines.join("\n")).toContain(LIVE_USERS_KEY);
  });

  it("is not applicable to work that changes no runtime behavior", () => {
    expect(
      checkDeclaration(item(undefined, NO_RUNTIME), LIVE_USERS).verdict
    ).toBe("N/A");
    expect(
      checkDeclaration(item(undefined, CONTAINER), LIVE_USERS).verdict
    ).toBe("N/A");
  });

  it("fails a proposed item whose runtime scope cannot be read", () => {
    const result = checkDeclaration(
      "## Context / Business Value\n\nWork.\n",
      LIVE_USERS
    );
    expect(result.verdict).toBe("FAIL");
    expect(result.lines.join("\n")).toContain("Target Backend Environment");
  });
});

describe("rendering", () => {
  it("renders a live declaration that parses back", () => {
    const section = renderDeclaration({ mode: "live" });
    expect(parseDeclaration(`${RUNTIME}\n${section}`)).toEqual({
      mode: "live",
    });
  });

  it("renders a switched-off declaration that parses back", () => {
    const section = renderDeclaration({
      mode: "off",
      switchName: SWITCH,
      removedBy: "#5190",
    });
    expect(parseDeclaration(`${RUNTIME}\n${section}`)).toEqual({
      mode: "off",
      switchName: SWITCH,
      removedBy: "#5190",
    });
  });

  it("refuses to render a switched-off declaration without a switch", () => {
    expect(() => renderDeclaration({ mode: "off" })).toThrow(/names no switch/);
  });

  it("appends the section to a body that has none", () => {
    const body = upsertDeclaration(item(), renderDeclaration({ mode: "live" }));
    expect(parseDeclaration(body)).toEqual({ mode: "live" });
    expect(body).toContain("## Context / Business Value");
  });

  it("replaces an existing section in place and keeps what follows", () => {
    const before = `${item(LIVE_DECLARATION)}\n## Repository\n\nrepo\n`;
    const after = upsertDeclaration(
      before,
      renderDeclaration({ mode: "off", switchName: SWITCH })
    );
    expect(parseDeclaration(after)).toEqual({
      mode: "off",
      switchName: SWITCH,
      removedBy: "this item",
    });
    expect(after).toContain("## Repository\n\nrepo");
    expect(after.match(/## Release Switch/g)).toHaveLength(1);
  });
});

describe("switch removal", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0))
      rmSync(root, { recursive: true, force: true });
  });

  /**
   * A git repository with one committed source file.
   * @param source - Contents of `src/checkout.js`.
   * @returns Repository root.
   */
  function repository(source: string): string {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-release-switch-"));
    roots.push(root);
    const git = (...args: string[]): string =>
      boundedExecFileSync({
        label: `git ${args[0] ?? ""} (release-switch fixture)`,
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
    writeFileSync(path.join(root, "README.md"), "# Fixture\n");
    git("add", ".");
    git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "fixture");
    return root;
  }

  it("owes removal when the item removes its own switch", () => {
    const body = item(`Switched off — ${SWITCH}; removed by this item`);
    expect(removalObligation(body, OWN_REF)).toEqual({
      switchName: SWITCH,
    });
  });

  it("owes removal when the item names itself by reference", () => {
    const body = item(`Switched off — ${SWITCH}; removed by #7`);
    expect(removalObligation(body, OWN_REF)).toEqual({
      switchName: SWITCH,
    });
  });

  it("owes nothing when another item removes the switch, or the item is live", () => {
    expect(
      removalObligation(
        item(`Switched off — ${SWITCH}; removed by #8`),
        OWN_REF
      )
    ).toBeNull();
    expect(removalObligation(item(LIVE_DECLARATION), OWN_REF)).toBeNull();
    expect(removalObligation(item(), OWN_REF)).toBeNull();
  });

  it("lists the tracked files that still reference the switch", () => {
    const root = repository(`if (flags["${SWITCH}"]) show();\n`);
    expect(switchReferences(SWITCH, { cwd: root })).toEqual([SOURCE_FILE]);
    expect(switchReferences(SWITCH, { cwd: root, revision: "main" })).toEqual([
      SOURCE_FILE,
    ]);
  });

  it("finds nothing once the reference is gone", () => {
    const root = repository("show();\n");
    expect(switchReferences(SWITCH, { cwd: root })).toEqual([]);
  });

  it("surfaces a search that could not run instead of reading it as clean", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-release-nogit-"));
    roots.push(root);
    expect(() => switchReferences(SWITCH, { cwd: root })).toThrow(
      /Could not search/
    );
  });
});

describe("no-live-users notice", () => {
  const PRODUCTION = { deploy: { branches: { production: "main" } } };

  it("reads the production branch, including the prod alias", () => {
    expect(productionBranch(PRODUCTION)).toBe("main");
    expect(
      productionBranch({ deploy: { branches: { prod: "release" } } })
    ).toBe("release");
    expect(
      productionBranch({
        deploy: { branches: { prod: "release", production: "main" } },
      })
    ).toBeNull();
  });

  it("names the setting when a production deployment happens with the rule off", () => {
    const notice = productionNotice(
      { ...PRODUCTION, release: { liveUsers: false } },
      "main"
    );
    expect(notice).toContain(LIVE_USERS_KEY);
    expect(notice).toContain("no live users");
    expect(notice).toContain("Nothing was blocked");
  });

  it("says nothing for a project with live users or a non-production branch", () => {
    expect(productionNotice(PRODUCTION, "main")).toBeNull();
    expect(
      productionNotice(
        {
          deploy: { branches: { production: "main", staging: "staging" } },
          release: { liveUsers: false },
        },
        "staging"
      )
    ).toBeNull();
  });
});
