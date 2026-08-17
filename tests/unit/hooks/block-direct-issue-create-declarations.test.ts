/**
 * Declaration coverage for `block-direct-issue-create.sh` — the half of the
 * guard that decides whether a creation command may PROCEED.
 *
 * This is the arm that keeps the guard usable. The refusal set is easy to get
 * right and easy to over-apply; what stops it blocking Lisa's own writers is
 * that a command carrying the configured build-ready role, or an explicit
 * `[lisa-human-gate]` marker, is the CORRECT outcome and must pass.
 *
 * Every assertion here pins a position: the role counts as a label flag value
 * and nowhere else, the marker counts anywhere in the payload because it means
 * nothing else, and neither counts after a bare `--` because an operand cannot
 * reach the created item. Position blindness in this file is what a bypass
 * looks like — twice now, it is what one WAS.
 * @module tests/unit/hooks/block-direct-issue-create-declarations
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bash,
  CUSTOM_ROLE,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  GATE_MARKER,
  projectWithTracker,
  runHook,
  UNDECLARED_CREATE,
} from "./support/direct-issue-create.js";

describe("block-direct-issue-create.sh declarations", () => {
  describe("allows a declared creation — the sanctioned writer's own command", () => {
    it("allows a create carrying the configured build-ready role", () => {
      const { status } = runHook(
        bash(
          'gh issue create --title "x" --body-file /tmp/b.md ' +
            '--label "type:Bug" --label "status:ready"'
        )
      );

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows a create carrying an inline human-gate marker", () => {
      const { status } = runHook(
        bash(
          'gh issue create --title "x" ' +
            `--body "Held for a human product call: pricing. ${GATE_MARKER}"`
        )
      );

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows a create whose --body-file contains the human-gate marker", () => {
      const cwd = projectWithTracker();
      const bodyPath = path.join(cwd, "body.md");
      writeFileSync(
        bodyPath,
        `Held for a human product call: pricing.\n${GATE_MARKER}\n`,
        "utf-8"
      );

      const { status } = runHook(
        bash(`gh issue create --title "x" --body-file ${bodyPath}`),
        { cwd }
      );

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("refuses a create whose --body-file carries no marker", () => {
      const cwd = projectWithTracker();
      const bodyPath = path.join(cwd, "body.md");
      writeFileSync(
        bodyPath,
        "## Context\n\nJust an ordinary body.\n",
        "utf-8"
      );

      const { status } = runHook(
        bash(`gh issue create --title "x" --body-file ${bodyPath}`),
        { cwd }
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses when the ready role appears only as free text", () => {
      // The role is a LABEL. A token that means one thing as a flag value and
      // another inside a title is exactly the shape that turned #2469's
      // hardening allowlist into a bypass, so the match is position-scoped.
      const { status } = runHook(
        bash('gh issue create --title "status:ready is broken" --body "y"')
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses when the ready role is only in the body", () => {
      const { status } = runHook(
        bash('gh issue create --title "x" --body "set status:ready when done"')
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("accepts the ready role from a comma-joined label list", () => {
      const { status } = runHook(
        bash('gh issue create --title "x" --label "type:Bug,status:ready"')
      );

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("accepts the ready role from --label=value", () => {
      const { status } = runHook(
        bash('gh issue create --title "x" --label=status:ready')
      );

      expect(status).toBe(EXIT_ALLOWED);
    });

    // ---- end-of-options ----
    //
    // A token after a bare `--` is an operand, not a flag, so it cannot reach
    // the created item — which makes crediting it the same mistake as reading
    // the role out of a title, one position over. Both violate the guard's
    // stated invariant: check the artifact.
    //
    // This is NOT theoretical, and the two installed CLIs disagree, which is
    // exactly why the guard cannot lean on any one of them being strict:
    //
    //   gh 2.96.0  — rejects it outright ("unknown arguments [--label ...]"),
    //                so the shape is unexploitable on the GitHub path.
    //   acli       — parses straight past `--` and proceeds to a server-side
    //                project lookup, i.e. it would have CREATED the work item
    //                with the trailing `--status` silently not applied. On the
    //                JIRA path this was a live bypass, verified by running it.
    //
    // `jira`, `linear`, `http`, and `wget` are not installed on this machine,
    // so their end-of-options behavior is UNVERIFIED. The guard fails closed
    // for all of them rather than assuming they behave like gh.
    it("refuses a ready role that appears only after `--`", () => {
      const { status } = runHook(
        bash('gh issue create --title "x" --body "y" -- --label status:ready')
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses a post-`--` status on the acli path (verified live bypass)", () => {
      const { status } = runHook(
        bash(
          "acli jira workitem create --summary x --project P --type Task " +
            "-- --status status:ready"
        )
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses a post-`--` role on the unverified linear path", () => {
      const { status } = runHook(
        bash('linear issue create --title "x" -- --label status:ready')
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses a human-gate marker that appears only after `--`", () => {
      const { status } = runHook(
        bash(`gh issue create --title "x" -- "${GATE_MARKER}"`)
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("still accepts a declaration made before `--`", () => {
      const { status } = runHook(
        bash('gh issue create --title "x" --label "status:ready" -- trailing')
      );

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("honors a project's non-default ready role as the declaration", () => {
      const cwd = projectWithTracker({
        tracker: "github",
        github: { labels: { build: { ready: CUSTOM_ROLE } } },
      });

      const { status } = runHook(
        bash(`${UNDECLARED_CREATE} --label "${CUSTOM_ROLE}"`),
        { cwd }
      );

      expect(status).toBe(EXIT_ALLOWED);
    });
  });
});

/**
 * A semicolon inside a quoted `--title` split the command into segments, so the
 * `--label status:ready` landed in a different segment from the create. The
 * guard then refused a correctly-formed filing while telling the author to add
 * the label they had already added — CodySwannGT/lisa#2634, found when it
 * blocked a real filing.
 *
 * The exemption is quoting, not the semicolon: a quoted token is data, an
 * unquoted one may be `true&&gh` hiding a command. These pin both directions,
 * because widening the exemption would reopen every operator bypass the guard
 * exists to close.
 */
describe("shell operators inside quoted arguments", () => {
  it("allows a declared create whose title contains a semicolon", () => {
    const { status } = runHook(
      bash(
        'gh issue create --title "Trim config; org preference belongs elsewhere" ' +
          '--body-file /tmp/b.md --label "type:Task" --label "status:ready"'
      ),
      projectWithTracker()
    );
    expect(status).toBe(EXIT_ALLOWED);
  });

  it("still refuses that same title when the role is absent", () => {
    // The quoting exemption must not become a declaration.
    const { status } = runHook(
      bash(
        'gh issue create --title "Trim config; org preference" ' +
          '--body-file /tmp/b.md --label "type:Task"'
      ),
      projectWithTracker()
    );
    expect(status).toBe(EXIT_BLOCKED);
  });

  it("still refuses a create hidden behind a GLUED operator", () => {
    // Unquoted `true&&gh` is the case explode_operators exists for.
    const { status } = runHook(
      bash('true&&gh issue create --title "x" --label "type:Task"'),
      projectWithTracker()
    );
    expect(status).toBe(EXIT_BLOCKED);
  });

  it("still refuses an undeclared create after a real separator", () => {
    const { status } = runHook(
      bash('echo hi ; gh issue create --title "x" --label "type:Task"'),
      projectWithTracker()
    );
    expect(status).toBe(EXIT_BLOCKED);
  });

  it("still refuses a GraphQL issueCreate payload", () => {
    // `shlex(punctuation_chars=True)` would have shattered this payload into
    // fragments and silently un-refused it — measured, and the reason the fix
    // is a quoting exemption rather than a different tokeniser.
    const { status } = runHook(
      bash(
        'gh api graphql -f query=mutation{issueCreate(input:{title:\\"x\\"})}'
      ),
      projectWithTracker()
    );
    expect(status).toBe(EXIT_BLOCKED);
  });
});
