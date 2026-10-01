/**
 * Prose contract for complete comment reads across trackers (#4323).
 *
 * The work-item context file is only as complete as the comments the vendor
 * read skills fetch. Jira's issue resource embeds one page of comments, GitHub's
 * `gh api --paginate` prints one array per page, and Linear pages by cursor, so
 * each read must page to exhaustion and say so plainly when it could not —
 * a capped set must never pass for the whole. Pinned across the canonical source
 * and every generated skill surface; the handoff itself is pinned in
 * `work-item-context-handoff-contract.test.ts`.
 * @module tests/unit/strategies/work-item-comment-completeness-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
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

const COMPLETENESS_HEADING =
  "### Comments (<fetched> of <total>; comments_complete: <true|false>)";

describe.each(skillPaths("lisa-github-read-issue"))(
  "lisa-github-read-issue always paginates comments (%s)",
  skillPath => {
    const skill = read(skillPath);

    it("reads comments through the paginated endpoint unconditionally", () => {
      expect(skill).toContain(
        "`gh api repos/<org>/<repo>/issues/<number>/comments --paginate --slurp | jq 'add // []'`"
      );
      // `--paginate` alone prints one array per page; a count over that raw
      // output undercounts, so completeness must be measured after flattening.
      expect(skill).toMatch(
        /The fetched count is the number of comments after flattening/
      );
      expect(skill).not.toContain("If pagination matters");
    });

    it("emits the shared completeness heading and INCOMPLETE line", () => {
      expect(skill).toContain(COMPLETENESS_HEADING);
      expect(skill).toContain('"INCOMPLETE — <fetched> of <total>');
      expect(skill).toMatch(/set `comments_complete: false`/);
    });
  }
);

describe.each(skillPaths("lisa-linear-read-issue"))(
  "lisa-linear-read-issue pages comments to exhaustion (%s)",
  skillPath => {
    const skill = read(skillPath);

    it("follows pageInfo until hasNextPage is false", () => {
      expect(skill).toMatch(
        /Page to exhaustion: request the next page while `pageInfo.hasNextPage` is true/
      );
    });

    it("emits the shared completeness heading and INCOMPLETE line", () => {
      expect(skill).toContain(COMPLETENESS_HEADING);
      expect(skill).toContain('"INCOMPLETE — <fetched> of <total>');
      expect(skill).toMatch(/set `comments_complete: false`/);
    });
  }
);

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

    it("marks an MCP-only capped read incomplete with fetched-versus-total counts", () => {
      const body = section(
        skill,
        "### `comments` — every comment on one issue"
      );
      expect(body).toContain(
        "`comments_complete`, `comments_fetched`, and `comments_total`"
      );
      expect(body).toMatch(
        /only the MCP substrate[^\n]*`comments_complete: false`/
      );
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

    it("surfaces incomplete comments in the bundle", () => {
      expect(skill).toMatch(/reports `comments_complete: false`[^\n]*MCP-only/);
      expect(skill).toContain(
        "### Comments (<fetched> of <total>; comments_complete: <true|false>)"
      );
    });
  }
);
