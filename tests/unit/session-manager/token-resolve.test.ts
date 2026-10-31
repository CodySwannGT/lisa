/**
 * Contract tests for resolving the Telegram bot token at `start`
 * (CodySwannGT/lisa#4555, part 2), against an in-memory fake adapter, plus
 * the tmux `source-file -` launch that carries it.
 *
 * `start` reads the token once from the provider. A leftover plaintext
 * `.env` stops it with the exact `store-token` command that migrates it; a
 * missing or undeclared secret is a setup error (exit 2); a provider that is
 * unreachable, rate-limited or slow is a failure (exit 1) whose message says
 * nothing was started and to try again. The token is handed to tmux on stdin
 * only, never in argv, and never appears in a message.
 * @module tests/unit/session-manager/token-resolve
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildForegroundCommand,
  buildManagerLaunch,
  buildSourcedLaunch,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/launch.mjs";
import {
  classifyProviderFailure,
  resolveTelegramToken,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/token-store.mjs";
import {
  type FakeFailure,
  type FakeOptions,
  fakeSecrets,
} from "./support/fake-secrets.js";

const TOKEN = ["123456789", "SENTINEL-abcdefghijklmnopqrstuvwxyz_0123"].join(
  ":"
);
const NAME = "TELEGRAM_BOT_TOKEN_DEMO_MANAGER";
const FIX = "node '/s/session-manager.mjs' store-token --project-root '/p'";
const STORED = [{ key: NAME, id: "id-1", value: TOKEN, projectId: "p" }];

let base = "";
let stateDir = "";

beforeEach(() => {
  base = mkdtempSync(path.join(tmpdir(), "sm-tokres-"));
  stateDir = path.join(base, "telegram-demo");
  mkdirSync(stateDir, { recursive: true });
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/**
 * Resolve with a fake adapter, capturing a thrown error.
 * @param options - Fake vault options
 * @returns The token or the error, and the fake's call log
 */
async function resolve(options: FakeOptions = {}) {
  const fake = fakeSecrets({ rows: STORED, ...options });
  try {
    const token = await resolveTelegramToken({
      cfg: fake.cfg,
      adapter: fake.adapter,
      name: NAME,
      stateDir,
      fixCommand: FIX,
    });
    return { token, error: undefined, calls: fake.calls };
  } catch (error) {
    return {
      token: undefined,
      error: error as Error & { exitCode?: number },
      calls: fake.calls,
    };
  }
}

describe("resolveTelegramToken", () => {
  it("returns the stored token after one provider read", async () => {
    const { token, calls } = await resolve();
    expect(token).toBe(TOKEN);
    expect(calls.filter(call => call === "list")).toHaveLength(1);
  });

  it("refuses (exit 2) a leftover plaintext .env, naming the migrating command", async () => {
    writeFileSync(path.join(stateDir, ".env"), `TELEGRAM_BOT_TOKEN=${TOKEN}\n`);
    const { error, calls } = await resolve();
    expect(error?.exitCode).toBe(2);
    expect(error?.message).toContain(FIX);
    expect(error?.message).not.toContain(TOKEN);
    expect(calls).toEqual([]);
  });

  it.each([
    ["an empty", ""],
    ["a comment-only", "# moved to the secrets provider\n\n"],
  ])(
    "starts past %s .env, which holds no token to migrate",
    async (_label, body) => {
      writeFileSync(path.join(stateDir, ".env"), body);
      const { token, error } = await resolve();
      expect(error).toBeUndefined();
      expect(token).toBe(TOKEN);
    }
  );

  it.each<[FakeFailure, RegExp]>([
    ["rate-limit", /rate-limited/],
    ["unavailable", /could not be reached/],
    ["timeout", /did not answer in time/],
  ])(
    "fails (exit 1) with retry guidance when the provider is %s",
    async (kind, reason) => {
      const { error } = await resolve({ listFails: kind });
      expect(error?.exitCode).toBe(1);
      expect(error?.message).toMatch(reason);
      expect(error?.message).toContain("Nothing was started");
      expect(error?.message).toContain("Wait a minute and run start again");
    }
  );

  it("refuses (exit 2) a secret the provider does not hold", async () => {
    const { error } = await resolve({ rows: [] });
    expect(error?.exitCode).toBe(2);
    expect(error?.message).toContain(NAME);
    expect(error?.message).toContain("store-token");
  });

  it("refuses (exit 2) a name secrets.require does not declare, before any read", async () => {
    const { error, calls } = await resolve({ require: ["ONLY_THIS"] });
    expect(error?.exitCode).toBe(2);
    expect(error?.message).toContain("secrets.require");
    expect(calls).toEqual([]);
  });

  it("refuses (exit 2) when the provider preflight fails", async () => {
    const { error } = await resolve({ preflightFails: true });
    expect(error?.exitCode).toBe(2);
    expect(error?.message).toContain("BWS_ACCESS_TOKEN_DEMO");
  });

  it("refuses (exit 2) a stored value that is not bot-token shaped, without echoing it", async () => {
    const rows = [{ key: NAME, id: "id-1", value: "garbage", projectId: "p" }];
    const { error } = await resolve({ rows });
    expect(error?.exitCode).toBe(2);
    expect(error?.message).not.toContain("garbage");
  });
});

describe("classifyProviderFailure", () => {
  it("reads rate limits, timeouts, missing CLIs and unsupported providers", () => {
    const err = (message: string, extra: object = {}) =>
      Object.assign(new Error(message), extra);
    expect(classifyProviderFailure(err("x", { stderr: "429" }))).toBe(
      "rate-limited"
    );
    expect(classifyProviderFailure(err("Too Many Requests"))).toBe(
      "rate-limited"
    );
    expect(classifyProviderFailure(err("x", { code: "ETIMEDOUT" }))).toBe(
      "timed-out"
    );
    expect(
      classifyProviderFailure(err("Lisa stopped it at its own deadline"))
    ).toBe("timed-out");
    expect(classifyProviderFailure(err("x", { code: "ENOENT" }))).toBe(
      "missing-cli"
    );
    expect(
      classifyProviderFailure(
        err('provider "vault" has no bulk read implemented')
      )
    ).toBe("unsupported");
    expect(classifyProviderFailure(err("anything else"))).toBe("unavailable");
  });
});

const LAUNCH = {
  name: "demo-manager",
  root: "/work/demo",
  stateDir: "/home/u/.claude/channels/telegram-demo",
  scriptsDir: "/s",
  interval: "5m",
  notify: "telegram",
};

describe("buildSourcedLaunch", () => {
  it("moves the new-session line to stdin and adds the token there only", () => {
    const launch = buildSourcedLaunch(buildManagerLaunch(LAUNCH), {
      TELEGRAM_BOT_TOKEN: TOKEN,
    });
    expect(launch.argv).toEqual(["start-server", ";", "source-file", "-"]);
    expect(launch.argv.join(" ")).not.toContain(TOKEN);
    expect(launch.input.endsWith("\n")).toBe(true);
    expect(launch.input.split("\n")).toHaveLength(2);
    expect(launch.input).toContain(`'TELEGRAM_BOT_TOKEN=${TOKEN}'`);
    expect(launch.input.indexOf("TELEGRAM_BOT_TOKEN")).toBeLessThan(
      launch.input.indexOf("'claude'")
    );
    expect(launch.input.startsWith("'new-session' '-d'")).toBe(true);
  });

  it("quotes a single quote the way tmux reads it back", () => {
    const launch = buildSourcedLaunch(
      buildManagerLaunch({ ...LAUNCH, root: "/work/it's" }),
      {}
    );
    expect(launch.input).toContain(`'/work/it'"'"'s'`);
  });

  it("refuses a value with a newline, which would end the tmux command", () => {
    expect(() =>
      buildSourcedLaunch(buildManagerLaunch(LAUNCH), { X: "a\nb" })
    ).toThrow(/newline/);
  });
});

describe("buildForegroundCommand with a provider token", () => {
  it("resolves the token in the operator's shell instead of printing it", () => {
    const line = buildForegroundCommand(buildManagerLaunch(LAUNCH), {
      TELEGRAM_BOT_TOKEN: `$(node '/r/resolve-secret.mjs' get ${NAME})`,
    });
    expect(line).toContain(
      `TELEGRAM_BOT_TOKEN="$(node '/r/resolve-secret.mjs' get ${NAME})"`
    );
    expect(line).not.toContain(TOKEN);
  });
});
