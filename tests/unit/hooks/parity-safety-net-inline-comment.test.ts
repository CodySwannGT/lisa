/** Shell comments cannot replace the function the shell really calls (#4471). */
import { createHash } from "node:crypto";
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
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const HOOK = path.resolve("plugins/src/base/hooks/parity-safety-net.sh");
const SCRIPT = "run.sh";
const LEAF = "payload.sh";
// Only the hook runs. These source bytes are inspected and never executed.
const DANGEROUS = `${"r"}${"m"} -${"r"}${"f"} /Users/probe/outside-project`;
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

describe("safety-net inline shell comments (#4471)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "lisa-inline-comment-"));
    writeFileSync(path.join(root, LEAF), `#!/bin/bash\n${DANGEROUS}\n`);
    mkdirSync(path.join(root, "safe"));
    writeFileSync(path.join(root, "safe", LEAF), "echo safe\n");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /**
   * Feed inert source through the actual hook's indirect file inspection.
   * @param name - Stable evidence label for this fixture.
   * @param content - Inert shell text that only the hook inspects.
   * @param finalNewline - Whether the inspected file ends with a newline.
   * @returns Native guard process result.
   */
  function inspect(name: string, content: string, finalNewline = true) {
    const source = `#!/bin/bash\n${content}${finalNewline ? "\n" : ""}`;
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: `sh ${SCRIPT}` },
    });
    const result = runHook(source, input);
    console.info(
      JSON.stringify({
        fixture: name,
        command: ["/bin/bash", HOOK],
        payload: JSON.parse(input),
        fixtureSha256: digest(source),
        leafSha256: digest(readFileSync(path.join(root, LEAF))),
        hookSha256: digest(readFileSync(HOOK)),
        status: result.status,
        signal: result.signal,
        error: result.error?.message,
        stdout: String(result.stdout),
        stderr: String(result.stderr),
      })
    );
    return result;
  }

  /**
   * Write the inert fixture and execute only the inspection hook.
   * @param source - Exact inspected bytes, never executed as a script.
   * @param input - PreToolUse JSON payload sent to the hook.
   * @returns Native guard process result.
   */
  function runHook(source: string, input: string) {
    writeFileSync(path.join(root, SCRIPT), source);
    return boundedSpawnSync({
      command: "/bin/bash",
      args: [HOOK],
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      input,
      label: "inspect inert inline-comment shell fixture",
    });
  }

  it("refuses the original function after an inline-comment fake redefinition", () => {
    const result = inspect(
      "primary-inline",
      `f () { sh ${LEAF}; }\n: # x; f () { echo ok; }\nf`
    );
    expect(result.status, String(result.stderr)).toBe(2);
  });

  it("retains the existing full-line-comment refusal control", () => {
    const result = inspect(
      "full-line-control",
      `f () { sh ${LEAF}; }\n# x; f () { echo ok; }\nf`
    );
    expect(result.status, String(result.stderr)).toBe(2);
  });

  it("refuses when a called function body contains the fake redefinition", () => {
    const result = inspect(
      "called-body-inline",
      `h () { sh ${LEAF}; }\ng () {\n: # y; h () { echo ok; }\n}\ng\nh`
    );
    expect(result.status, String(result.stderr)).toBe(2);
  });

  it("allows a real safe function so refusal is not an unconditional file failure", () => {
    const result = inspect("safe-real-function", "f () { echo ok; }\nf");
    expect(result.status, String(result.stderr)).toBe(0);
  });

  it("retains the literal issue fixture as an already-refused whole-file control", () => {
    const result = inspect(
      "direct-body-control",
      `f () { ${DANGEROUS}; }\n: # x; f () { echo ok; }\nf`
    );
    expect(result.status, String(result.stderr)).toBe(2);
  });

  it("does not follow an uncalled refused function in an inspected script", () => {
    const result = inspect(
      "uncalled-function-control",
      `f () { sh ${LEAF}; }\necho safe`
    );
    expect(result.status, String(result.stderr)).toBe(0);
  });

  it.each([
    ["tab before comment", ":\t# x; f () { echo ok; }"],
    ["comment after semicolon", ":;# x; f () { echo ok; }"],
    ["function keyword in comment", ": # x; function f () { echo ok; }"],
    [
      "comment with misleading unmatched quotes",
      ": # \" ' x; f () { echo ok; }",
    ],
  ])("refuses the original called function with %s", (name, comment) => {
    const result = inspect(name, `f () { sh ${LEAF}; }\n${comment}\nf`);
    expect(result.status, String(result.stderr)).toBe(2);
  });

  it.each([
    ["parameter pattern removal", ": ${x#pat}"],
    ["argument count", ": $#"],
    ["literal word hash", ": a#b"],
    ["single quoted hash", ": '# x; f () { echo ok; }'"],
    ["double quoted hash", ': "# x; f () { echo ok; }"'],
    ["escaped hash", ": \\#"],
    ["quoted parameter pattern", ': "${x#pat}"'],
    ["double quoted escaped hash", ': "\\#"'],
  ])("preserves %s and the following refused call", (name, hash) => {
    const result = inspect(name, `f () { sh ${LEAF}; }\n${hash}; f`);
    expect(result.status, String(result.stderr)).toBe(2);
  });

  it.each([
    ["parameter pattern removal", ": ${x#pat}"],
    ["argument count", ": $#"],
    ["literal word hash", ": a#b"],
    ["single quoted hash", ": '# text'"],
    ["double quoted hash", ': "# text"'],
    ["escaped hash", ": \\#"],
  ])("keeps safe %s classifiable", (name, hash) => {
    const result = inspect(`safe-${name}`, `${hash}; echo safe`);
    expect(result.status, String(result.stderr)).toBe(0);
  });

  const nonBlanks = [
    ["form feed", "\f"],
    ["vertical tab", "\v"],
    ["carriage return", "\r"],
  ];
  describe.each(nonBlanks)("non-Bash blank %s", (name, byte) => {
    it.each([
      ["name before parentheses", `f${byte}() { echo safe; }`],
      ["keyword before name", `function${byte}f () { echo safe; }`],
      ["keyword name before parentheses", `function f${byte}() { echo safe; }`],
      ["spaced parentheses header", `f${byte}( ) { echo safe; }`],
      ["leading byte before name", `${byte}f () { echo safe; }`],
      ["leading byte before keyword", `${byte}function f () { echo safe; }`],
    ])("cannot shadow a real definition through %s", (spelling, fake) => {
      const result = inspect(
        `${name}-${spelling}`,
        `f () { sh ${LEAF}; }\n${fake}\nf`
      );
      expect(result.status, String(result.stderr)).toBe(2);
    });

    it("does not treat the byte as brace-group header whitespace", () => {
      const result = inspect(
        `${name}-brace-header`,
        `f () { sh ${LEAF}; }\n{${byte} echo safe; }\nf`
      );
      expect(result.status, String(result.stderr)).toBe(2);
    });
  });

  it.each([" ", "\t"])(
    "retains real Bash blank %j in safe redefinitions",
    blank => {
      const result = inspect(
        `real-blank-${JSON.stringify(blank)}`,
        `f () { sh ${LEAF}; }\nf${blank}() { echo safe; }\nf`
      );
      expect(result.status, String(result.stderr)).toBe(0);
    }
  );
  it.each([
    ["escaped blank before hash", ": word\\ #literal"],
    ["backslash-newline joins a word before hash", ": word\\\n#literal"],
    ["joined quoted word before hash", ": 'word'\\\n#literal"],
    ["single quoted word adjacent to hash", ": 'word'#literal"],
    ["double quoted word adjacent to hash", ': "word"#literal'],
    ["empty quoted word adjacent to hash", ": ''#literal"],
    ["parameter default with boundary hash", ": ${x:- #literal}"],
    [
      "parameter default with nested command",
      ": \"${x:-$(echo '# literal')}\"",
    ],
  ])("retains the refused call after %s", (name, prefix) => {
    const result = inspect(name, `f () { sh ${LEAF}; }\n${prefix}; f`);
    expect(result.status, String(result.stderr)).toBe(2);
  });

  it("strips inline comments on the final line without a terminal newline", () => {
    const result = inspect(
      "no-final-newline",
      `f () { sh ${LEAF}; }\nf # x; f () { echo safe; }`,
      false
    );
    expect(result.status, String(result.stderr)).toBe(2);
  });

  it("a blank after a joined newline still starts a real comment", () => {
    const result = inspect(
      "joined-blank-comment",
      `f () { sh ${LEAF}; }\n: word\\\n # x; f () { echo safe; }\nf`
    );
    expect(result.status, String(result.stderr)).toBe(2);
  });

  it("keeps a direct refused operation after a joined word-owned hash", () => {
    const result = inspect(
      "joined-hash-direct-operation",
      `: word\\\n#literal; ${DANGEROUS}`
    );
    expect(result.status, String(result.stderr)).toBe(2);
  });

  it("keeps a genuinely full-line destructive-operation comment inert", () => {
    const result = inspect(
      "full-line-operation-comment",
      `# ${DANGEROUS}\necho safe`
    );
    expect(result.status, String(result.stderr)).toBe(0);
  });

  it("retains a call after a hash line inside a multiline quoted word", () => {
    const result = inspect(
      "multiline-quoted-hash-call",
      `f () { sh ${LEAF}; }\n: 'text\n#literal'; f`
    );
    expect(result.status, String(result.stderr)).toBe(2);
  });

  it("does not let comment-owned closers escape a called function body", () => {
    const result = inspect(
      "body-comment-fake-closers",
      `f () { sh ${LEAF}; }\ng () {\n: # } ; f () { echo safe; } ; ) & |\necho ok\n}\ng\nf`
    );
    expect(result.status, String(result.stderr)).toBe(2);
  });

  it.each(["&", "| cat"])(
    "ignores comment-owned %s after a directory change",
    operator => {
      const result = inspect(
        `comment-lookahead-cd-${operator}`,
        `cd safe # ${operator}\nsh ${LEAF}`
      );
      expect(result.status, String(result.stderr)).toBe(0);
    }
  );

  it.each(["&", "| cat"])(
    "ignores comment-owned %s after a function call",
    operator => {
      const result = inspect(
        `comment-lookahead-function-${operator}`,
        `move () { cd safe; }\nmove # ${operator}\nsh ${LEAF}`
      );
      expect(result.status, String(result.stderr)).toBe(0);
    }
  );
});
