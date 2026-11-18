/**
 * The text of a carrier and of the call to it (CodySwannGT/lisa#4989).
 *
 * The carrier is read by operators and run by `sh` on machines Lisa knows
 * nothing about, so its text is held to what it must say and do: it is valid
 * POSIX shell, it asks for Node before anything else, it goes to the top
 * folder of the checkout before it looks for the runner, it hands the hook's
 * arguments to the runner, and it sits between markers that let a later run
 * find it, replace it in place and leave everything else alone.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  carrierCall,
  carrierCallBlock,
  carrierMarkers,
  carrierScript,
  carrierScriptPath,
  carrierStartLine,
  findMarkedBlock,
  PUSH_STDIN_USED,
  withMarkedBlock,
} from "../../../src/controls/carrier-script.js";
import {
  CARRIER_MOMENTS,
  type CarrierMoment,
} from "../../../src/controls/carrier-types.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const SH = "/bin/sh";
const HOST_HOOK = "#!/bin/sh\necho host check\n";

/** Every shell on this machine a repository's hook may be written for. */
const SHELLS = [SH, "/bin/dash", "/bin/bash", "/bin/zsh", "/bin/ksh"].filter(
  shell => existsSync(shell)
);

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Ask a shell whether a text is a script it can read, without running it.
 * @param script - The text
 * @param shell - The shell to ask; `sh` when left out
 * @returns What `sh -n` said; empty when the script is valid
 */
function syntaxErrors(script: string, shell = SH): string {
  const folder = mkdtempSync(path.join(tmpdir(), "lisa-carrier-script-"));
  const file = path.join(folder, "hook");
  cleanups.push(() => rmSync(folder, { force: true, recursive: true }));
  writeFileSync(file, script);
  return shSaid(
    boundedSpawnSync({
      label: `${shell} -n on a carrier script`,
      command: shell,
      args: ["-n", file],
    })
  );
}

/**
 * Everything a finished `sh` printed, on either stream.
 * @param finished - The finished child
 * @param finished.stdout - What it printed on standard output
 * @param finished.stderr - What it printed on standard error
 * @returns Both streams, joined
 */
function shSaid(finished: {
  readonly stdout?: string | null;
  readonly stderr?: string | null;
}): string {
  return `${finished.stdout ?? ""}${finished.stderr ?? ""}`;
}

/**
 * Unwrap an edit that was expected to succeed.
 * @param edit - The edit
 * @returns Its text and state
 */
function done(edit: ReturnType<typeof withMarkedBlock>): {
  readonly text: string;
  readonly state: string;
} {
  if (edit.problem !== null) throw new Error(edit.problem);
  return edit;
}

describe.each(CARRIER_MOMENTS)("the carrier for the %s moment", moment => {
  const script = carrierScript(moment);
  const lines = script.split("\n");

  it("is a POSIX shell script that sh accepts", () => {
    expect(lines[0]).toBe("#!/bin/sh");
    expect(script.endsWith("\n")).toBe(true);
    expect(syntaxErrors(script)).toBe("");
  });

  it("is short enough to read in one look", () => {
    expect(lines.length).toBeLessThanOrEqual(20);
  });

  it("sits between its begin and end markers", () => {
    const { begin, end } = carrierMarkers(moment);

    expect(lines[1]).toBe(begin);
    expect(lines.at(-2)).toBe(end);
  });

  it("asks for Node before it starts anything that needs Node", () => {
    const asks = lines.findIndex(line => line.includes("command -v node"));
    const starts = lines.findIndex(line => line.startsWith("exec node "));

    expect(asks).toBeGreaterThan(-1);
    expect(starts).toBeGreaterThan(asks);
    expect(lines.slice(asks, starts).join("\n")).toMatch(
      /Node\.js is missing[^\n]*>&2\n {2}exit 1/u
    );
  });

  it("hands the hook's arguments and standard input to the runner", () => {
    const commands = lines.filter(line => !line.startsWith("#"));

    expect(commands.at(-2)).toBe(
      `exec node scripts/lisa-run-gates.mjs --moment=${moment} --builtins=none "$@"`
    );
    // Nothing redirects standard input, so the runner reads the hook's own.
    expect(commands.filter(line => line.includes("<"))).toEqual([]);
  });

  it("goes to the top folder of the checkout before it looks for the runner", () => {
    const goes = lines.findIndex(line => line.includes('cd -- "$(dirname'));
    const starts = lines.findIndex(line => line.startsWith("exec node "));

    // Two folders above the script, whatever folder it was started from.
    expect(lines[goes]).toBe(
      'if ! CDPATH= cd -- "$(dirname -- "$0")/../.." || [ ! -f scripts/lisa-run-gates.mjs ]; then'
    );
    expect(carrierScriptPath(moment).split("/")).toHaveLength(3);
    expect(starts).toBeGreaterThan(goes);
  });

  it("is called from an existing hook only after that hook passed", () => {
    const call = carrierCall(moment);
    const commands = call.filter(line => !line.trimStart().startsWith("#"));

    expect(commands.slice(0, 2)).toEqual([
      "lisa_status=$?",
      '[ "$lisa_status" -eq 0 ] || exit "$lisa_status"',
    ]);
    expect(commands).toContain(`  ${carrierStartLine(moment)}`);
  });

  it.each(SHELLS)("is called by lines %s accepts", shell => {
    expect(syntaxErrors(`${carrierCallBlock(moment)}\n`, shell)).toBe("");
  });

  it("lets the operation through only on an answer about its own repository", () => {
    const call = carrierCall(moment);
    const letsThrough = call.findIndex(line => line.includes("git cat-file"));

    // The sentence that lets a commit through is reached only when git named
    // the repository to the hook, or the hook file was found in the folder
    // git answered for. The integration suite holds this with real commits.
    expect(call[letsThrough]).toMatch(
      /^elif \[ -n "\$lisa_named\$lisa_ours" \] && /u
    );
    expect(call.join("\n")).toContain(
      `grep -qF -- "${carrierMarkers(moment).begin}" "$lisa_top/$0"`
    );
    expect(call.at(-3)).toMatch(/stopped: this hook can no longer tell/u);
    expect(call.slice(-2)).toEqual(["  exit 1", "fi"]);
  });

  it("is handed to a person with its two marker lines", () => {
    const { begin, end } = carrierMarkers(moment);
    const block = carrierCallBlock(moment).split("\n");

    expect(block[0]).toBe(begin);
    expect(block.at(-1)).toBe(end);
    expect(block.slice(1, -1)).toEqual(carrierCall(moment));
  });
});

describe("what the carriers say about the change being checked", () => {
  const TELLS_RUNNER = `[ -n "\${${PUSH_STDIN_USED}:-}" ] || set -- --push-refs=- "$@"`;

  /**
   * Start a carrier with a stand-in for Node that prints what it was given.
   * @param moment - The carrier's moment
   * @param env - Variables the caller sets
   * @returns The arguments the runner would have been started with
   */
  function runnerArguments(
    moment: CarrierMoment,
    env: Readonly<Record<string, string>> = {}
  ): string {
    const folder = mkdtempSync(path.join(tmpdir(), "lisa-carrier-args-"));
    const script = path.join(folder, carrierScriptPath(moment));
    // The folder a hook above the call may have left the shell in.
    const elsewhere = path.join(folder, "packages/web");
    cleanups.push(() => rmSync(folder, { force: true, recursive: true }));
    mkdirSync(path.join(folder, "scripts"));
    mkdirSync(path.dirname(script), { recursive: true });
    mkdirSync(elsewhere, { recursive: true });
    writeFileSync(path.join(folder, "scripts/lisa-run-gates.mjs"), "");
    writeFileSync(path.join(folder, "node"), '#!/bin/sh\necho "$@"\n');
    chmodSync(path.join(folder, "node"), 0o755);
    writeFileSync(script, carrierScript(moment));
    return (
      boundedSpawnSync({
        label: "a carrier script started as a hook",
        command: SH,
        args: [script, "origin", "an address"],
        cwd: elsewhere,
        env: { PATH: `${folder}:/usr/bin:/bin`, ...env },
        input: "",
      }).stdout ?? ""
    ).trim();
  }

  it("has the push carrier tell the runner to read what git wrote", () => {
    const commands = carrierScript("push")
      .split("\n")
      .filter(line => !line.startsWith("#"));

    expect(commands.at(-3)).toBe(TELLS_RUNNER);
    expect(runnerArguments("push")).toBe(
      "scripts/lisa-run-gates.mjs --moment=push --builtins=none --push-refs=- origin an address"
    );
  });

  it("says nothing about it once a hook that ran first may have read some", () => {
    expect(runnerArguments("push", { [PUSH_STDIN_USED]: "1" })).toBe(
      "scripts/lisa-run-gates.mjs --moment=push --builtins=none origin an address"
    );
  });

  it("leaves the commit carrier as it was", () => {
    expect(carrierScript("commit")).not.toContain("--push-refs");
    expect(carrierScript("commit")).not.toContain(PUSH_STDIN_USED);
    expect(runnerArguments("commit", { [PUSH_STDIN_USED]: "1" })).toBe(
      "scripts/lisa-run-gates.mjs --moment=commit --builtins=none origin an address"
    );
  });

  it("calls the commit carrier with the hook's own standard input", () => {
    expect(carrierStartLine("commit")).toBe(
      'sh "$lisa_carrier" "$@" || exit $?'
    );
  });

  it("calls the push carrier with no standard input, and says some may be gone", () => {
    expect(carrierStartLine("push")).toBe(
      `${PUSH_STDIN_USED}=1 sh "$lisa_carrier" "$@" </dev/null || exit $?`
    );
  });
});

describe("a marked block in a file the repository owns", () => {
  const body = carrierCall("commit");
  const { begin, end } = carrierMarkers("commit");

  it("is added after what the file already holds, which stays as it was", () => {
    const edit = done(withMarkedBlock(HOST_HOOK, "commit", body));

    expect(edit.state).toBe("added");
    expect(edit.text.startsWith(`${HOST_HOOK}\n${begin}\n`)).toBe(true);
    expect(edit.text.endsWith(`${end}\n`)).toBe(true);
  });

  it("is added to a file whose last line has no line break", () => {
    const edit = done(withMarkedBlock("#!/bin/sh\necho host", "commit", body));

    expect(edit.text.startsWith("#!/bin/sh\necho host\n\n")).toBe(true);
  });

  it("is left alone when it is already what would be written", () => {
    const first = done(withMarkedBlock(HOST_HOOK, "commit", body));
    const second = done(withMarkedBlock(first.text, "commit", body));

    expect(second.state).toBe("present");
    expect(second.text).toBe(first.text);
  });

  it("is replaced in place, keeping the lines above and below it", () => {
    const first = done(withMarkedBlock(HOST_HOOK, "commit", ["old line"]));
    const grown = `${first.text}echo added later\n`;

    const edit = done(withMarkedBlock(grown, "commit", body));

    expect(edit.state).toBe("replaced");
    expect(edit.text).toBe(
      `${HOST_HOOK}\n${[begin, ...body, end].join("\n")}\necho added later\n`
    );
  });

  it("keeps the indentation its begin marker was written with", () => {
    const edit = done(
      withMarkedBlock(`key:\n  ${begin}\n  old\n  ${end}\n`, "commit", ["new"])
    );

    expect(edit.text).toBe(`key:\n  ${begin}\n  new\n  ${end}\n`);
  });

  it("is refused when a marker is missing or written twice", () => {
    const half = withMarkedBlock(`${HOST_HOOK}${begin}\n`, "commit", body);
    const twice = findMarkedBlock([begin, end, begin, end], "commit");

    expect(half.problem).toMatch(/do not appear exactly once each/u);
    expect(twice.problem).toMatch(/do not appear exactly once each/u);
  });

  it("does not mistake another block's markers for its own", () => {
    const push = done(withMarkedBlock(HOST_HOOK, "push", carrierCall("push")));

    const edit = done(withMarkedBlock(push.text, "commit", body));

    expect(edit.state).toBe("added");
    expect(edit.text).toContain(carrierMarkers("push").begin);
  });
});
