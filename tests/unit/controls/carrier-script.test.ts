/**
 * The text of a carrier and of the call to it (CodySwannGT/lisa#4989).
 *
 * The carrier is read by operators and run by `sh` on machines Lisa knows
 * nothing about, so its text is held to what it must say and do: it is valid
 * POSIX shell, it asks for Node before anything else, it hands the hook's
 * arguments to the runner, and it sits between markers that let a later run
 * find it, replace it in place and leave everything else alone.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
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
  carrierCallLine,
  carrierMarkers,
  carrierScript,
  findMarkedBlock,
  PUSH_STDIN_USED,
  withMarkedBlock,
} from "../../../src/controls/carrier-script.js";
import {
  CARRIER_MOMENTS,
  type CarrierMoment,
} from "../../../src/controls/carrier-types.js";

const SH = "/bin/sh";
const HOST_HOOK = "#!/bin/sh\necho host check\n";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Ask `sh` whether a text is a script it can read, without running it.
 * @param script - The text
 * @returns What `sh -n` said; empty when the script is valid
 */
function syntaxErrors(script: string): string {
  const folder = mkdtempSync(path.join(tmpdir(), "lisa-carrier-script-"));
  const file = path.join(folder, "hook");
  cleanups.push(() => rmSync(folder, { force: true, recursive: true }));
  writeFileSync(file, script);
  return spawnSync(SH, ["-n", file], { encoding: "utf8" }).output.join("");
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

  it("is called from an existing hook only after that hook passed", () => {
    const call = carrierCall(moment);
    const commands = call.filter(line => !line.startsWith("#"));

    expect(commands).toEqual([
      "lisa_status=$?",
      '[ "$lisa_status" -eq 0 ] || exit "$lisa_status"',
      carrierCallLine(moment),
    ]);
    expect(syntaxErrors(`${call.join("\n")}\n`)).toBe("");
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
    cleanups.push(() => rmSync(folder, { force: true, recursive: true }));
    mkdirSync(path.join(folder, "scripts"));
    writeFileSync(path.join(folder, "scripts/lisa-run-gates.mjs"), "");
    writeFileSync(path.join(folder, "node"), '#!/bin/sh\necho "$@"\n');
    chmodSync(path.join(folder, "node"), 0o755);
    writeFileSync(path.join(folder, "hook"), carrierScript(moment));
    return spawnSync(SH, ["hook", "origin", "an address"], {
      cwd: folder,
      encoding: "utf8",
      env: { PATH: `${folder}:/usr/bin:/bin`, ...env },
      input: "",
    }).stdout.trim();
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
    expect(carrierCallLine("commit")).toBe(
      'sh .lisa/hooks/pre-commit "$@" || exit $?'
    );
  });

  it("calls the push carrier with no standard input, and says some may be gone", () => {
    expect(carrierCallLine("push")).toBe(
      `${PUSH_STDIN_USED}=1 sh .lisa/hooks/pre-push "$@" </dev/null || exit $?`
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
