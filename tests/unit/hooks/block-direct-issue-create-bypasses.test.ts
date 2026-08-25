/**
 * Bypass regressions for `block-direct-issue-create.sh`, organised by the
 * PARSER'S DECISION POINTS rather than by attacks anyone thought of.
 *
 * That organising principle is the finding, not a style choice. An earlier
 * suite enumerated 21 command SHAPES and scored 21/21 against a guard that a
 * POSIX `nice` prefix defeated end to end, and that two appended characters
 * (`#'`) defeated on every platform with no binary at all. Enumerating the
 * branches instead — tokenise, split on operators, locate the CLI, classify the
 * subcommand, read the declaration — surfaced 36 fail-opens in one pass,
 * including a class nobody had considered.
 *
 * The root cause was a failure DIRECTION, not a missing entry in a list. The
 * guard resolved "what program is being invoked" by stripping an allowlist of
 * wrappers; anything unlisted became the program, classified as a non-creation,
 * and was ALLOWED. That allowlist can never be complete — `timeout`, `stdbuf`,
 * `caffeinate`, `xcrun`, `arch`, `script`, `ionice`, `unbuffer`, `firejail` are
 * merely the ones probed in an afternoon.
 *
 * So the question was inverted: not "what program is this" (unbounded) but
 * "does this command line invoke a tracker CLI in a creation mode" (bounded by
 * a tracker list we already maintain). Every token is scanned, so anything
 * before the CLI is irrelevant by construction. Each test below therefore pins
 * a BRANCH, and most of DP1/DP2/DP6 pass for one structural reason rather than
 * one entry each.
 *
 * Every case here fails if its protection is removed. That is the bar: assert
 * the bypass is refused, not that the classifier returned a status.
 * @module tests/unit/hooks/block-direct-issue-create-bypasses
 */
import { describe, expect, it } from "vitest";

import {
  bash,
  CUSTOM_ROLE,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  GATE_MARKER,
  projectWithTracker,
  runHook,
} from "./support/direct-issue-create.js";

const CREATE = "gh issue create --title x --body y";

describe("block-direct-issue-create.sh bypass classes", () => {
  describe("DP1 — an unrecognised prefix is not a program", () => {
    // Not an allowlist under test: these all pass because the classifier never
    // asks what the program is. `nice` and `stdbuf` are installed here and were
    // verified transparent (`nice -n 10 gh --version` prints gh's version), so
    // the first two were live, universally available bypasses.
    it.each([
      "timeout",
      "stdbuf -oL",
      "nice -n 10",
      "setsid",
      "ionice -c3",
      "chrt -b 0",
      "taskset -c 0",
      "unbuffer",
      "torsocks",
      "firejail",
      "systemd-run",
      "busybox",
      "strace -f",
      "watch -n1",
      "doas",
      "proxychains",
      "caffeinate",
      "arch -x86_64",
      "script -q /dev/null",
      "xcrun",
    ])("refuses behind the %s prefix", prefix => {
      const { status } = runHook(bash(`${prefix} ${CREATE}`));

      expect(status).toBe(EXIT_BLOCKED);
    });
  });

  describe("DP2 — a wrapper carrying its own flags", () => {
    it.each([
      ["env -i", `env -i ${CREATE}`],
      ["sudo -u nobody", `sudo -u nobody ${CREATE}`],
      ["xargs -I{}", `xargs -I {} ${CREATE}`],
      ["time -p", `time -p ${CREATE}`],
      ["command -p", `command -p ${CREATE}`],
      ["nice before gh api", "nice -n 10 gh api repos/o/r/issues -f title=x"],
      ["env -i before jira", "env -i jira issue create --summary x"],
    ])("refuses %s", (_label, command) => {
      const { status } = runHook(bash(command));

      expect(status).toBe(EXIT_BLOCKED);
    });
  });

  describe("DP4 — tokenisation failure must not mean permission", () => {
    // bash's grammar is not shlex's. bash strips a trailing comment and RUNS
    // the create; shlex raises on the unbalanced quote inside it. Two appended
    // characters, no binary required, every platform.
    it.each([
      ["trailing #'", `${CREATE} #'`],
      ['trailing #"', `${CREATE} #"`],
      ["unbalanced quote", "gh issue create --title 'x"],
      ["line continuation", `${CREATE} \\`],
    ])("refuses an unparseable %s", (_label, command) => {
      const { status } = runHook(bash(command));

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("still allows an unparseable command with no creation shape", () => {
      // The refusal is scoped to creation-shaped text on purpose: failing every
      // command shlex cannot read would refuse ordinary shell work.
      const { status } = runHook(bash("echo 'it's fine"));

      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("DP5 — dispatch through another interpreter", () => {
    it.each([
      ["bash -c", `bash -c '${CREATE}'`],
      ["bash -c with a wrapper inside", `bash -c 'env -i ${CREATE}'`],
      ["sh -c with an unlisted prefix", `sh -c 'timeout ${CREATE}'`],
      // `eval` is a POSIX shell BUILTIN, so unlike every prefix above it cannot
      // be absent from any host.
      ["eval", `eval "${CREATE}"`],
    ])("refuses via %s", (_label, command) => {
      const { status } = runHook(bash(command));

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses rather than skipping at the nesting bound", () => {
      // The depth cap used to `continue` past anything deeper, which turned the
      // bound itself into the bypass.
      const { status } = runHook(
        bash(`bash -c "bash -c \\"bash -c \\\\\\"${CREATE}\\\\\\"\\""`)
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("does not intercept remote execution — a documented limit", () => {
      // Catching this needs recursion into arbitrary trailing quoted operands,
      // which re-refuses `git commit -m "the gh issue create guard"`. Remote
      // execution runs against another host's tracker config and needs that
      // host's own guard. Stated in the rule, not implied away here.
      const { status } = runHook(bash(`ssh host '${CREATE}'`));

      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("DP8 — glued operators and gh api flag parsing", () => {
    it.each([
      ["a glued &&", `true&&${CREATE}`],
      ["a glued ;", `true;${CREATE}`],
    ])("refuses after %s", (_label, command) => {
      const { status } = runHook(bash(command));

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses when a boolean flag precedes the endpoint", () => {
      // `--silent` takes no value, so a filter that skips the token after every
      // flag swallowed the endpoint itself.
      const { status } = runHook(
        bash("gh api -X POST --silent repos/o/r/issues -f title=x")
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses when a global flag precedes the api subcommand", () => {
      const { status } = runHook(
        bash("gh --verbose api repos/o/r/issues -f title=x")
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("does not mistake an endpoint-shaped payload value for the endpoint", () => {
      const { status } = runHook(
        bash("gh api repos/o/r/comments -f path=repos/o/r/issues")
      );

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("leaves an api read alone", () => {
      const { status } = runHook(bash("gh api repos/o/r/issues"));

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("leaves a GraphQL mutation name in prose alone", () => {
      const { status } = runHook(bash('git commit -m "fix issueCreate typo"'));

      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("DP9 — decoration on the endpoint argument", () => {
    // The endpoint was recognised by matching the RAW argument against a
    // pattern anchored with `$`, so anything appended past `/issues` — a query
    // string, a fragment, a trailing space inside quotes — made the anchor
    // fail and the creation was ALLOWED. `?foo=1` additionally hid behind the
    // `=`-bearing-token filter that exists to ignore payload values, so the
    // token was skipped before the pattern ever ran. Two mechanisms, one
    // symptom, both fixed by comparing the parsed PATH component instead.
    it.each([
      ["a query string", "gh api -X POST repos/o/r/issues?foo=1 -f title=x"],
      ["a valueless query", "gh api -X POST repos/o/r/issues?foo -f title=x"],
      ["a fragment", "gh api -X POST repos/o/r/issues#frag -f title=x"],
      [
        "a query on the trailing-slash form",
        "gh api -X POST repos/o/r/issues/?foo=1 -f title=x",
      ],
      [
        "a fragment ahead of a query",
        "gh api -X POST repos/o/r/issues#a?b -f title=x",
      ],
      [
        "trailing whitespace inside quotes",
        'gh api -X POST "repos/o/r/issues " -f title=x',
      ],
      [
        "a query on the absolute URL form",
        "gh api -X POST https://api.github.com/repos/o/r/issues?foo=1 -f title=x",
      ],
    ])("refuses an undeclared creation carrying %s", (_label, command) => {
      const { status } = runHook(bash(command));

      expect(status).toBe(EXIT_BLOCKED);
    });

    // The negative controls. Stripping the anchor rather than the decoration
    // would refuse all three, and a guard that refuses everything passes a
    // naive bite test while being useless.
    it("leaves a legitimate issues sub-path alone", () => {
      const { status } = runHook(
        bash("gh api -X POST repos/o/r/issues/123/comments -f body=b")
      );

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("leaves a decorated legitimate sub-path alone", () => {
      const { status } = runHook(
        bash("gh api -X POST repos/o/r/issues/123/comments?foo=1 -f body=b")
      );

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("does not mistake a decorated payload value for the endpoint", () => {
      const { status } = runHook(
        bash("gh api repos/o/r/comments -f path=repos/o/r/issues?x=1")
      );

      expect(status).toBe(EXIT_ALLOWED);
    });

    // Acceptance 2: the fix must recognise the decorated endpoint, not reject
    // every decorated argument. A declared filing is still let through.
    it("accepts a declared creation on the decorated endpoint", () => {
      const { status } = runHook(
        bash(
          "gh api -X POST repos/o/r/issues?foo=1 -f title=x " +
            `-f body='${GATE_MARKER}'`
        )
      );

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("still resolves the target repository through the decoration", () => {
      // The repo the filing is ADDRESSED at is read from the same endpoint
      // token by a SECOND end-anchored pattern carrying the same defect. If
      // only the classifier were fixed, the refusal would land but name the
      // wrong repository's vocabulary back to the operator.
      const { status, stderr } = runHook(
        bash("gh api -X POST repos/other/repo/issues?foo=1 -f title=x"),
        {
          cwd: projectWithTracker({
            github: {
              labels: { build: { ready: CUSTOM_ROLE } },
              org: "own-org",
              repo: "own-repo",
            },
            tracker: "github",
          }),
        }
      );

      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain("ADDRESSED AT ANOTHER REPOSITORY: `other/repo`");
    });
  });

  describe("DP6 — path forms", () => {
    it.each([
      ["absolute path", `/opt/homebrew/bin/${CREATE}`],
      [
        "unlisted prefix plus absolute path",
        `timeout /opt/homebrew/bin/${CREATE}`,
      ],
      ["wrapper flag plus absolute path", `nice -n 5 /usr/local/bin/${CREATE}`],
    ])("refuses a %s", (_label, command) => {
      const { status } = runHook(bash(command));

      expect(status).toBe(EXIT_BLOCKED);
    });
  });
});
