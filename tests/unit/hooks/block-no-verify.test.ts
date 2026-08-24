/**
 * Tests for the block-no-verify.sh hook behavior.
 *
 * The hook blocks Bash commands that bypass pre-commit/pre-push hooks via the
 * --no-verify long flag, HUSKY=0 / HUSKY_SKIP_HOOKS= (disables husky hooks), or
 * core.hooksPath pointed at /dev/null or set empty (disables all git hooks). It
 * must match all syntactic positions (standalone, in subshells, etc.) while
 * excluding longer flags (--no-verify-ssl) and legit values (HUSKY=1,
 * core.hooksPath=.husky). The short `-n` form is matched too, scoped to a
 * `git commit` argv; those cases live in block-no-verify-short-flag.test.ts.
 * @module tests/unit/hooks/block-no-verify
 */
import path from "path";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const HOOK_PATH = path.resolve("plugins/lisa/hooks/block-no-verify.sh");
const BASH_PATH = "/bin/bash";

const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;

const runHook = (
  toolName: string,
  command: string
): { status: number | null; stderr: string } => {
  const input = JSON.stringify({
    tool_name: toolName,
    tool_input: { command },
  });

  const result = boundedSpawnSync({
    label: "block-no-verify.sh",
    command: BASH_PATH,
    args: [HOOK_PATH],
    input,
  });

  return { status: result.status, stderr: result.stderr };
};

describe("block-no-verify.sh", () => {
  describe("blocks commands with --no-verify", () => {
    it("blocks a simple git commit --no-verify", () => {
      const { status, stderr } = runHook("Bash", "git commit --no-verify");
      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain("Fix the underlying issue");
      expect(stderr).toContain("specific documented ignore");
      expect(stderr).not.toContain("ask the user before bypassing");
    });

    it("blocks --no-verify followed by additional flags", () => {
      const { status } = runHook("Bash", 'git commit --no-verify -m "bypass"');
      expect(status).toBe(EXIT_BLOCKED);
    });

    // Git resolves unambiguous abbreviations of long options, so each of these
    // skips hooks exactly as completely as the full spelling. An equality check
    // enforced the guard against only the longest form — the one spelling
    // nobody bypassing hooks in a hurry would bother to type.
    it.each(["--no-v", "--no-ve", "--no-ver", "--no-veri", "--no-verif"])(
      "blocks the abbreviation %s, which git accepts as --no-verify",
      (abbreviation: string) => {
        const { status } = runHook("Bash", `git commit ${abbreviation} -m x`);
        expect(status).toBe(EXIT_BLOCKED);
      }
    );

    it("does not block --no-verbose, which is a different flag", () => {
      // Diverges from --no-verify at the character after `--no-ver`, so it
      // fails the prefix test. Guarding the abbreviations must not swallow
      // neighbouring flags that happen to share a stem.
      const { status } = runHook("Bash", "git commit --no-verbose -m x");
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("blocks --no-verify inside a subshell with parentheses", () => {
      // Regression: `)` after --no-verify was not in the old allowed boundary
      // set, allowing (git commit --no-verify) to bypass the check.
      const { status } = runHook("Bash", "(git commit --no-verify)");
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks --no-verify at end of a conditional expression", () => {
      const { status } = runHook(
        "Bash",
        "[[ $var = --no-verify ]] && git commit --no-verify"
      );
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks --no-verify followed by semicolon", () => {
      const { status } = runHook("Bash", "git commit --no-verify; echo done");
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks --no-verify followed by pipe", () => {
      const { status } = runHook(
        "Bash",
        "git commit --no-verify | tee output.txt"
      );
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks standalone --no-verify at end of string", () => {
      const { status } = runHook("Bash", "git push --no-verify");
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("allows --no-verify when it only appears in heredoc payload text", () => {
      const { status } = runHook(
        "Bash",
        "gh issue create --body-file - <<'EOF'\nMention --no-verify in the issue body.\nEOF"
      );
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows --no-verify when it only appears in a message argument", () => {
      const { status } = runHook(
        "Bash",
        'gh issue comment 1 --body "Mention --no-verify in prose."'
      );
      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("blocks husky-disabling env bypasses", () => {
    it("blocks HUSKY=0 prefix", () => {
      const { status } = runHook("Bash", 'HUSKY=0 git commit -m "bypass"');
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks HUSKY_SKIP_HOOKS=1 prefix", () => {
      const { status } = runHook(
        "Bash",
        'HUSKY_SKIP_HOOKS=1 git commit -m "bypass"'
      );
      expect(status).toBe(EXIT_BLOCKED);
    });
  });

  describe("blocks core.hooksPath-disabling bypasses", () => {
    it("blocks core.hooksPath pointed at /dev/null", () => {
      const { status } = runHook(
        "Bash",
        'git -c core.hooksPath=/dev/null commit -m "bypass"'
      );
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks git config setting core.hooksPath to /dev/null", () => {
      const { status } = runHook("Bash", "git config core.hooksPath /dev/null");
      expect(status).toBe(EXIT_BLOCKED);
    });

    it.each(["CORE.HOOKSPATH", "core.hookspath", "Core.HooksPath"])(
      "blocks the case variant %s, since git config names are case-insensitive",
      variable => {
        // git treats CORE.HOOKSPATH and core.hooksPath as the same setting, so
        // a case-sensitive guard is bypassed by holding down shift.
        const { status } = runHook(
          "Bash",
          `git -c ${variable}=/var/no-hooks commit -m bypass`
        );
        expect(status).toBe(EXIT_BLOCKED);
      }
    );

    it.each([
      "--config-env=core.hooksPath=HOOKS",
      "--config-env=CORE.HOOKSPATH=HOOKS",
    ])("blocks %s, which sets the same config from an env var", flag => {
      // The path is never in the command — git reads it out of $HOOKS at run
      // time — so there is nothing to allowlist against and this is refused
      // outright.
      const { status } = runHook("Bash", `git ${flag} commit -m bypass`);
      expect(status).toBe(EXIT_BLOCKED);
    });

    // git accepts `--config-env <name>=<envvar>` as two tokens as well as one.
    // Guarding only the `=` spelling left the separate form to fall through to
    // the hooksPath allowlist below, which reads the trailing word as a PATH —
    // so naming the environment variable `.husky` or `.githooks` walked
    // straight through the allowlist while the variable itself held /dev/null.
    // Verified against real git: `env '.husky=/dev/null' git --config-env
    // core.hooksPath=.husky config --get core.hooksPath` prints /dev/null.
    it.each([".husky", ".githooks", "HOOKS"])(
      "blocks the separate-token --config-env core.hooksPath=%s",
      envVar => {
        const { status } = runHook(
          "Bash",
          `git --config-env core.hooksPath=${envVar} commit -m bypass`
        );
        expect(status).toBe(EXIT_BLOCKED);
      }
    );

    it("blocks the separate-token form spelled in mixed case", () => {
      const { status } = runHook(
        "Bash",
        "git --config-env CORE.HOOKSPATH=.husky commit -m bypass"
      );
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("allows separate-token --config-env naming an unrelated setting", () => {
      const { status } = runHook(
        "Bash",
        "git --config-env user.name AUTHOR commit -m normal"
      );
      expect(status).toBe(EXIT_ALLOWED);
    });

    it.each([".no-hooks-here", "build/empty", "..", "/"])(
      "blocks core.hooksPath redirected to %s",
      hooksPath => {
        // The bypass a denylist of "obviously disabling" values could never
        // catch: any directory that simply contains no hooks disables them as
        // completely as /dev/null, so the permitted destinations have to be
        // enumerated instead.
        const { status } = runHook(
          "Bash",
          `git -c core.hooksPath=${hooksPath} commit -m bypass`
        );
        expect(status).toBe(EXIT_BLOCKED);
      }
    );

    it("blocks core.hooksPath set empty", () => {
      const { status } = runHook(
        "Bash",
        "git -c core.hooksPath= commit -m bypass"
      );
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks quoted core.hooksPath set to /dev/null", () => {
      const { status } = runHook(
        "Bash",
        'git -c "core.hooksPath=/dev/null" commit -m bypass'
      );
      expect(status).toBe(EXIT_BLOCKED);
    });
  });

  describe("blocks the GIT_CONFIG_KEY_<n> env-var config override", () => {
    // `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath
    // GIT_CONFIG_VALUE_0=/dev/null git commit` sets command-scope config
    // exactly as `-c core.hooksPath=...` does, disabling every hook, while
    // matching none of the `-c` / `--config-env=` token shapes. Upstream Lisa
    // missed it until a downstream fork (acmeorga/frontend 797aa423) caught
    // it — this suite is what stops the weaker guard coming back.
    it("blocks the canonical GIT_CONFIG_COUNT/KEY/VALUE triple", () => {
      const { status, stderr } = runHook(
        "Bash",
        "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m bypass"
      );
      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain("Fix the underlying issue");
    });

    // A guard that only checked index 0 would be evaded by typing a 1.
    it.each(["0", "1", "2", "7", "10", "42"])(
      "blocks GIT_CONFIG_KEY_%s, since the index is arbitrary",
      index => {
        const { status } = runHook(
          "Bash",
          `GIT_CONFIG_COUNT=${Number(index) + 1} GIT_CONFIG_KEY_${index}=core.hooksPath GIT_CONFIG_VALUE_${index}=/tmp/empty git commit -m bypass`
        );
        expect(status).toBe(EXIT_BLOCKED);
      }
    );

    it.each(["CORE.HOOKSPATH", "core.hookspath", "Core.HooksPath"])(
      "blocks the case variant GIT_CONFIG_KEY_0=%s",
      value => {
        // git config names are case-insensitive, so a case-sensitive guard is
        // bypassed by holding down shift.
        const { status } = runHook(
          "Bash",
          `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=${value} GIT_CONFIG_VALUE_0=/dev/null git commit -m bypass`
        );
        expect(status).toBe(EXIT_BLOCKED);
      }
    );

    it("blocks the quoted spelling", () => {
      const { status } = runHook(
        "Bash",
        'GIT_CONFIG_KEY_0="core.hooksPath" GIT_CONFIG_VALUE_0=/dev/null git commit -m bypass'
      );
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks it when routed through env", () => {
      const { status } = runHook(
        "Bash",
        "env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m bypass"
      );
      expect(status).toBe(EXIT_BLOCKED);
    });

    // Refused outright rather than allowlisted against GIT_CONFIG_VALUE_<n>,
    // for the same reason --config-env= is: the value is a separate token that
    // can be exported earlier, reordered, or omitted entirely, so it is not
    // something this hook can hold still long enough to vet.
    it("blocks it even when the paired value is an allowlisted hooks dir", () => {
      const { status } = runHook(
        "Bash",
        "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=.husky git commit -m bypass"
      );
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("allows GIT_CONFIG_KEY_<n> naming an unrelated setting", () => {
      // Only hook-disabling config is this hook's business; overriding
      // user.name through the same mechanism is ordinary and must stay allowed.
      const { status } = runHook(
        "Bash",
        'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=CI git commit -m "normal"'
      );
      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("allows commands without --no-verify", () => {
    it("allows git commit without --no-verify", () => {
      const { status } = runHook("Bash", 'git commit -m "normal commit"');
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows HUSKY=1 (enabling husky)", () => {
      const { status } = runHook("Bash", 'HUSKY=1 git commit -m "normal"');
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows HUSKY=0 when it only appears in heredoc payload text", () => {
      const { status } = runHook(
        "Bash",
        "gh issue create --body-file - <<EOF\nMention HUSKY=0 in the issue body.\nEOF"
      );
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows a legit custom core.hooksPath", () => {
      const { status } = runHook(
        "Bash",
        'git -c core.hooksPath=.husky commit -m "normal"'
      );
      expect(status).toBe(EXIT_ALLOWED);
    });

    it.each([".githooks", "./.husky", ".husky/"])(
      "allows the in-repo hooks directory %s",
      hooksPath => {
        const { status } = runHook(
          "Bash",
          `git -c core.hooksPath=${hooksPath} commit -m normal`
        );
        expect(status).toBe(EXIT_ALLOWED);
      }
    );

    it("allows unsetting core.hooksPath", () => {
      const { status } = runHook("Bash", "git config --unset core.hooksPath");
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows --no-verify-ssl (longer flag)", () => {
      const { status } = runHook(
        "Bash",
        "curl --no-verify-ssl https://example.com"
      );
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows --no-verify-host (longer flag)", () => {
      const { status } = runHook("Bash", "ssh --no-verify-host user@host");
      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("ignores non-Bash tools", () => {
    it("allows non-Bash tools even with --no-verify in input", () => {
      const { status } = runHook("Read", "git commit --no-verify");
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows Write tool even with --no-verify in input", () => {
      const { status } = runHook("Write", "--no-verify");
      expect(status).toBe(EXIT_ALLOWED);
    });
  });
});
