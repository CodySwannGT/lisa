/**
 * The destructive-SQL guard must match SQL, not English prose (#3530).
 *
 * The guard has two arms. The `drop` arm requires a following keyword —
 * `drop database|schema|table` — so `drop the ball` never matched it. The
 * `truncate` arm made the `table` keyword OPTIONAL, which reduced it to
 * "`truncate`, whitespace, any identifier-ish word". Every one of
 * `truncate the board`, `truncate results` and `truncate output` therefore
 * matched, and a session was refused for a bug-report TITLE that described a
 * connection truncating results.
 *
 * ## Why a title has no workaround
 *
 * The remedy this hook prints at the wall — write the text to a file and pass
 * it BY PATH — covers a body but not a title. `gh issue create --title` is
 * necessarily inline, so a title-only match leaves rewording as the only exit.
 * A guard that has to be worded around is a guard people learn to route around.
 *
 * ## Why this file is mostly positive controls
 *
 * The issue names the failure mode of a bad fix directly: deleting the
 * `truncate` arm outright would satisfy the prose scenario while removing the
 * coverage. So the newly-permitted prose here is outnumbered by the real
 * statement shapes that must keep refusing, including the bare
 * `TRUNCATE <name>` form that permissive dialects accept, and the whole `drop`
 * arm, which this change must leave exactly as it was.
 * @module tests/unit/hooks/parity-safety-net-sql-prose
 */
import path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** The BUILT hook, which is what consumers receive. */
const HOOK_PATH = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");

/** Every shipped spelling of the same guard. All of them govern somewhere. */
const SHIPPED_COPIES: readonly string[] = [
  "plugins/src/base/hooks/parity-safety-net.sh",
  "plugins/lisa/hooks/parity-safety-net.sh",
  "plugins/lisa-agy/hooks/parity-safety-net.sh",
  "plugins/lisa-cursor/hooks/parity-safety-net.sh",
  "plugins/lisa-copilot/hooks/parity-safety-net.sh",
  "all/copy-overwrite/scripts/lisa-hooks/parity-safety-net.sh",
].map(relative => path.resolve(relative));

const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;

/**
 * The PreToolUse event the classifier receives for one proposed command.
 * @param command The proposed shell command.
 * @returns The serialized hook event.
 */
const eventPayload = (command: string): string =>
  JSON.stringify({
    tool_name: "Bash",
    tool_input: { command },
    cwd: process.cwd(),
  });

/**
 * Classify one proposed command. Nothing is executed — the hook is a classifier
 * over a command string handed to it as PreToolUse JSON.
 * @param command The proposed shell command.
 * @param hook Which shipped copy of the guard to ask.
 * @returns The hook's exit status.
 */
const classify = (command: string, hook: string = HOOK_PATH): number | null =>
  boundedSpawnSync({
    label: "parity-safety-net.sh",
    command: "/bin/bash",
    args: [hook],
    input: eventPayload(command),
    env: { ...process.env },
  }).status;

/** English that merely mentions the operation. None of it runs any SQL. */
const PROSE: readonly (readonly [string, string])[] = [
  // The reported case was a bug-report title. The filing CLI is spelled here
  // as its pull-request verb rather than its issue verb on purpose: a sibling
  // guard, block-direct-issue-create.sh, scans the CONTENTS of files named on
  // a command line, so an issue-filing command written literally in this
  // fixture would make this test file unnameable in any later bash command.
  // The guard under test reads the prose, not the subcommand, so the shape
  // asserted is unchanged.
  [
    "a filing title describing truncation",
    `gh pr create --title "truncate the board"`,
  ],
  [
    "a body sentence about truncating results",
    `echo "the connection will truncate results"`,
  ],
  [
    "a note about truncating output",
    `printf '%s\\n' "truncate output when it is long"`,
  ],
  [
    "a commit message mentioning the operation",
    `git commit -m "plan: truncate the board later"`,
  ],
  [
    "a commit message naming a client and operation",
    `git commit -m "fix mysql truncate sessions"`,
  ],
  [
    "a PR title mentioning the operation",
    `gh pr create --title "stop truncate output loss"`,
  ],
  ["the POSIX truncate utility", "truncate -s 0 app.log"],
  ["prose about dropping something non-SQL", "echo drop tables gently"],
  ["a branch name containing drop-table", "git branch -d drop-table-migration"],
  ["prose about dropping a ball", `echo "do not drop the ball on this"`],
];

/** Statements that really do destroy data and must keep refusing. */
const STATEMENTS: readonly (readonly [string, string])[] = [
  // The truncate arm — every shape that still has to match.
  [
    "a truncate statement with the TABLE keyword",
    `psql -c 'TRUNCATE TABLE audit_log'`,
  ],
  ["a bare truncate terminated by a semicolon", `psql -c 'TRUNCATE accounts;'`],
  ["a schema-qualified bare truncate", `psql -c 'TRUNCATE public.accounts'`],
  ["a quoted identifier", `psql -c 'TRUNCATE "accounts"'`],
  ["the Postgres ONLY form", `psql -c 'TRUNCATE ONLY accounts;'`],
  ["a CASCADE tail", `psql -c 'TRUNCATE accounts CASCADE'`],
  ["a RESTART IDENTITY tail", `psql -c 'TRUNCATE accounts RESTART IDENTITY'`],
  ["a RESTRICT tail", `psql -c 'TRUNCATE accounts RESTRICT'`],
  // The permissive-dialect form, which carries no evidence of its own and is
  // recognized by the database client it is handed to. This row is the one the
  // issue warns about: a fix that deletes the truncate arm passes every prose
  // scenario while dropping exactly this coverage.
  [
    "a bare truncate handed to a database client",
    `mysql -e 'TRUNCATE sessions'`,
  ],
  ["a bare truncate handed to psql", `psql -c 'TRUNCATE sessions'`],

  // The drop arm — unchanged by this fix, asserted so a rewrite cannot relax it.
  ["a drop table statement", `psql -c 'DROP TABLE users;'`],
  ["a bare drop table statement", "DROP TABLE accounts"],
  ["a drop schema statement", `psql -c 'DROP SCHEMA public CASCADE'`],
  [
    "a drop database statement piped to a client",
    `echo 'DROP DATABASE prod' | psql`,
  ],
];

describe("parity-safety-net: destructive SQL matches SQL, not prose (#3530)", () => {
  describe("newly permitted — English that executes no SQL", () => {
    it.each(PROSE)("permits %s", (_label, command) => {
      expect(classify(command)).toBe(EXIT_ALLOWED);
    });
  });

  describe("positive controls — every real statement still refuses", () => {
    it.each(STATEMENTS)("refuses %s", (_label, command) => {
      expect(classify(command)).toBe(EXIT_BLOCKED);
    });
  });

  describe("the drop arm is unchanged", () => {
    // Acceptance criterion 3. The drop arm was already correct, so a rewrite
    // that unifies the two arms must not make it permissive on the way past.
    it("separates drop prose from a drop statement", () => {
      expect([
        classify(`echo "drop the ball"`),
        classify("DROP TABLE accounts"),
      ]).toEqual([EXIT_ALLOWED, EXIT_BLOCKED]);
    });
  });

  describe("negative controls — the harness is not answering one way", () => {
    it("produces both verdicts, so neither set is vacuous", () => {
      const verdicts = new Set([
        classify("echo hello"),
        classify("psql -c 'TRUNCATE TABLE accounts'"),
      ]);

      expect(verdicts).toEqual(new Set([EXIT_ALLOWED, EXIT_BLOCKED]));
    });
  });

  describe("every shipped copy of the guard agrees", () => {
    // The guard resolves from six places: the source, four built plugin
    // variants, and the host guard directory a `lisa` run copies into a
    // project. A fix that reaches only the source governs nothing.
    const arm = [
      ["prose", `gh pr create --title "truncate the board"`, EXIT_ALLOWED],
      ["a statement", `psql -c 'TRUNCATE TABLE audit_log'`, EXIT_BLOCKED],
      ["a bare statement", `mysql -e 'TRUNCATE sessions'`, EXIT_BLOCKED],
      ["the drop arm", `psql -c 'DROP TABLE users;'`, EXIT_BLOCKED],
    ] as const;

    const matrix = SHIPPED_COPIES.flatMap(copy =>
      arm.map(
        ([label, command, expected]) =>
          [copy, label, command, expected] as const
      )
    );

    it.each(matrix)(
      "%s answers %s the same way",
      (copy, _label, command, expected) => {
        expect(classify(command, copy)).toBe(expected);
      }
    );
  });
});
