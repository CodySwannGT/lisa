/**
 * @file shell-command-line.test.ts
 * @description Pins the one deliberate shell invocation: an operator's whole
 * command line runs through an absolute shell exactly as `shell: true` would
 * run it, passed as a single argument and never assembled from parts.
 * @module utils
 */
import { describe, expect, it } from "vitest";

import { shellCommandLine } from "../../../src/utils/shell-command-line.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const LINE = "echo one && echo 'two three'";

describe("shellCommandLine", () => {
  it("runs a POSIX line through /bin/sh -c as one argument", () => {
    expect(
      shellCommandLine(LINE, { environment: {}, platform: "linux" })
    ).toEqual({
      file: "/bin/sh",
      args: ["-c", LINE],
      windowsVerbatimArguments: false,
    });
  });

  it("runs the line with the shell's own semantics, as shell: true did", () => {
    const target = shellCommandLine(LINE, {
      environment: {},
      platform: "darwin",
    });
    const run = boundedSpawnSync({
      label: "shell command line",
      command: target.file,
      args: [...target.args],
    });
    expect(run.stdout).toBe("one\ntwo three\n");
  });

  it("runs a Windows line through an absolute cmd.exe, verbatim", () => {
    expect(
      shellCommandLine(LINE, {
        environment: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
        platform: "win32",
      })
    ).toEqual({
      file: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", `"${LINE}"`],
      windowsVerbatimArguments: true,
    });
  });

  it("never looks cmd.exe up on PATH when ComSpec is relative", () => {
    expect(
      shellCommandLine(LINE, {
        environment: { ComSpec: "cmd.exe", SystemRoot: "D:\\Win" },
        platform: "win32",
      }).file
    ).toBe("D:\\Win\\System32\\cmd.exe");
  });
});
