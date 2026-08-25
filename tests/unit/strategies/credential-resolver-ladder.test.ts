/**
 * Executable guard for the credential resolver ladder shared by eleven copies.
 *
 * Every skill that needs a credential finds `resolve-secret.mjs` by walking a
 * ladder of candidate paths. Nine of the ten skills carried a TWO-rung ladder
 * that checked only `.claude/` and `.agents/`, so in a consumer repository that
 * vendors neither, the ladder never reached a resolver at all — it returned 1
 * with nothing on stderr, while a working resolver sat in the plugin's own
 * directory. That is indistinguishable from "the store has no entry", which is
 * how agents ended up improvising their own routes to a secret.
 *
 * The sibling file `linear-key-resolver-ladder-parity.test.ts` (#2869) pins the
 * ladder's TEXT for the two Linear skills. This file pins its BEHAVIOUR for
 * every copy: it lifts each `read_*()` out of its own Markdown and RUNS it
 * against purpose-built trees. A text guard cannot tell a ladder that reaches
 * the plugin copy from one that merely mentions it.
 *
 * Three shapes, and the middle one is the point:
 *
 * 1. consumer-shaped tree — only the plugin's own copy exists. Post-fix the
 *    ladder must find and invoke it; pre-fix it never ran a resolver.
 * 2. PRECEDENCE CONTROL — a repo-relative copy AND the plugin copy both exist.
 *    The repo-relative one must still win, and the plugin copy must never be
 *    invoked. This passes on BOTH sides of the fix by construction, which is
 *    what makes it a control: it proves the new rungs were appended, not
 *    reordered in front of a project's own declared copy.
 * 3. EXHAUSTION — no resolver anywhere. The ladder must name every path it
 *    tried. A guard that drove only the success path would say nothing about
 *    the silent `return 1` that made this bug expensive to diagnose.
 *
 * Execution runs against `plugins/src/base`, the canonical source. The five
 * built surfaces are held to the same ladder by the static block below plus
 * `check:plugins`, which regenerates them from that source.
 * @module tests/unit/strategies/credential-resolver-ladder
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  extractFunction,
  FLOOR_RUNG,
  ladderOf,
  type LadderSkill,
  OPENCODE_COPY,
  readSkill,
  REPO_COPY,
  REQUIRED_RUNGS,
  runLadder,
  SURFACES,
  UNCONDITIONAL_RUNGS,
} from "./credential-resolver-ladder-helpers";

/** Value a planted plugin-copy resolver answers with. */
const PLUGIN_VALUE = "value-from-plugin-copy";

/** Value a planted repo-relative resolver answers with. */
const REPO_VALUE = "value-from-repo-copy";

/** Opening words of the enumeration a miss must print. */
const TRIED_HEADER = "Tried, in order";

/** Function name shared by the Notion access, setup, and reference copies. */
const READ_NOTION_TOKEN = "read_notion_token";

/** Driving call for every Notion copy — the workspace slug is the one argument. */
const INVOKE_NOTION = `${READ_NOTION_TOKEN} "acme"`;

/**
 * All ten copies of the ladder that live in a skill.
 *
 * `lisa-linear-access` and `lisa-setup-linear` were fixed by #2869 and are the
 * reference shape; they stay in the table so a future edit cannot regress them
 * back to the two-rung form the other eight had.
 */
const LADDER_SKILLS: readonly LadderSkill[] = [
  {
    skill: "lisa-linear-access",
    fn: "read_linear_key",
    invoke: "read_linear_key",
    credential: "LINEAR_API_KEY",
    keychain: false,
  },
  {
    skill: "lisa-setup-linear",
    fn: "read_linear_key",
    invoke: 'read_linear_key "acme"',
    credential: "LINEAR_API_KEY",
    keychain: true,
  },
  {
    skill: "lisa-atlassian-access",
    fn: "read_atlassian_token",
    invoke: 'read_atlassian_token "ops@example.com"',
    credential: "ATLASSIAN_API_TOKEN",
    keychain: true,
  },
  {
    skill: "lisa-setup-atlassian",
    fn: "read_token",
    invoke: 'read_token "ops@example.com"',
    credential: "ATLASSIAN_API_TOKEN",
    keychain: true,
  },
  {
    skill: "lisa-notion-access",
    fn: READ_NOTION_TOKEN,
    invoke: INVOKE_NOTION,
    credential: "NOTION_API_TOKEN",
    keychain: true,
  },
  {
    skill: "lisa-setup-notion",
    fn: READ_NOTION_TOKEN,
    invoke: INVOKE_NOTION,
    credential: "NOTION_API_TOKEN",
    keychain: true,
  },
  {
    skill: "lisa-sentry-access",
    fn: "read_sentry_token",
    invoke: "read_sentry_token",
    credential: "SENTRY_AUTH_TOKEN",
    keychain: false,
  },
  {
    skill: "lisa-posthog-access",
    fn: "read_posthog_key",
    invoke: "read_posthog_key",
    credential: "POSTHOG_PERSONAL_API_KEY",
    keychain: false,
  },
  {
    skill: "lisa-jam-access",
    fn: "read_jam_pat",
    invoke: "read_jam_pat",
    credential: "JAM_PAT",
    keychain: false,
  },
  {
    skill: "lisa-sonarcloud-access",
    fn: "read_sonar_secret",
    invoke: "read_sonar_secret SONARQUBE_CLI_TOKEN",
    credential: "SONARQUBE_CLI_TOKEN",
    keychain: false,
  },
] as const;

const CASES = LADDER_SKILLS.map(entry => [entry.skill, entry] as const);

describe("credential resolver ladder", () => {
  describe.each(SURFACES)("static shape on %s", surface => {
    describe.each(CASES)("%s", (_name, entry) => {
      const fnText = extractFunction(readSkill(surface, entry.skill), entry.fn);

      it("offers every documented rung, in order", () => {
        expect(ladderOf(fnText)).toStrictEqual([...REQUIRED_RUNGS]);
      });

      it("ends at a rung that needs no environment variable", () => {
        // Neither CLAUDE_PLUGIN_ROOT nor PLUGIN_ROOT is exported into an
        // agent's plain shell call, so a ladder whose only plugin rungs were
        // those two would resolve nothing in the environment this runs in.
        expect(ladderOf(fnText).at(-1)).toBe(FLOOR_RUNG);
      });

      it("enumerates what it tried instead of failing silently", () => {
        expect(fnText).toContain(`${TRIED_HEADER} (relative paths are from`);
        expect(fnText).toContain("printf '  %s\\n' \"${tried[@]}\"");
      });
    });
  });

  describe.each(CASES)("executed ladder: %s", (_name, entry) => {
    it("reaches the plugin's own copy in a consumer-shaped tree", () => {
      // The defect, stated as behaviour: a repo with no vendored resolver.
      // Pre-fix the ladder stopped after `.agents` and never ran anything.
      const run = runLadder(entry, [{ at: FLOOR_RUNG, answers: PLUGIN_VALUE }]);

      expect(run.signal).toBeNull();
      expect(run.invoked).toStrictEqual([FLOOR_RUNG]);
      expect(run.stdout.trim()).toBe(PLUGIN_VALUE);
      expect(run.status).toBe(0);
    });

    it("reaches an .opencode-layout repository", () => {
      const run = runLadder(entry, [
        { at: OPENCODE_COPY, answers: "value-from-opencode-copy" },
      ]);

      expect(run.invoked).toStrictEqual([OPENCODE_COPY]);
      expect(run.stdout.trim()).toBe("value-from-opencode-copy");
    });

    it("reaches a resolver handed to it only as CLAUDE_PLUGIN_ROOT", () => {
      const run = runLadder(
        entry,
        [
          {
            at: "cache/plugin/skills/lisa-secrets-access/scripts/resolve-secret.mjs",
            answers: "value-from-plugin-root",
          },
        ],
        { CLAUDE_PLUGIN_ROOT: "cache/plugin" }
      );

      expect(run.stdout.trim()).toBe("value-from-plugin-root");
    });

    it("still prefers the repo-relative copy when both exist", () => {
      // PRECEDENCE CONTROL. Passes pre-fix and post-fix alike: a project that
      // vendors the resolver has declared which copy it wants used, and
      // appending rungs must not quietly promote the plugin's copy over it.
      const run = runLadder(entry, [
        { at: REPO_COPY, answers: REPO_VALUE },
        { at: FLOOR_RUNG, answers: PLUGIN_VALUE },
      ]);

      expect(run.stdout.trim()).toBe(REPO_VALUE);
      expect(run.invoked).toStrictEqual([REPO_COPY]);
      expect(run.invoked).not.toContain(FLOOR_RUNG);
    });

    it("stops at a present-but-empty repo copy rather than walking past it", () => {
      // Also a control. Break-on-first-present is the pre-existing contract: a
      // vendored resolver that answers "no entry" is an answer, not a miss, and
      // the ladder must not go shopping for a second opinion.
      const run = runLadder(entry, [
        { at: REPO_COPY, answers: null },
        { at: FLOOR_RUNG, answers: PLUGIN_VALUE },
      ]);

      expect(run.invoked).toStrictEqual([REPO_COPY]);
      expect(run.stdout).not.toContain(PLUGIN_VALUE);
      expect(run.status).toBe(1);
    });

    it("names every path it tried when the whole ladder misses", () => {
      // The failure path, driven. Without this the guard would prove only that
      // the happy path works, which says nothing about the silent `return 1`
      // that made this class of bug expensive to diagnose.
      const run = runLadder(entry, []);

      expect(run.status).toBe(1);
      expect(run.stderr).toContain(
        `could not resolve ${entry.credential} through lisa-secrets-access`
      );
      expect(run.stderr).toContain(TRIED_HEADER);
      for (const rung of UNCONDITIONAL_RUNGS) {
        expect(run.stderr).toContain(rung);
      }
    });

    it("names the plugin-root rungs it tried when they are set", () => {
      const run = runLadder(entry, [], {
        CLAUDE_PLUGIN_ROOT: "/opt/claude-plugin",
        PLUGIN_ROOT: "/opt/plugin",
      });

      expect(run.stderr).toContain(
        "/opt/claude-plugin/skills/lisa-secrets-access/scripts/resolve-secret.mjs"
      );
      expect(run.stderr).toContain(
        "/opt/plugin/skills/lisa-secrets-access/scripts/resolve-secret.mjs"
      );
    });

    it("prints no resolved value on the failure path", () => {
      // Secret-adjacent code: the diagnosis names paths and store coordinates,
      // never anything a resolver returned.
      const run = runLadder(entry, [
        { at: REPO_COPY, answers: "super-secret-value" },
      ]);

      expect(run.stderr).not.toContain("super-secret-value");
    });

    it("names the legacy keychain rung when it has one", () => {
      const run = runLadder(entry, []);

      if (entry.keychain) {
        expect(run.stderr).toContain("<OS keychain> service=");
        expect(run.stderr).toContain("legacy keychain");
      } else {
        expect(run.stderr).not.toContain("<OS keychain>");
      }
    });
  });
});

/**
 * The eleventh copy, and the one with the longest reach.
 *
 * `config-resolution` prints a `read_notion_token()` under the heading "Token
 * storage and lookup ladder" and tells the reader to follow it. A stale ladder
 * in a reference an agent is instructed to copy does not fail once — it mints a
 * fresh two-rung ladder every time somebody follows it, which is the mechanism
 * behind "every agent improvises its own route to the credential".
 */
const RULE_PATH = "rules/reference/config-resolution.md";

/** Surfaces that carry the reference rule (the others have no rules tree). */
const RULE_SURFACES = [
  "plugins/src/base",
  "plugins/lisa",
  "plugins/lisa-copilot",
] as const;

const RULE_ENTRY: LadderSkill = {
  skill: RULE_PATH,
  fn: READ_NOTION_TOKEN,
  invoke: INVOKE_NOTION,
  credential: "NOTION_API_TOKEN",
  keychain: true,
};

const readRule = (surface: string): string =>
  readFileSync(path.resolve(surface, RULE_PATH), "utf8");

describe("config-resolution reference ladder", () => {
  describe.each(RULE_SURFACES)("%s", surface => {
    const fnText = extractFunction(readRule(surface), RULE_ENTRY.fn);

    it("offers every documented rung, in order", () => {
      expect(ladderOf(fnText)).toStrictEqual([...REQUIRED_RUNGS]);
    });

    it("names every path it tried when the whole ladder misses", () => {
      const run = runLadder(RULE_ENTRY, [], {}, fnText);

      expect(run.status).toBe(1);
      expect(run.stderr).toContain(
        `could not resolve ${RULE_ENTRY.credential} through lisa-secrets-access`
      );
      for (const rung of UNCONDITIONAL_RUNGS) {
        expect(run.stderr).toContain(rung);
      }
    });

    it("reaches the plugin's own copy in a consumer-shaped tree", () => {
      const run = runLadder(
        RULE_ENTRY,
        [{ at: FLOOR_RUNG, answers: PLUGIN_VALUE }],
        {},
        fnText
      );

      expect(run.invoked).toStrictEqual([FLOOR_RUNG]);
      expect(run.stdout.trim()).toBe(PLUGIN_VALUE);
    });

    it("still prefers the repo-relative copy when both exist", () => {
      const run = runLadder(
        RULE_ENTRY,
        [
          { at: REPO_COPY, answers: REPO_VALUE },
          { at: FLOOR_RUNG, answers: PLUGIN_VALUE },
        ],
        {},
        fnText
      );

      expect(run.stdout.trim()).toBe(REPO_VALUE);
      expect(run.invoked).toStrictEqual([REPO_COPY]);
    });
  });
});
