/** The program arguments and failure output stay clear of Bitwarden write data. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSecret,
  writeSecret,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/providers.mjs";

const transports = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock(
  "../../../plugins/src/base/skills/lisa-setup-workstation/scripts/bounded-child.mjs",
  async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    boundedChildOutput: transports.run,
  })
);

const VALUE = ["example", "synthetic\n☀"].join(":");
const TOKEN = "fixture-bootstrap";
const ID = "4ef1d174-d9c7-4ac3-beb3-3a43abbbdc99";
const CONFIG = {
  provider: "bitwarden",
  bootstrap: { sources: ["env"], key: "BWS_ACCESS_TOKEN_DEMO" },
};
const secret = { name: "EXAMPLE", value: VALUE, projectId: ID, note: "Usage" };
const create = () => createSecret(CONFIG, secret);
const replace = () => writeSecret(CONFIG, ID, VALUE);

beforeEach(() => {
  transports.run.mockReset();
  vi.stubEnv("BWS_ACCESS_TOKEN_DEMO", TOKEN);
  vi.stubEnv("BWS_ACCESS_TOKEN", "another-account");
  vi.stubEnv("BWS_ACCESS_TOKEN_SECOND", "unrelated-account");
  vi.stubEnv("OTHER_SECRET", "unrelated-secret");
  vi.stubEnv("NODE_OPTIONS", "--trace-warnings");
  vi.stubEnv("BWS_PROFILE", "alternate");
});

afterEach(() => vi.unstubAllEnvs());

describe("Bitwarden secret writes", () => {
  it.each([
    {
      label: "create",
      write: create,
      request: { operation: "create", ...secret },
    },
    {
      label: "replace",
      write: replace,
      request: { operation: "replace", id: ID, value: VALUE },
    },
  ])("sends $label data over stdin", ({ write, request }) => {
    write();

    expect(transports.run).toHaveBeenCalledTimes(1);
    const [executable, argv, options] = transports.run.mock.calls[0]!;
    expect(executable).toBe(process.execPath);
    expect(argv).toEqual([expect.stringMatching(/\/bitwarden-write\.mjs$/u)]);
    expect(JSON.stringify([executable, argv, options.env])).not.toContain(
      JSON.stringify(VALUE).slice(1, -1)
    );
    expect(JSON.stringify([executable, argv, options.env])).not.toContain(
      TOKEN
    );
    expect(options.env).toEqual(
      expect.objectContaining({ BWS_PROFILE: "alternate" })
    );
    expect(options.env).not.toHaveProperty("BWS_ACCESS_TOKEN_SECOND");
    expect(options.env).not.toHaveProperty("OTHER_SECRET");
    expect(options.env).not.toHaveProperty("NODE_OPTIONS");
    expect(options.stdio).toEqual(["pipe", "ignore", "pipe"]);
    expect(JSON.parse(options.input)).toEqual({
      ...request,
      accessToken: TOKEN,
    });
  });

  it.each([
    [82, /server and profile configuration/],
    [83, /provider refused the request/],
    [84, /readback did not verify/],
    [85, /429 Too Many Requests/],
  ])("reports exit %s without provider output", (status, expected) => {
    transports.run.mockImplementation(() => {
      throw Object.assign(new Error(VALUE), { status, stderr: TOKEN });
    });

    try {
      replace();
      expect.unreachable("write must reject a failed helper");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toMatch(expected);
      expect(String(error)).not.toContain(VALUE);
      expect(error).not.toHaveProperty("stderr");
      expect(error).not.toHaveProperty("cause");
    }
  });

  it("reports a bounded timeout without copying the transport request", () => {
    transports.run.mockImplementation(() => {
      throw Object.assign(new Error(VALUE), {
        code: "ETIMEDOUT",
        spawnargs: [VALUE],
        stdout: TOKEN,
      });
    });

    expect(create).toThrow(expect.objectContaining({ code: "ETIMEDOUT" }));
    expect(create).toThrow(/Check the provider state before retrying/);
  });

  it("rejects invalid names and providers without requesting a write", () => {
    expect(() => createSecret(CONFIG, { ...secret, name: "bad name" })).toThrow(
      /environment variable name/
    );
    expect(() =>
      createSecret({ ...CONFIG, provider: "doppler" }, secret)
    ).toThrow(/has no create implemented/);
    expect(() =>
      writeSecret({ ...CONFIG, provider: "doppler" }, ID, VALUE)
    ).toThrow(/has no write implemented/);
    expect(transports.run).not.toHaveBeenCalled();
  });
});
