/**
 * Prose contract for the work-item context handoff (CodySwannGT/lisa#4323).
 *
 * The vendor read skills fetch a work item with every comment, but the
 * Implement flow used to hand that bundle from agent to agent as a summary.
 * Each hop re-summarized, so facts that lived only in comments — a decision
 * made in discussion, a constraint, which account to sign in with, how to
 * reproduce — never reached the agents doing the work. A bundle a build-intake
 * caller had already read was discarded and re-read.
 *
 * The fix is a file, not a longer summary: the input-resolver persists the
 * bundle verbatim to `.lisa/work-item-context.md` (worktree-local, never
 * committed), returns the path plus a per-comment inventory, and every task and
 * every implementation/specialist agent points at that file. Jira's primary
 * ticket and epic parent get a paginated comment read so the bundle is not
 * silently capped at one API page.
 *
 * The behavior is carried by agent instructions, so the instruction text IS
 * the contract surface. It is pinned across the canonical source and every
 * checked-in runtime projection. Parity notes: the Codex overlay ships skills
 * only (agents reach Codex as TOML built at host apply-time from
 * `plugins/lisa`), OpenCode is likewise built from `plugins/lisa` at apply
 * time, and Copilot renames agents to `<name>.agent.md`. Whether the file is
 * actually ignored is adjudicated by git in `copy-contents-gitignore.test.ts`.
 * @module tests/unit/strategies/work-item-context-handoff-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const CONTEXT_FILE = ".lisa/work-item-context.md";
const PATH_ONLY_RULE =
  "Bundle text, and any credential value in it, never appears in a spawn prompt, task description, or Skill argument — only its path.";

const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
] as const;

const AGENT_ROOTS = [
  { root: "plugins/src/base/agents", suffix: ".md" },
  { root: "plugins/lisa/agents", suffix: ".md" },
  { root: "plugins/lisa-cursor/agents", suffix: ".md" },
  { root: "plugins/lisa-agy/agents", suffix: ".md" },
  { root: "plugins/lisa-copilot/agents", suffix: ".agent.md" },
] as const;

const READING_AGENTS = [
  "builder",
  "bug-fixer",
  "product-specialist",
  "architecture-specialist",
  "test-specialist",
  "verification-specialist",
  "debug-specialist",
  "spec-conformance-specialist",
  "quality-specialist",
] as const;

const BUILD_INTAKE_SKILLS = [
  "lisa-github-build-intake",
  "lisa-jira-build-intake",
  "lisa-linear-build-intake",
] as const;

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

const skillPaths = (skill: string): readonly string[] =>
  SKILL_ROOTS.map(root => `${root}/${skill}/SKILL.md`);

/**
 * Return the body of one `###` section, so an assertion cannot be satisfied by
 * identical wording that belongs to a neighbouring section.
 * @param text - Markdown document
 * @param heading - Exact heading line that opens the section
 * @returns Section text up to the next `###` or `##` heading, or "" if absent
 */
const section = (text: string, heading: string): string => {
  const start = text.indexOf(heading);
  if (start === -1) {
    return "";
  }
  const rest = text.slice(start + heading.length);
  const end = rest.search(/\n##+ /);
  return end === -1 ? rest : rest.slice(0, end);
};

describe.each(skillPaths("lisa-implement"))(
  "lisa-implement persists and hands over the bundle (%s)",
  skillPath => {
    const skill = read(skillPath);

    it("requires the resolver to write the vendor read bundle verbatim to the context file", () => {
      expect(skill).toContain(
        `Persist the bundle verbatim to \`${CONTEXT_FILE}\``
      );
      expect(skill).toMatch(/unedited/);
    });

    it("requires the resolver to return the path plus a flagged per-comment inventory", () => {
      expect(skill).toContain("per-comment inventory");
      expect(skill).toMatch(/author, date, one-line gist/);
      for (const flag of [
        "decision",
        "constraint",
        "credential",
        "reproduction",
      ]) {
        expect(skill).toMatch(new RegExp(`flags?[^\\n]*${flag}`));
      }
    });

    it("persists a caller-supplied bundle instead of discarding it, without skipping the live gate", () => {
      expect(skill).toContain("caller-supplied bundle");
      expect(skill).toMatch(/instead of discarding it/);
      expect(skill).toMatch(/live validation and claim still run/);
    });

    it("makes every task carry the absolute context file path and the inventory", () => {
      expect(skill).toMatch(
        /"work_item_context": "<absolute path[^"]*\.lisa\/work-item-context\.md>"/
      );
      expect(skill).toMatch(/Do NOT omit[^\n]*`work_item_context`/);
      expect(skill).toMatch(/every teammate prompt[^\n]*work-item-context/i);
      expect(skill).toMatch(
        /every teammate prompt[^\n]*pastes the resolver's per-comment inventory/i
      );
    });

    it("has the lead forward a caller bundle to the resolver by path only", () => {
      // The resolver can persist only what it receives, but pasting the bundle
      // into a spawn prompt would copy any credential it quotes into the prompt
      // (CWE-200). The handoff is the git-ignored file; only its path travels.
      expect(skill).toContain(
        "The lead forwards only `caller_bundle_path: <absolute path>` in the input-resolver's spawn prompt"
      );
      expect(skill).toContain(PATH_ONLY_RULE);
      expect(skill).not.toMatch(/pastes that bundle verbatim/);
      expect(skill).not.toContain("`caller_bundle:`");
    });

    it("writes the flagged inventory into the file as a trailing section", () => {
      expect(skill).toContain("trailing `## Comment inventory` section");
      expect(skill).toContain("`decision|constraint|credential|repro`");
    });

    it("states one writer order: keep the live read, or caller bundle plus live additions", () => {
      expect(skill).toContain("There is one writer order.");
      expect(skill).toMatch(/`lisa-track` has already written its live read/);
      expect(skill).toMatch(/append under `## Added by live read` only/);
      expect(skill).not.toContain("overwriting any earlier copy");
    });

    it("keeps credential values out of the inventory and everything copied from it", () => {
      expect(skill).toContain(
        "**A `credential` gist names only the kind and the location**"
      );
      expect(skill).toMatch(/never the secret value or identifier/);
      expect(skill).toMatch(
        /never copy it into task descriptions, teammate prompts, plan or roster files, tracker comments, or PR text/
      );
      expect(skill).toMatch(/`lisa-track` leaves an existing file untouched/);
    });

    it("returns the absolute path", () => {
      expect(skill).toContain(
        "Return `work_item_context: <absolute path of the file>`"
      );
    });
  }
);

describe.each(skillPaths("lisa-track"))(
  "lisa-track returns the context file (%s)",
  skillPath => {
    const skill = read(skillPath);

    it("names the absolute context file path in the structured return block", () => {
      expect(skill).toContain(
        `work_item_context: <absolute path to ${CONTEXT_FILE}>`
      );
    });

    it("is the first write, in the same order lisa-implement states", () => {
      expect(skill).toMatch(
        /this is the first write; when `lisa-implement` forwarded a `caller_bundle_path`/
      );
      expect(skill).toContain("`## Comment inventory` section");
    });

    it("never clobbers an existing file when a caller bundle path was forwarded", () => {
      expect(skill).toMatch(
        /When a `caller_bundle_path` was forwarded for this work item and the file already exists, do not overwrite it/
      );
    });
  }
);

describe.each(
  BUILD_INTAKE_SKILLS.flatMap(skill =>
    skillPaths(skill).map(skillPath => [skill, skillPath] as const)
  )
)("%s hands the bundle over for persistence (%s)", (_skill, skillPath) => {
  it("says lisa-implement persists the passed bundle at the context file", () => {
    const skill = read(skillPath);
    expect(skill).toMatch(
      new RegExp(
        `bundle[^\\n]*persist[^\\n]*${CONTEXT_FILE.replace(/[./]/g, "\\$&")}`
      )
    );
  });

  it("writes the bundle to the file first and passes only its path", () => {
    const skill = read(skillPath);
    expect(skill).toMatch(
      /before invoking `lisa-implement`, run the ignore guard below, then write the bundle verbatim/
    );
    expect(skill).toContain(
      "pass only `caller_bundle_path=<absolute path>` in the invocation"
    );
    expect(skill).toContain(PATH_ONLY_RULE);
  });
});

describe.each(
  READING_AGENTS.flatMap(agent =>
    AGENT_ROOTS.map(
      ({ root, suffix }) => [agent, `${root}/${agent}${suffix}`] as const
    )
  )
)("%s reads the work-item context first (%s)", (_agent, agentPath) => {
  const agent = read(agentPath);
  const body = section(agent, "## Work-item context");

  it("has a Work-item context section naming the file", () => {
    expect(body).toContain(CONTEXT_FILE);
  });

  it("reads the file in full before acting", () => {
    expect(body).toMatch(/in full before/);
  });

  it("treats flagged comments as obligations", () => {
    expect(body).toMatch(/flagged comment[^\n]*obligation/i);
    expect(body).toContain("`## Comment inventory`");
  });

  it("reads the absolute path its task gives, falling back to the bound worktree", () => {
    expect(body).toContain(
      "absolute path your task gives as `work_item_context`"
    );
    expect(body).toMatch(/at the root of the bound worktree/);
  });

  it("stops and reports a missing file instead of working from memory", () => {
    expect(body).toMatch(/report that to the team lead and stop/);
    expect(body).toMatch(/never proceed from memory/);
  });

  it("keeps a credential-flagged secret inside the context file", () => {
    expect(body).toMatch(
      /secret quoted in a credential-flagged comment never leaves that file/
    );
    expect(body).toMatch(
      /keep the value or identifier out of code, commits, task notes, prompts, plan or roster files, tracker comments, and PR text/
    );
  });
});

describe("the context file is ignored, not the .lisa directory", () => {
  const rules = (relativePath: string): readonly string[] =>
    read(relativePath)
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith("#"));

  it.each([".gitignore", "all/copy-contents/gitignore"])(
    "%s carries the exact path",
    file => {
      expect(rules(file)).toContain(CONTEXT_FILE);
      expect(rules(file)).not.toContain(".lisa/");
    }
  );

  it("keeps the shipped entry above the EAS re-include marker", () => {
    const lines = read("all/copy-contents/gitignore").split("\n");
    expect(lines.indexOf(CONTEXT_FILE)).toBeGreaterThan(-1);
    expect(lines.indexOf(CONTEXT_FILE)).toBeLessThan(
      lines.indexOf("### EASINCLUDE! ###")
    );
  });
});
