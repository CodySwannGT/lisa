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

    it("makes every task carry the context file path", () => {
      expect(skill).toContain(`"work_item_context": "${CONTEXT_FILE}"`);
      expect(skill).toMatch(/Do NOT omit[^\n]*`work_item_context`/);
      expect(skill).toMatch(/every teammate prompt[^\n]*work-item-context/i);
    });
  }
);

describe.each(skillPaths("lisa-track"))(
  "lisa-track returns the context file (%s)",
  skillPath => {
    it("names the context file in the structured return block", () => {
      expect(read(skillPath)).toContain(`work_item_context: ${CONTEXT_FILE}`);
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
  });
});

describe.each(skillPaths("lisa-atlassian-access"))(
  "lisa-atlassian-access paginates comment reads (%s)",
  skillPath => {
    const skill = read(skillPath);

    it("dispatches a comments read operation against the paginated endpoint", () => {
      expect(skill).toMatch(
        /\| `comments key:<K>`[^\n]*\/comment\?startAt=<n>&maxResults=100&orderBy=created/
      );
    });

    it("documents pagination until exhausted in the comments section itself", () => {
      const body = section(
        skill,
        "### `comments` — every comment on one issue"
      );
      expect(body).toContain("startAt + maxResults >= total");
      expect(body).toMatch(/never silently truncated/);
    });
  }
);

describe.each(skillPaths("lisa-jira-read-ticket"))(
  "lisa-jira-read-ticket uses the paginated read (%s)",
  skillPath => {
    const skill = read(skillPath);

    it("reads the primary ticket's comments through the comments operation", () => {
      expect(skill).toContain("`operation: comments key: <TICKET-KEY>`");
    });

    it("reads the epic parent's comments through the comments operation", () => {
      expect(skill).toContain("`operation: comments key: <EPIC-KEY>`");
    });
  }
);

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
