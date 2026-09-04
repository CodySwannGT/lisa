/**
 * The destructive guard must follow execution into the file a command RUNS.
 *
 * ## What was broken
 *
 * `parity-safety-net.sh` classified from the invoking command TEXT only. A
 * recursive forced delete of an absolute path outside the project was refused
 * when typed inline and ALLOWED — silently, exit 0 with no output at all — when
 * the same line sat in a file run as `bash <file>`. Twelve indirection
 * spellings were measured against the shipped 4.31.1 artifact and every one of
 * them allowed: `bash`, `sh`, `zsh`, `env bash`, `source`, `.`, a shebang
 * script invoked directly, `bash -c 'bash <file>'`, `eval "$(cat <file>)"`,
 * `bash < <file>`, `cat <file> | bash`, and a script that runs a second script.
 *
 * Every sibling defect in this family fails CLOSED — a false positive or a
 * packaging bug, annoying and visible. This one failed OPEN on a
 * destructive-action guard and reported nothing, so an operator who installed
 * the hook to gate deletes outside the project got no signal that the check had
 * not run. A guard that fails closed spends time; a guard that fails open
 * spends data.
 *
 * It was also the DEFAULT path rather than an edge case: the same hook refuses
 * heredocs with an instruction to write the payload to a file and execute that
 * file, so the tooling routed agents onto exactly the shape the destructive
 * scan could not see. Nobody had to evade anything.
 *
 * ## What this suite pins, and the control on the other side
 *
 * Per CodySwannGT/lisa#3111 a shell guard cannot be mutation-tested, so bite
 * evidence is a payload table with a control on BOTH sides, and per
 * CodySwannGT/lisa#3190 a suite that exercises one side proves nothing. Both
 * sides are here, and the negative side is load-bearing rather than decorative.
 *
 * The known-WRONG fix has already been made once in this family: a sibling
 * guard was taught to read the contents of any file a command NAMES, and it now
 * opens a path quoted as prose inside a fenced code block in a `--body-file`
 * markdown and attributes those contents to the command. The rule here is
 * narrower by construction — follow EXECUTION, never arguments — and the
 * negative cases pin it: a `grep` of the payload, a `--body-file` markdown
 * naming the payload, and a `git commit -F` all stay permitted. So does the
 * pass-by-path remedy the ordinary destructive refusal prints, which is the
 * half of the guidance that was always correct and must keep working.
 * @module tests/unit/hooks/parity-safety-net-follow-execution
 */
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
 * The recursive-delete syntax, assembled rather than written out, for the same
 * reason its sibling suite assembles it: spelling it literally would make this
 * file an instance of the class it describes.
 */
const RM = `${"r"}${"m"}`;
const DELETE = `${RM} -${"r"}${"f"}`;

/** A directory no test creates, outside the project and outside every tmp allowance. */
const OUTSIDE = "/Users/probe/outside-the-project/scratch";

/** The verdict the inline form reaches, which the indirect forms must match. */
const SAME_REASON =
  "recursive forced delete of an absolute path outside the project";

/** The size cap in the guard. A file past it is refused, never half-scanned. */
const FOLLOW_MAX_BYTES = 262144;

/** One classification: the hook's exit status and what it told the reader. */
interface Verdict {
  /** Exit status: 0 permitted, 2 refused. */
  readonly status: number | null;
  /** Everything the hook printed to stderr, which is what the model sees. */
  readonly stderr: string;
}

/**
 * Classify one proposed command. Nothing is executed — the hook is a classifier
 * over a command string handed to it as PreToolUse JSON.
 * @param command The proposed shell command.
 * @param hook Which shipped copy of the guard to ask.
 * @returns The hook's exit status and refusal text.
 */
const classify = (command: string, hook: string = HOOK_PATH): Verdict => {
  const outcome = boundedSpawnSync({
    label: "parity-safety-net.sh",
    command: "/bin/bash",
    args: [hook],
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      cwd: process.cwd(),
    }),
    env: process.env,
  });

  return { status: outcome.status, stderr: outcome.stderr ?? "" };
};

let fixtures = "";
/** A script whose one executable line deletes an absolute path outside the project. */
let payload = "";
/** A script that deletes only inside the project — the control for "a script ran". */
let benign = "";
/** A script that runs the payload, one hop further away from the command text. */
let nested = "";
/** A markdown body naming the payload inside a fenced code block. */
let body = "";
/** A shell script larger than the guard will inspect. */
let oversize = "";

beforeAll(() => {
  fixtures = mkdtempSync(path.join(tmpdir(), "follow-execution-"));
  payload = path.join(fixtures, "payload.sh");
  benign = path.join(fixtures, "benign.sh");
  nested = path.join(fixtures, "nested.sh");
  body = path.join(fixtures, "body.md");
  oversize = path.join(fixtures, "oversize.sh");

  writeFileSync(payload, `#!/usr/bin/env bash\n${DELETE} ${OUTSIDE}\n`);
  chmodSync(payload, 0o755);
  writeFileSync(
    benign,
    `#!/usr/bin/env bash\nset -euo pipefail\n${DELETE} ./build\n`
  );
  chmodSync(benign, 0o755);
  writeFileSync(nested, `#!/usr/bin/env bash\nbash ${payload}\n`);
  chmodSync(nested, 0o755);
  writeFileSync(
    body,
    `# Report\n\nThe path below is prose:\n\n\`\`\`\n${payload}\n\`\`\`\n`
  );
  writeFileSync(
    oversize,
    `#!/usr/bin/env bash\necho "${"x".repeat(FOLLOW_MAX_BYTES + 1024)}"\n`
  );
});

afterAll(() => {
  if (fixtures) {
    rmSync(fixtures, { recursive: true, force: true });
  }
});

describe("parity-safety-net.sh — following execution into an executed file", () => {
  describe("the destructive verdict no longer depends on where the line is written", () => {
    it("refuses the inline form, which is the verdict every other form must match", () => {
      const verdict = classify(`${DELETE} ${OUTSIDE}`);

      expect(verdict.status).toBe(EXIT_BLOCKED);
      expect(verdict.stderr).toContain(SAME_REASON);
    });

    it("refuses the same delete inside a script run as `bash <file>`", () => {
      const verdict = classify(`bash ${payload}`);

      expect(verdict.status).toBe(EXIT_BLOCKED);
      expect(verdict.stderr).toContain(SAME_REASON);
    });

    it.each([
      ["sh <file>", (file: string) => `sh ${file}`],
      ["zsh <file>", (file: string) => `zsh ${file}`],
      ["env bash <file>", (file: string) => `env bash ${file}`],
      ["source <file>", (file: string) => `source ${file}`],
      [". <file>", (file: string) => `. ${file}`],
      ["<file> via its shebang", (file: string) => file],
      ["bash -c 'bash <file>'", (file: string) => `bash -c 'bash ${file}'`],
      ['eval "$(cat <file>)"', (file: string) => `eval "$(cat ${file})"`],
      ["bash < <file>", (file: string) => `bash < ${file}`],
      ["cat <file> | bash", (file: string) => `cat ${file} | bash`],
    ])("refuses the measured indirection form %s", (_label, spell) => {
      const verdict = classify(spell(payload));

      expect(verdict.status).toBe(EXIT_BLOCKED);
      expect(verdict.stderr).toContain(SAME_REASON);
    });

    it("refuses a delete one hop further out, in a script the script runs", () => {
      const verdict = classify(`bash ${nested}`);

      expect(verdict.status).toBe(EXIT_BLOCKED);
      expect(verdict.stderr).toContain(SAME_REASON);
    });

    it("names the executed file in the refusal, so the reader is not sent to reword a line they never typed", () => {
      const verdict = classify(`bash ${payload}`);

      expect(verdict.stderr).toContain(payload);
    });
  });

  /**
   * Found by review before this shipped, and the reason it is worth its own
   * block: it is the SAME defect one layer along. The walk stepped over a
   * wrapper's option but not that option's VALUE, so `nice -n 5 bash <file>`
   * left the walk standing on `5` — an argument position — and the invocation
   * was never reached. The guard reported nothing, exactly as it had before.
   *
   * A wrapper prefix is what someone reaches for when a command needs a
   * niceness, a timeout, or a clean environment. It is not exotic, and
   * shipping without it would have reproduced the defect the issue exists to
   * close while looking complete.
   */
  describe("a wrapper's own operand does not close the command position", () => {
    it.each([
      ["nice -n 5 bash <file>", (file: string) => `nice -n 5 bash ${file}`],
      [
        "sudo -u nobody bash <file>",
        (file: string) => `sudo -u nobody bash ${file}`,
      ],
      ["timeout 5 bash <file>", (file: string) => `timeout 5 bash ${file}`],
      ["timeout 5m bash <file>", (file: string) => `timeout 5m bash ${file}`],
      [
        "timeout -s KILL 5 bash <file>",
        (file: string) => `timeout -s KILL 5 bash ${file}`,
      ],
      [
        "sudo -u root nice -n 5 bash <file>",
        (file: string) => `sudo -u root nice -n 5 bash ${file}`,
      ],
    ])("refuses the wrapper-operand form %s", (_label, spell) => {
      const verdict = classify(spell(payload));

      expect(verdict.status).toBe(EXIT_BLOCKED);
      expect(verdict.stderr).toContain(SAME_REASON);
    });

    // The other half of the rule. Stepping over an operand must YIELD whenever
    // the next token could itself be the program, or the fix trades a
    // fail-open for a different fail-open: `env -i bash <file>` would lose the
    // interpreter, and `env -i <file>` would lose the script.
    it.each([
      ["env -i bash <file>", (file: string) => `env -i bash ${file}`],
      ["env -i <file> via its shebang", (file: string) => `env -i ${file}`],
      [
        "nice -n 5 <file> via its shebang",
        (file: string) => `nice -n 5 ${file}`,
      ],
      [
        "timeout 5 <file> via its shebang",
        (file: string) => `timeout 5 ${file}`,
      ],
    ])("still reaches the program in %s rather than eating it", (_l, spell) => {
      const verdict = classify(spell(payload));

      expect(verdict.status).toBe(EXIT_BLOCKED);
      expect(verdict.stderr).toContain(SAME_REASON);
    });

    // The known-wrong fix, pinned from the wrapper side. Stepping over an
    // operand must not turn the token after it into a followed path when that
    // token is an ARGUMENT — #3604's defect, reached by a different route.
    it.each([
      [
        "nice -n 5 grep -n x <file>",
        (file: string) => `nice -n 5 grep -n x ${file}`,
      ],
      ["timeout 5 cat <file>", (file: string) => `timeout 5 cat ${file}`],
      [
        "sudo -u nobody cat <file>",
        (file: string) => `sudo -u nobody cat ${file}`,
      ],
      [
        "nice -n 5 git commit -F <file>",
        (file: string) => `nice -n 5 git commit -F ${file}`,
      ],
    ])("permits %s, which names the payload but never runs it", (_l, spell) => {
      const verdict = classify(spell(payload));

      expect(verdict.status).toBe(EXIT_ALLOWED);
      expect(verdict.stderr).toBe("");
    });
  });

  describe("pass-by-path for quoted CONTENT still works — the remedy that is correct", () => {
    it("permits a `--body-file` markdown that names the payload inside a fenced code block", () => {
      const verdict = classify(`gh issue create --title x --body-file ${body}`);

      expect(verdict.status).toBe(EXIT_ALLOWED);
      expect(verdict.stderr).toBe("");
    });

    it("permits `git commit -F <file>` naming the payload", () => {
      const verdict = classify(`git commit -F ${payload}`);

      expect(verdict.status).toBe(EXIT_ALLOWED);
      expect(verdict.stderr).toBe("");
    });

    it("permits a command that merely READS the payload", () => {
      const verdict = classify(`grep -n delete ${payload}`);

      expect(verdict.status).toBe(EXIT_ALLOWED);
      expect(verdict.stderr).toBe("");
    });

    it("permits a script that deletes only inside the project", () => {
      const verdict = classify(`bash ${benign}`);

      expect(verdict.status).toBe(EXIT_ALLOWED);
    });

    it("permits prose that merely NAMES an invocation it does not perform", () => {
      const verdict = classify(`echo "run bash ${payload} to clean up"`);

      expect(verdict.status).toBe(EXIT_ALLOWED);
    });

    it("permits a heredoc fed to an interpreter, whose payload is already in the command text", () => {
      const verdict = classify(`bash <<'EOF'\necho hi\nEOF`);

      expect(verdict.status).toBe(EXIT_ALLOWED);
    });

    it("permits an interpreter whose output is redirected, reading the redirect as a destination", () => {
      const verdict = classify(`bash ${benign} > /dev/null 2>&1`);

      expect(verdict.status).toBe(EXIT_ALLOWED);
    });
  });

  describe("an execution it cannot follow fails CLOSED and says so", () => {
    it.each([
      ["a computed target", 'bash "$SCRIPT"'],
      ["a target that does not exist", "bash ./no-such-script-here.sh"],
      [
        "a dispatcher building the invocation",
        "find . -name '*.sh' -exec bash {} \\;",
      ],
      [
        "a dispatcher feeding an interpreter from stdin",
        "git ls-files | xargs bash",
      ],
      ["a computed target being sourced", 'source "$HELPERS"'],
    ])("refuses %s rather than passing it", (_label, command) => {
      const verdict = classify(command);

      expect(verdict.status).toBe(EXIT_BLOCKED);
      expect(verdict.stderr).toContain(
        "cannot classify the file this command executes"
      );
    });

    it("names a remedy the operator can perform", () => {
      const verdict = classify('bash "$SCRIPT"');

      expect(verdict.stderr).toContain("LITERAL path");
      expect(verdict.stderr).toContain("run it manually outside the agent");
    });

    it("refuses a file past the inspection cap rather than half-scanning it", () => {
      const verdict = classify(`bash ${oversize}`);

      expect(verdict.status).toBe(EXIT_BLOCKED);
      expect(verdict.stderr).toContain("inspection cap");
    });
  });

  describe("the heredoc remedy no longer names a form the destructive scan cannot see", () => {
    /**
     * An unterminated heredoc fails the arm's shell-syntax validation, which is
     * the shortest way to drive the refusal that prints the remedy.
     */
    const HEREDOC_REFUSAL = "cat <<EOF\nsome payload";

    it("stops advertising an interpreter whose executed files are not read", () => {
      const verdict = classify(HEREDOC_REFUSAL);

      expect(verdict.status).toBe(EXIT_BLOCKED);
      expect(verdict.stderr).toContain("write the payload to a file");
      expect(verdict.stderr).not.toContain("python3");
    });

    it("names `bash <file>`, and the destructive scan follows exactly that form", () => {
      const remedy = classify(HEREDOC_REFUSAL);
      const followed = classify(`bash ${payload}`);

      expect(remedy.stderr).toContain("bash <file>");
      expect(followed.status).toBe(EXIT_BLOCKED);
      expect(followed.stderr).toContain(SAME_REASON);
    });
  });

  describe("both shipped copies behave identically", () => {
    it.each(SHIPPED_COPIES)("%s reaches the same verdicts", copy => {
      expect(classify(`${DELETE} ${OUTSIDE}`, copy).status).toBe(EXIT_BLOCKED);
      expect(classify(`bash ${payload}`, copy).status).toBe(EXIT_BLOCKED);
      expect(classify(`grep -n delete ${payload}`, copy).status).toBe(
        EXIT_ALLOWED
      );
      expect(
        classify(`gh issue create --title x --body-file ${body}`, copy).status
      ).toBe(EXIT_ALLOWED);
    });
  });
});
