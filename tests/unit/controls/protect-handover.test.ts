/**
 * The file that hands a merge-protection change to an administrator.
 *
 * The reader may never have heard of the tool that wrote it. So the file has
 * to say, in plain words, the platform, the repository, the branch, the
 * setting, the exact value, and why — and it has to say the same thing every
 * time it is written from the same facts (CodySwannGT/lisa#4993).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  renderHandover,
  type HandoverFacts,
} from "../../../src/controls/protect-handover.js";
import { syncHandover } from "../../../src/controls/protect-handover-file.js";
import {
  neverReported,
  reportingNotRead,
} from "../../../src/controls/protect-held.js";
import type { ProtectedEntry } from "../../../src/controls/protect-derive.js";
import {
  MERGE_PROTECTION_CHANGE_PATH,
  type RequiredCheck,
} from "../../../src/controls/protect-types.js";
import type { ControlRegisterEntry } from "../../../src/controls/register-types.js";
import { createSymlink } from "../../support/borrowed-node-modules.mjs";

const LINT = "🔍 Quality Checks / 🧹 Lint";
const REVIEW = "Review Bot";
const CODE_STYLE = "code-style";
const roots: string[] = [];

/**
 * A register entry, as far as the handover reads one.
 * @param gate - The gate's id
 * @param scope - The folder it covers
 * @param criteria - The requirements it serves
 * @returns The entry with the names of its checks
 */
function entry(
  gate: string,
  scope: string,
  criteria: readonly string[]
): ProtectedEntry {
  return {
    entry: {
      id: `${gate}@${scope}`,
      gate,
      scope,
      criteria,
    } as ControlRegisterEntry,
    checks: [LINT],
  };
}

/**
 * A check a pipeline job reports.
 * @param context - Its name
 * @param state - Where it stands
 * @param detail - Why it is held back, when it is
 * @returns The check
 */
function check(
  context: string,
  state: RequiredCheck["state"],
  detail: string | null = null
): RequiredCheck {
  return {
    context,
    source: "workflow",
    app_id: null,
    gates: [CODE_STYLE],
    state,
    detail,
  };
}

const GITHUB_FACTS: HandoverFacts = {
  platform: {
    name: "github",
    repository: "example-owner/example-repo",
    detected_from: "remote",
    reachable: true,
    note: null,
  },
  branch: "main",
  reason: "Nothing was changed, because the command was run without --apply.",
  checks: [check(LINT, "missing")],
  entries: [
    entry(CODE_STYLE, "api", ["SI7"]),
    entry(CODE_STYLE, "web", ["SI7"]),
  ],
};

/**
 * Make an empty folder that is removed after the case.
 * @returns Its path
 */
function emptyRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-protect-handover-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  roots.splice(0).forEach(root => {
    rmSync(root, { recursive: true, force: true });
  });
});

describe("the administrator handover for GitHub", () => {
  it("states the platform, the repository, the branch, the setting and the value", () => {
    const text = renderHandover(GITHUB_FACTS);

    expect(text).toContain("- Platform: GitHub");
    expect(text).toContain("- Repository: example-owner/example-repo");
    expect(text).toContain("- Branch: `main`");
    expect(text).toMatch(
      /- Setting: .*Rulesets.*"Require status checks to pass"/u
    );
    expect(text).toMatch(/- Value: every check name listed/u);
    expect(text).toMatch(
      /Use a ruleset, not a classic branch protection rule/u
    );
  });

  it("gives each check's exact name, who reports it and what it proves", () => {
    const text = renderHandover(GITHUB_FACTS);

    expect(text).toContain(
      `| \`${LINT}\` | GitHub Actions | Yes | It proves the rule "code-style" for \`api\` and \`web\` (requirement SI7). |`
    );
  });

  it("says why the change was not made, and why it matters", () => {
    const text = renderHandover(GITHUB_FACTS);

    expect(text).toContain(
      "The setting was not changed automatically. Nothing was changed, because the command was run without --apply."
    );
    expect(text).toMatch(/a pull request can be merged into `main` while/u);
  });

  it("names the app an awaited check is pinned to", () => {
    const text = renderHandover({
      ...GITHUB_FACTS,
      checks: [
        {
          context: REVIEW,
          source: "external",
          app_id: 4242,
          gates: [CODE_STYLE],
          state: "missing",
          detail: null,
        },
      ],
    });

    expect(text).toContain(
      `| \`${REVIEW}\` | another app (GitHub App id 4242) |`
    );
  });

  it("lists what is already required apart from what is not", () => {
    const text = renderHandover({
      ...GITHUB_FACTS,
      checks: [check(LINT, "required"), check("Other", "missing")],
    });

    const [toRequire = "", alreadyRequired = ""] = text.split(
      "## Already required"
    );
    expect(toRequire).toContain("| `Other` |");
    expect(toRequire).not.toContain(`| \`${LINT}\` |`);
    expect(alreadyRequired).toContain(`- \`${LINT}\``);
  });

  it("says a check has not run yet, and what has to happen first", () => {
    const held = neverReported("`main`");
    const text = renderHandover({
      ...GITHUB_FACTS,
      checks: [check(LINT, held.state, held.detail), check("Other", "missing")],
    });

    expect(text).toContain("| GitHub Actions | Not yet |");
    expect(text).toContain(
      'Require only the checks marked "Yes". Do not require the others yet:'
    );
    expect(text).toContain(`- \`${LINT}\`: It has not run yet:`);
    expect(text).toMatch(
      /leave every pull request waiting for a result that never arrives/u
    );
    expect(text).toMatch(/First merge the workflow \(or install the app\)/u);
    expect(text).not.toContain("- `Other`:");
  });

  it("marks a check whose history could not be read as not confirmed", () => {
    const held = reportingNotRead("`main`", "gh: Not Found (HTTP 404)");
    const text = renderHandover({
      ...GITHUB_FACTS,
      checks: [check(LINT, held.state, held.detail)],
    });

    expect(text).toContain("| GitHub Actions | Not confirmed |");
    expect(text).toContain(
      `- \`${LINT}\`: It could not be read whether this check has ever run`
    );
    expect(text).toContain("gh: Not Found (HTTP 404)");
  });

  it("carries no date and is the same text for the same facts", () => {
    const text = renderHandover(GITHUB_FACTS);

    expect(renderHandover(structuredClone(GITHUB_FACTS))).toBe(text);
    expect(text).not.toMatch(/\b20\d\d-\d\d-\d\d\b/u);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });
});

describe("the administrator handover for another platform", () => {
  const facts: HandoverFacts = {
    ...GITHUB_FACTS,
    platform: {
      name: "gitlab",
      repository: "group/project",
      detected_from: "remote",
      reachable: false,
      note: "This repository is hosted on GitLab.",
    },
    branch: null,
    checks: [check(LINT, "unknown")],
  };

  it("names the platform and the rules, and gives no GitHub check names", () => {
    const text = renderHandover(facts);

    expect(text).toContain("- Platform: GitLab");
    expect(text).toContain("- Branch: the default branch");
    expect(text).toContain(
      '- the rule "code-style" for `api` and `web` (requirement SI7)'
    );
    expect(text).not.toContain(LINT);
    expect(text).toMatch(/cannot read this platform's settings/u);
  });

  it("says so when the platform is not known", () => {
    const text = renderHandover({
      ...facts,
      platform: { ...facts.platform, name: "unknown", repository: null },
    });

    expect(text).toContain("- Platform: not known");
    expect(text).toContain("- Repository: this repository");
  });
});

describe("keeping the handover file", () => {
  it("writes, keeps, and removes the file as the facts change", async () => {
    const root = emptyRoot();

    expect(await syncHandover(root, null)).toMatchObject({
      handover: { action: "none" },
    });
    expect(await syncHandover(root, "one\n")).toMatchObject({
      handover: { path: MERGE_PROTECTION_CHANGE_PATH, action: "written" },
    });
    expect(await syncHandover(root, "one\n")).toMatchObject({
      handover: { action: "unchanged" },
    });
    expect(await syncHandover(root, "two\n")).toMatchObject({
      handover: { action: "written" },
    });
    expect(await syncHandover(root, null)).toMatchObject({
      handover: { action: "removed" },
    });
  });

  it("refuses to write through a link", async () => {
    const root = emptyRoot();
    createSymlink(emptyRoot(), path.join(root, ".lisa"));

    const synced = await syncHandover(root, "one\n");

    expect(synced.problem).toMatch(/\.lisa is not an ordinary folder/u);
  });
});
