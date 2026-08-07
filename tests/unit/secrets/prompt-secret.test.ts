/**
 * Asking for a credential without leaving a copy of it anywhere.
 * @module tests/unit/secrets/prompt-secret
 */

import { describe, expect, it } from "vitest";

import {
  canPrompt,
  promptSecret,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/prompt-secret.mjs";

/** A stand-in for the credential. */
const TYPED = "stand-in-not-a-credential\n";

/**
 * Injected seams that record what the prompt did.
 * @param typed What the operator types.
 * @returns The io object and the log it fills.
 */
function harness(typed = TYPED): {
  io: Record<string, unknown>;
  stty: string[];
  written: string[];
  closed: number[];
} {
  const stty: string[] = [];
  const written: string[] = [];
  const closed: number[] = [];
  return {
    stty,
    written,
    closed,
    io: {
      open: () => 7,
      close: (fd: number) => closed.push(fd),
      write: (_fd: number, text: string) => written.push(text),
      run: (_cmd: string, args: string[]) => stty.push(args[0]),
      read: (_fd: number, buffer: Buffer) => buffer.write(typed),
    },
  };
}

describe("canPrompt", () => {
  it("is false without a terminal, so an automated caller SKIPS", () => {
    // A setup script blocked forever on a read nobody will answer is worse
    // than one that says what it could not do — the first looks like a slow
    // install.
    expect(canPrompt({ isTTY: false })).toBe(false);
    expect(canPrompt({ isTTY: true })).toBe(true);
  });
});

describe("promptSecret", () => {
  it("returns what was typed, trimmed", () => {
    const { io } = harness();

    expect(promptSecret("token: ", io)).toBe("stand-in-not-a-credential");
  });

  it("disables echo before reading and restores it after", () => {
    // Order matters: echo off after the read would have shown the credential,
    // and the terminal keeps whatever state it was left in.
    const { io, stty } = harness();

    promptSecret("token: ", io);

    expect(stty).toEqual(["-echo", "echo"]);
  });

  it("restores echo even when the read throws", () => {
    // Otherwise the operator's terminal silently stops echoing anything they
    // type afterwards, with no clue why.
    const { io, stty } = harness();

    expect(() =>
      promptSecret("token: ", {
        ...io,
        read: () => {
          throw new Error("interrupted");
        },
      })
    ).toThrow();
    expect(stty).toEqual(["-echo", "echo"]);
  });

  it("reads the TTY directly, not stdin", () => {
    // Piped stdin is how an automated caller would accidentally feed it
    // something; /dev/tty is the operator or nothing.
    let opened = "";
    const { io } = harness();

    promptSecret("token: ", { ...io, open: (p: string) => ((opened = p), 7) });

    expect(opened).toBe("/dev/tty");
  });

  it("closes the TTY even when the read throws", () => {
    const { io, closed } = harness();

    expect(() =>
      promptSecret("token: ", {
        ...io,
        read: () => {
          throw new Error("interrupted");
        },
      })
    ).toThrow();
    expect(closed).toEqual([7]);
  });

  it("prints a newline the operator's return could not echo", () => {
    const { io, written } = harness();

    promptSecret("token: ", io);

    expect(written).toEqual(["token: ", "\n"]);
  });
});
