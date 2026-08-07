/**
 * Writing the bootstrap, which every operator was doing by hand.
 *
 * Reading it already existed; storing it did not, so the documented step was a
 * platform-specific `security add-generic-password` typed at a shell — a
 * command with a credential in it, on the one value whose compromise costs
 * every other secret.
 * @module tests/unit/secrets/bootstrap-store
 */

import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  bootstrapFile,
  clearBootstrap,
  readBootstrapFile,
  storeBootstrap,
  storeKind,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/bootstrap-store.mjs";

/** A stand-in for the credential, so no real one appears in the repo. */
const TOKEN = "stand-in-not-a-credential";

let home: string;
let env: Record<string, string>;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "lisa-store-"));
  env = {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    USER: "who",
  };
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("which store a platform uses", () => {
  it("is the keychain on macOS", () => {
    expect(storeKind("darwin")).toBe("keychain");
  });

  it("is a file everywhere else", () => {
    // libsecret needs a running daemon and a desktop session, which a server or
    // a container does not have — so it cannot be assumed present.
    expect(storeKind("linux")).toBe("file");
    expect(storeKind("win32")).toBe("file");
  });
});

describe("the key, which becomes a path segment", () => {
  it.each(["../escape", "a/b", "..", "", "has space"])("refuses %j", bad => {
    // Store, clear and read all join the key onto a directory, so a `/` or a
    // `..` lets a crafted key write, delete, or read an arbitrary file as the
    // operator. Validated in bootstrapFile, which all three route through.
    expect(() => bootstrapFile(bad, env)).toThrow(/one safe path segment/);
  });

  it("accepts the shape a variable name actually has", () => {
    expect(() => bootstrapFile("BWS_ACCESS_TOKEN_tunnl", env)).not.toThrow();
  });

  it("refuses it on the keychain path too, which builds no path", () => {
    // That path never touches the filesystem, so the guard has to be explicit
    // rather than inherited from bootstrapFile.
    expect(() =>
      storeBootstrap("../escape", TOKEN, {
        kind: "keychain",
        env,
        run: () => "",
      })
    ).toThrow(/one safe path segment/);
  });
});

describe("the file store", () => {
  it("round-trips through the reader the resolver uses", () => {
    storeBootstrap("BWS_ACCESS_TOKEN_acme", TOKEN, { kind: "file", env });

    expect(readBootstrapFile("BWS_ACCESS_TOKEN_acme", env)).toBe(TOKEN);
  });

  it("is 0600, never briefly wider", () => {
    // Written and chmodded as a temporary, then renamed: `mode` on write only
    // applies when the file is CREATED, so an existing temporary from a crashed
    // run would otherwise keep its old permissions.
    storeBootstrap("K", TOKEN, { kind: "file", env });

    const mode = statSync(bootstrapFile("K", env)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("overwrites on a second store, because rotation is the common case", () => {
    storeBootstrap("K", "old", { kind: "file", env });
    storeBootstrap("K", TOKEN, { kind: "file", env });

    expect(readBootstrapFile("K", env)).toBe(TOKEN);
  });

  it("leaves no temporary behind", () => {
    storeBootstrap("K", TOKEN, { kind: "file", env });

    expect(() => statSync(`${bootstrapFile("K", env)}.tmp`)).toThrow();
  });

  it("reads as empty when nothing was stored", () => {
    // Absence is a supported state: it means "try the next source".
    expect(readBootstrapFile("NEVER_SET", env)).toBe("");
  });

  it("clears, so a rotation can be proven rather than assumed", () => {
    storeBootstrap("K", TOKEN, { kind: "file", env });
    clearBootstrap("K", { kind: "file", env });

    expect(readBootstrapFile("K", env)).toBe("");
  });

  it("writes under XDG_CONFIG_HOME, beside the other materialized state", () => {
    expect(bootstrapFile("K", env)).toBe(
      path.join(home, ".config", "lisa", "bootstrap", "K")
    );
  });
});

describe("the keychain store", () => {
  /**
   * Capture the one call `storeBootstrap` makes.
   * @returns The recorded argv and options.
   */
  function record(): {
    calls: { args: readonly string[]; options: { input?: string } }[];
    run: (
      cmd: string,
      args: readonly string[],
      options: { input?: string }
    ) => string;
  } {
    const calls: { args: readonly string[]; options: { input?: string } }[] =
      [];
    return {
      calls,
      run: (_cmd, args, options) => {
        calls.push({ args, options });
        return "";
      },
    };
  }

  it("passes the value on STDIN, never as an argument", () => {
    // An argument is visible in `ps` to every process running as this user for
    // as long as the call lasts. `security -i` reads a command STREAM on stdin,
    // so argv is just the flag.
    const { calls, run } = record();

    storeBootstrap("K", TOKEN, { kind: "keychain", env, run });

    expect(calls[0].args).toEqual(["-i"]);
    expect(calls[0].options.input).toContain(TOKEN);
    expect(calls[0].args.join(" ")).not.toContain(TOKEN);
  });

  it("updates in place, because rotation is the common case", () => {
    // Without -U a second run fails with "already exists", which would make
    // rotation the broken path.
    const { calls, run } = record();

    storeBootstrap("K", TOKEN, { kind: "keychain", env, run });

    expect(calls[0].options.input).toContain("-U");
  });

  it("quotes the value, so a space cannot truncate it", () => {
    // `security -i` tokenizes its stdin like a shell. Unquoted, a value with a
    // space would parse as two arguments and store only the first part.
    const { calls, run } = record();

    storeBootstrap("K", 'two words and a "quote"', {
      kind: "keychain",
      env,
      run,
    });

    expect(calls[0].options.input).toContain(
      '-w "two words and a \\"quote\\""'
    );
  });

  it("refuses a newline rather than storing half a credential", () => {
    // A newline terminates the command line, and no quoting survives it.
    expect(() =>
      storeBootstrap("K", "before\nafter", {
        kind: "keychain",
        env,
        run: () => "",
      })
    ).toThrow(/newline/);
  });

  it("treats a failed delete as success, since absent is the goal", () => {
    expect(() =>
      clearBootstrap("K", {
        kind: "keychain",
        env,
        run: () => {
          throw new Error("The specified item could not be found");
        },
      })
    ).not.toThrow();
  });
});
