/**
 * Contract tests for the documented remote-environment setup field.
 *
 * That field is pasted into a vendor settings box: no review, no version
 * history, and — until this file — no test. It broke exactly the way untested
 * prose breaks, by being correct on the surface its author used and wrong on
 * the other one.
 *
 * The line under test is the EMITTED one, because it is now the only one. It
 * used to be read out of `SKILL.md`, with a separate assertion that the two
 * agreed — a reasonable guard while there were two copies, and a guard the
 * duplication itself kept defeating: the documented copy is a snapshot taken at
 * build time, the release bumps the version after the build, and so the two
 * disagreed after every single release. `SKILL.md` now tells operators to ask
 * for the line instead of copying it, which removes the second copy and with it
 * the thing the parity assertion was defending.
 * @module tests/unit/secrets/remote-env-setup-field
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SETUP_FIELD } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

const SKILL = "plugins/src/base/skills/lisa-setup-remote-env/SKILL.md";

/** Where the entrypoint lives inside a checkout. */
const ENTRYPOINT = "scripts/lisa-remote-env/setup.sh";

/** Markers for the two checkouts in the multi-repo fixtures, named to sort apart. */
const ALPHA = "FOUND-alpha";
const ZULU = "FOUND-zulu";

/** Absolute, so the interpreter is never resolved through a writeable PATH. */
const BASH = "/bin/bash";

/**
 * Build a checkout containing a stub entrypoint that identifies itself.
 * @param root Directory to create the checkout in.
 * @param marker Text the stub prints when executed.
 */
function checkout(root: string, marker: string): void {
  const dir = path.join(root, path.dirname(ENTRYPOINT));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(root, ENTRYPOINT), `echo ${marker}\n`);
}

describe("SKILL.md", () => {
  it("tells operators to ASK for the field rather than copying one", () => {
    // The parity assertion that used to live here is gone because its subject
    // is: there is no second copy to disagree with. What replaces it is the
    // guarantee that made the copy unnecessary — the document points at the
    // emitter, and carries no pinned version of its own to go stale.
    const doc = readFileSync(SKILL, "utf8");

    expect(doc).toContain("remote-env --emit=");
    expect(doc).not.toMatch(/@codyswann\/lisa@\d+\.\d+\.\d+/);
    expect(doc).not.toContain("for f in scripts/lisa-remote-env/setup.sh");
  });
});

describe("the emitted remote-env setup field", () => {
  let temporary: string;

  beforeEach(() => {
    temporary = mkdtempSync(path.join(tmpdir(), "lisa-setup-field-"));
  });

  afterEach(() => {
    rmSync(temporary, { recursive: true, force: true });
  });

  /**
   * Run the emitted field with a given working directory.
   * @param cwd Directory the vendor would run the field from.
   * @param home Value of `$HOME` in the container, which defaults to `cwd`
   *   because on Claude Code web they are the same directory.
   * @returns Combined output of the field.
   */
  const runField = (cwd: string, home = cwd): string =>
    boundedExecFileSync({
      label: "the remote-env setup field",
      command: BASH,
      args: ["-c", SETUP_FIELD],
      cwd,
      // The field consults $HOME, so the tests must control it. Inheriting the
      // developer's real home would make them depend on that machine's layout
      // and would let a passing run mean nothing.
      env: { ...process.env, HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  it("finds the entrypoint when the field runs FROM the checkout (Codex Cloud)", () => {
    checkout(temporary, "FOUND-codex");
    expect(runField(temporary)).toBe("FOUND-codex");
  });

  it("finds the entrypoint one level down (Claude Code web runs from $HOME)", () => {
    const home = path.join(temporary, "home");
    mkdirSync(home, { recursive: true });
    checkout(path.join(home, "frontend"), "FOUND-claude-web");
    expect(runField(home)).toBe("FOUND-claude-web");
  });

  it("never DEPENDS on $HOME containing the checkout", () => {
    // The field this replaced was `bash "$HOME"/*/scripts/...`, correct on
    // Claude Code web and wrong on Codex Cloud, where the checkout lives at
    // /workspace/<repo> and is not under $HOME at all.
    //
    // Asserted by behaviour rather than by the absence of the string. $HOME is
    // now one candidate among several, and forbidding the text would forbid the
    // fallback below along with the bug — the guard is that a checkout outside
    // $HOME is still found, which is the property that actually broke.
    const home = path.join(temporary, "elsewhere");
    mkdirSync(home, { recursive: true });
    checkout(temporary, "FOUND-outside-home");
    expect(runField(temporary, home)).toBe("FOUND-outside-home");
  });

  it("finds a checkout under $HOME when cwd is neither", () => {
    // Reported from a live Claude environment: `$HOME` was `/root`, the field
    // ran somewhere with no checkout beneath it, and a cwd-only search could
    // not reach the repository at all —
    //   bash: /root/*/scripts/lisa-remote-env/setup.sh: No such file or directory
    // Nothing guarantees cwd is the checkout OR its parent, so the roots the
    // surfaces actually use are searched too.
    const home = path.join(temporary, "home");
    const elsewhere = path.join(temporary, "root");
    mkdirSync(elsewhere, { recursive: true });
    checkout(path.join(home, "frontend"), "FOUND-under-home");
    expect(runField(elsewhere, home)).toBe("FOUND-under-home");
  });

  it("prepares a checkout exactly once when the candidates overlap", () => {
    // cwd, $HOME and the checkout can all be the same directory, and several
    // candidate globs then match it. Preparing it twice is not merely wasteful:
    // a doubled log reads as two repositories, which is the opposite of what
    // the multi-checkout support above is there to make legible.
    checkout(temporary, "ONCE");
    expect(runField(temporary, temporary).split("ONCE")).toHaveLength(2);
  });

  it("prepares EVERY checkout, not whichever one sorts first", () => {
    // A Claude Code web environment can hold more than one repository. Stopping
    // at the first glob hit would prepare one chosen alphabetically and ignore
    // the rest — arbitrary, not merely limited.
    const home = path.join(temporary, "home");
    mkdirSync(home, { recursive: true });
    checkout(path.join(home, "alpha"), ALPHA);
    checkout(path.join(home, "zulu"), ZULU);

    const out = runField(home);
    expect(out).toContain(ALPHA);
    expect(out).toContain(ZULU);
  });

  it("reports a failure in one checkout without skipping the others", () => {
    const home = path.join(temporary, "home");
    mkdirSync(home, { recursive: true });
    checkout(path.join(home, "alpha"), ALPHA);

    // A broken second repository: must not hide the first, must not pass.
    const broken = path.join(home, "zulu", path.dirname(ENTRYPOINT));
    mkdirSync(broken, { recursive: true });
    writeFileSync(
      path.join(home, "zulu", ENTRYPOINT),
      `echo ${ZULU}\nexit 3\n`
    );

    let status = 0;
    let output = "";
    try {
      output = runField(home);
    } catch (error) {
      const failure = error as { exitCode?: number; stdout?: string };
      status = failure.exitCode ?? 0;
      output = failure.stdout ?? "";
    }

    expect(status).not.toBe(0);
    expect(output).toContain(ALPHA);
    expect(output).toContain(ZULU);
  });

  it("fails loudly when a checkout exists but carries no entrypoint", () => {
    // The original quiet-success guard, now scoped to the case it was really
    // about: a repository IS present and simply has no Lisa entrypoint. A `for`
    // loop over a glob that matches nothing exits 0 on its own, so this must
    // not be allowed to look like success.
    const repo = path.join(temporary, "repo");
    mkdirSync(path.join(repo, ".git"), { recursive: true });

    expect(() => runField(repo, repo)).toThrow();
  });

  it("succeeds quietly when there is NO checkout at all", () => {
    // Not the same failure. A Claude Tag channel session runs as the
    // organization and a repository does not enter the session until a request
    // names one, so a repo-less session is ordinary. Exiting non-zero here
    // would be severe: a setup script that exits non-zero stops the session
    // from starting, so the old blanket exit 1 killed every such session.
    const empty = path.join(temporary, "empty");
    mkdirSync(empty, { recursive: true });

    expect(() => runField(empty, empty)).not.toThrow();
  });

  it("says nothing is to be prepared when no tenant is named", () => {
    // Silence would be indistinguishable from a broken setup script.
    const empty = path.join(temporary, "empty");
    mkdirSync(empty, { recursive: true });

    expect(runField(empty, empty)).toContain("nothing to prepare");
  });

  it("describes the layout it found when a checkout has no entrypoint", () => {
    // This field lives in a vendor settings box with a slow edit-and-retry
    // loop, and the vendor surfaces only its stderr. A miss that names just the
    // path it wanted costs a whole round trip to learn one fact — which is
    // exactly what happened: `/root/*/scripts/...: No such file or directory`
    // said where it looked and nothing about where the checkout actually was.
    const empty = path.join(temporary, "empty");
    const home = path.join(temporary, "home");
    mkdirSync(path.join(empty, ".git"), { recursive: true });
    mkdirSync(path.join(home, "a-directory-that-is-there"), {
      recursive: true,
    });

    let stderr = "";
    try {
      runField(empty, home);
    } catch (error) {
      stderr = (error as { stderr?: string }).stderr ?? "";
    }

    expect(stderr).toContain("PWD=");
    expect(stderr).toContain("HOME=");
    expect(stderr).toContain("a-directory-that-is-there");
  });
});
