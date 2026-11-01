/**
 * Regression for CodySwannGT/lisa#4564 finding 5.
 *
 * `findCredentials` tested every key in the `sessionManager` block against the
 * credential key-name pattern, including the keys of `repos.entries`. Those
 * keys are child repository names, so a project with a repo called
 * `token-service` or `secrets-manager` got an `init-config --write` block that
 * `validate` then refused. Repo names are names; the values under them are
 * still walked for credentials.
 * @module tests/unit/session-manager/init-config-credential-named-repo
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateSessionManager } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/validate-config.mjs";
import { makeSandbox, removeSandboxes, runCli } from "./support/cli-harness.js";

afterEach(removeSandboxes);

const TOKEN_SERVICE = "token-service";
const SECRETS_MANAGER = "secrets-manager";
const CREDENTIAL_LIKE_REPOS = [
  TOKEN_SERVICE,
  SECRETS_MANAGER,
  "api-key-rotator",
  "password-reset",
  "credentials",
];

const base = {
  name: "repo-a-manager",
  notify: { provider: "telegram", stateDir: "~/.claude/channels/telegram-x" },
};

describe("repos.entries keys are repo names, not credential fields (#4564)", () => {
  it.each(CREDENTIAL_LIKE_REPOS)("accepts a repo named %s", name => {
    expect(
      validateSessionManager({
        ...base,
        repos: { root: "projects", entries: { [name]: { hints: [name] } } },
      })
    ).toEqual([]);
  });

  it("still refuses a credential-named field inside a repo entry", () => {
    const problems = validateSessionManager({
      ...base,
      repos: { entries: { [TOKEN_SERVICE]: { hints: ["x"], token: "x" } } },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(
      "sessionManager.repos.entries.token-service.token"
    );
  });

  it("still refuses a bot-token value inside a repo entry", () => {
    const token = `123456789:${"A".repeat(35)}`;
    const problems = validateSessionManager({
      ...base,
      repos: { entries: { [TOKEN_SERVICE]: { hints: [token] } } },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).not.toContain(token);
  });

  it("still refuses a credential-named key outside repos.entries", () => {
    const problems = validateSessionManager({
      ...base,
      repos: { entries: { api: { hints: ["x"] } }, apiKey: "x" },
    });
    expect(problems.some(p => p.includes("sessionManager.repos.apiKey"))).toBe(
      true
    );
  });

  it("init-config --write emits a block that validate accepts", () => {
    const sandbox = makeSandbox({
      sessionManager: null,
      repos: [TOKEN_SERVICE, SECRETS_MANAGER],
    });
    const written = runCli(sandbox, [
      "init-config",
      "--slug",
      "demo",
      "--write",
    ]);
    expect(written.status).toBe(0);
    expect(written.json.written).toBe(true);
    const config = JSON.parse(
      readFileSync(path.join(sandbox.root, ".lisa.config.json"), "utf8")
    );
    expect(
      Object.keys(config.sessionManager.repos.entries).toSorted((a, b) =>
        a.localeCompare(b)
      )
    ).toEqual([SECRETS_MANAGER, TOKEN_SERVICE]);
    expect(validateSessionManager(config.sessionManager)).toEqual([]);
  });
});
