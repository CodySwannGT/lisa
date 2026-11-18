/**
 * @file resolve-executable.test.ts
 * @description Pins how Lisa resolves user-installed tools before spawning
 * them: absolute PATH directories only, first executable match wins, a miss is
 * a not-found result (never the bare name), Windows never picks an
 * extensionless file, and a Windows batch file runs through an absolute
 * cmd.exe with every argument escaped.
 * @module utils
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import {
  ExecutableNotFoundError,
  escapeBatchArgument,
  requireExecutable,
  resolveExecutable,
  spawnTarget,
} from "../../../src/utils/resolve-executable.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const roots: string[] = [];
const TOOL = "tool";
const LINUX = "linux";
const WINDOWS = "win32";

/**
 * Creates a fresh temporary directory, removed after each test.
 * @returns The directory path
 */
function freshDir(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-resolve-exe-"));
  roots.push(root);
  return root;
}

/**
 * Creates a directory holding the named files, each optionally executable.
 * @param names - File names to create
 * @param mode - Permission bits for every file
 * @returns The directory that holds the files
 */
function dirWith(names: readonly string[], mode = 0o755): string {
  const root = freshDir();
  for (const name of names) {
    const file = path.join(root, name);
    writeFileSync(file, "#!/bin/sh\necho planted\n");
    chmodSync(file, mode);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("resolveExecutable", () => {
  it("returns the first executable match from an absolute PATH directory", () => {
    const first = dirWith([TOOL]);
    const second = dirWith([TOOL]);
    const environment = { PATH: [first, second].join(path.delimiter) };
    expect(resolveExecutable(TOOL, { environment, platform: LINUX })).toEqual({
      found: true,
      path: path.join(first, TOOL),
    });
  });

  it("skips relative and empty PATH entries so a checked-in file cannot shadow the tool", () => {
    const real = dirWith([TOOL]);
    const environment = { PATH: [".", "", "bin", real].join(path.delimiter) };
    expect(resolveExecutable(TOOL, { environment, platform: LINUX })).toEqual({
      found: true,
      path: path.join(real, TOOL),
    });
  });

  it("skips files without the execute bit and directories with the tool's name", () => {
    const plain = dirWith([TOOL], 0o644);
    const shadowDir = freshDir();
    const real = dirWith([TOOL]);
    mkdirSync(path.join(shadowDir, TOOL));
    const environment = {
      PATH: [plain, shadowDir, real].join(path.delimiter),
    };
    expect(resolveExecutable(TOOL, { environment, platform: LINUX })).toEqual({
      found: true,
      path: path.join(real, TOOL),
    });
  });

  it("reports not found, never the bare name, and lists the directories searched", () => {
    const other = dirWith(["other"]);
    const environment = { PATH: [".", other].join(path.delimiter) };
    expect(resolveExecutable(TOOL, { environment, platform: LINUX })).toEqual({
      found: false,
      command: TOOL,
      searched: [other],
    });
  });

  it("never picks an extensionless file on Windows, even next to a .cmd", () => {
    // npm installs a POSIX script `claude` beside `claude.cmd`; only the
    // latter runs on Windows.
    const root = dirWith([TOOL, `${TOOL}.CMD`]);
    const environment = { Path: root, PATHEXT: ".EXE;.CMD" };
    expect(resolveExecutable(TOOL, { environment, platform: WINDOWS })).toEqual(
      {
        found: true,
        path: path.join(root, `${TOOL}.CMD`),
      }
    );
  });

  it("reports an extensionless-only Windows install as not found", () => {
    const root = dirWith([TOOL]);
    const environment = { Path: root, PATHEXT: ".EXE;.CMD" };
    expect(
      resolveExecutable(TOOL, { environment, platform: WINDOWS }).found
    ).toBe(false);
  });

  it("uses the default Windows extensions when PATHEXT is unset", () => {
    const root = dirWith([`${TOOL}.EXE`]);
    expect(
      resolveExecutable(TOOL, {
        environment: { Path: root },
        platform: WINDOWS,
      })
    ).toEqual({ found: true, path: path.join(root, `${TOOL}.EXE`) });
  });
});

describe("requireExecutable", () => {
  it("throws an ENOENT error that names the tool and the directories searched", () => {
    const other = dirWith(["other"]);
    const context = { environment: { PATH: other }, platform: LINUX } as const;
    expect(() => requireExecutable(TOOL, context)).toThrow(
      `${TOOL} not found on PATH (searched 1 absolute directory; relative entries are never searched)`
    );
    expect(() => requireExecutable(TOOL, context)).toThrow(
      expect.objectContaining({ code: "ENOENT" })
    );
    expect(() => requireExecutable(TOOL, context)).toThrow(
      expect.objectContaining({ searched: [other] })
    );
    expect(() => requireExecutable(TOOL, context)).toThrow(
      ExecutableNotFoundError
    );
  });

  it("says so when no absolute directory is on PATH at all", () => {
    expect(() =>
      requireExecutable(TOOL, { environment: {}, platform: LINUX })
    ).toThrow(
      `${TOOL} not found on PATH (searched 0 absolute directories; relative entries are never searched)`
    );
  });
});

describe("a planted ./git in the repository is never run", () => {
  it("refuses to spawn when git is not installed, even with . on PATH", () => {
    const repo = dirWith(["git"]);
    const environment = { PATH: "." };
    const context = { environment, platform: LINUX } as const;
    // The relative entry would find the planted file from cwd=repo; the
    // resolver searches absolute directories only, so git is "not found".
    expect(resolveExecutable("git", context).found).toBe(false);
    expect(() => spawnTarget("git", ["status"], context)).toThrow(
      ExecutableNotFoundError
    );
    // Control: the bare name WOULD have run the planted file from that cwd.
    const bare = boundedSpawnSync({
      label: "bare-name git from a repository with . on PATH",
      command: "/bin/sh",
      args: ["-c", "git status"],
      cwd: repo,
      env: { PATH: "." },
    });
    expect(bare.stdout).toContain("planted");
  });
});

describe("spawnTarget", () => {
  it("spawns a resolved POSIX executable directly with the caller's argv", () => {
    const root = dirWith([TOOL]);
    const context = { environment: { PATH: root }, platform: LINUX } as const;
    expect(spawnTarget(TOOL, ["a b", "c"], context)).toEqual({
      file: path.join(root, TOOL),
      args: ["a b", "c"],
      windowsVerbatimArguments: false,
    });
  });

  it("runs a Windows .exe directly, without cmd.exe", () => {
    const root = dirWith([`${TOOL}.EXE`]);
    const context = {
      environment: { Path: root, PATHEXT: ".EXE;.CMD" },
      platform: WINDOWS,
    } as const;
    expect(spawnTarget(TOOL, ["x"], context)).toEqual({
      file: path.join(root, `${TOOL}.EXE`),
      args: ["x"],
      windowsVerbatimArguments: false,
    });
  });

  it("runs a Windows .cmd through an absolute cmd.exe with escaped arguments", () => {
    const root = dirWith([TOOL, `${TOOL}.cmd`]);
    const context = {
      environment: {
        Path: root,
        PATHEXT: ".EXE;.CMD",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
      },
      platform: WINDOWS,
    } as const;
    const target = spawnTarget(TOOL, ["plugin", "a&b"], context);
    expect(target.file).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(target.windowsVerbatimArguments).toBe(true);
    expect(target.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(target.args[3]).toContain(
      `${escapeBatchArgument("plugin")} ${escapeBatchArgument("a&b")}`
    );
  });

  it("falls back to SystemRoot's cmd.exe when ComSpec is not absolute", () => {
    const root = dirWith([`${TOOL}.bat`]);
    const context = {
      environment: { Path: root, ComSpec: "cmd.exe", SystemRoot: "D:\\Win" },
      platform: WINDOWS,
    } as const;
    expect(spawnTarget(TOOL, [], context).file).toBe(
      "D:\\Win\\System32\\cmd.exe"
    );
  });
});

describe("escapeBatchArgument", () => {
  it("quotes and double-escapes cmd metacharacters for a batch shim", () => {
    expect(escapeBatchArgument("a&b")).toBe('^^^"a^^^&b^^^"');
  });

  it("doubles backslashes before a quote and escapes the quote", () => {
    expect(escapeBatchArgument('x\\"y')).toBe('^^^"x\\\\\\^^^"y^^^"');
  });

  it("doubles trailing backslashes so the closing quote survives", () => {
    expect(escapeBatchArgument("dir\\")).toBe('^^^"dir\\\\^^^"');
  });

  it("escapes spaces and percent signs so nothing expands or splits", () => {
    expect(escapeBatchArgument("%PATH% x")).toBe('^^^"^^^%PATH^^^%^^^ x^^^"');
  });
});

/** Characters cmd.exe acts on when it meets them unescaped. */
const CMD_SPECIAL = new Set(["&", "|", "<", ">", "(", ")", "%", "!", '"']);

/**
 * One cmd.exe parsing pass: `^` escapes the next character, and any special
 * character met unescaped would be acted on (a pipe, a redirect, a group, a
 * variable expansion, a quote toggle), so the model refuses it.
 * @param text - Text cmd.exe reads
 * @returns The text after cmd.exe removes one level of escapes
 * @throws {Error} When a special character or a trailing `^` is unescaped
 */
function cmdPass(text: string): string {
  const end = [...text].reduce(
    (state, character) => {
      if (state.escaped) return { out: state.out + character, escaped: false };
      if (character === "^") return { out: state.out, escaped: true };
      if (CMD_SPECIAL.has(character)) {
        throw new Error(`cmd.exe would act on an unescaped ${character}`);
      }
      return { out: state.out + character, escaped: false };
    },
    { out: "", escaped: false }
  );
  if (end.escaped) throw new Error("cmd.exe line ends in a lone ^");
  return end.out;
}

/**
 * The MSVCRT rule a program uses to read one double-quoted argument.
 * @param quoted - The argument including its surrounding quotes
 * @returns The value the program receives
 */
function msvcrtArgument(quoted: string): string {
  const end = [...quoted].reduce(
    (state, character) => {
      if (character === "\\") {
        return { out: state.out, slashes: state.slashes + 1 };
      }
      const kept = "\\".repeat(
        character === '"' ? Math.floor(state.slashes / 2) : state.slashes
      );
      // An odd run escapes the quote; an even run leaves it a delimiter.
      const literal =
        character !== '"' || state.slashes % 2 === 1 ? character : "";
      return { out: state.out + kept + literal, slashes: 0 };
    },
    { out: "", slashes: 0 }
  );
  return end.out + "\\".repeat(end.slashes);
}

describe("escapeBatchArgument round trip", () => {
  it.each([
    "a&b",
    "a|b",
    "^",
    "100%",
    "%PATH%",
    "two words",
    'say "hi"',
    "C:\\dir with space\\",
    'x & y | z ^ %p% "q" end\\',
    "<in >out (group) !bang!",
    "",
  ])("survives both cmd passes and MSVCRT parsing unchanged: %j", value => {
    const escaped = escapeBatchArgument(value);
    // cmdPass throws if either pass meets a metacharacter unescaped.
    expect(msvcrtArgument(cmdPass(cmdPass(escaped)))).toBe(value);
  });

  it("pins the exact escaping for each metacharacter", () => {
    expect(escapeBatchArgument("a|b")).toBe('^^^"a^^^|b^^^"');
    expect(escapeBatchArgument("^")).toBe('^^^"^^^^^^^"');
    expect(escapeBatchArgument("100%")).toBe('^^^"100^^^%^^^"');
    expect(escapeBatchArgument("two words")).toBe('^^^"two^^^ words^^^"');
    expect(escapeBatchArgument("a<b")).toBe('^^^"a^^^<b^^^"');
    expect(escapeBatchArgument("a>b")).toBe('^^^"a^^^>b^^^"');
    expect(escapeBatchArgument("(a)")).toBe('^^^"^^^(a^^^)^^^"');
    expect(escapeBatchArgument("a!b")).toBe('^^^"a^^^!b^^^"');
  });
});
