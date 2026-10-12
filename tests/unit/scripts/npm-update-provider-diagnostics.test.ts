/** Synthetic pinned transport exercises native failures, never provider authorization. */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { GitHub } from "../../../all/copy-overwrite/scripts/lib/npm-update-github.mjs";
import { sha256 } from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";
import {
  publicFailure,
  withStage,
  withProviderOperation,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-invariants.mjs";
import {
  withPrivateRoot,
  runProcess,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";

const CANARY = "SECRET_PROVIDER_CANARY";
const REPOSITORY = "acme/widgets";
const COMMENT_PURPOSE = "issue-comments";
const HTTP_HINT = "http-reported=";

async function failedRequest(endpoint: string, method: string, stderr: string) {
  return withPrivateRoot(async root => {
    const command = join(root, "synthetic-gh");
    const bytes = `#!${process.execPath}\nprocess.stderr.write(${JSON.stringify(stderr)});process.exitCode=1;\n`;
    writeFileSync(command, bytes, { mode: 0o700 });
    let calls = 0;
    const execute = (
      executable: string,
      args: string[],
      options: Parameters<typeof runProcess>[2]
    ) => {
      calls++;
      expect(executable).toBe(command);
      expect(args).toEqual([
        "api",
        "--hostname",
        "github.com",
        "--method",
        method,
        endpoint,
        ...(method === "POST" ? ["--input", "-"] : []),
      ]);
      expect(options).toEqual({
        env: {
          PATH: "/usr/bin:/bin",
          GH_TOKEN: CANARY,
          GH_HOST: "github.com",
          HOME: "/nonexistent",
          GIT_TERMINAL_PROMPT: "0",
        },
        input: method === "POST" ? JSON.stringify({ body: CANARY }) : undefined,
        timeout: 30_000,
      });
      return runProcess(executable, args, options);
    };
    const api = new GitHub(
      {
        repository: REPOSITORY,
        ghExecutable: command,
        ghSha256: sha256(bytes),
      },
      CANARY,
      execute
    );
    const error = await withStage("cancel-checkpoint", () =>
      api.request(
        endpoint,
        method,
        method === "POST" ? { body: CANARY } : undefined
      )
    ).catch(value => value);
    expect(calls).toBe(1);
    expect(error.code).toBe(1);
    expect(error.nativeCompleted).toBe(true);
    for (const name of ["message", "stack", "stdout", "stderr"])
      Object.defineProperty(error, name, {
        get() {
          throw new Error(CANARY);
        },
      });
    const diagnostic = publicFailure(error);
    expect(diagnostic).toContain(
      "stage=cancel-checkpoint native=exit status=1"
    );
    expect(diagnostic).not.toContain(CANARY);
    expect(diagnostic).not.toContain(root);
    expect(diagnostic).not.toContain(REPOSITORY);
    expect(diagnostic).not.toContain("31415926");
    return diagnostic;
  });
}

describe("closed native provider diagnostics", () => {
  it.each([
    [`repos/${REPOSITORY}/issues/42/comments`, "POST", COMMENT_PURPOSE],
    [`repos/${REPOSITORY}/issues/comments/31415926`, "GET", "issue-comment"],
    [
      `repos/${REPOSITORY}/issues/42/comments?per_page=100&page=2`,
      "GET",
      COMMENT_PURPOSE,
    ],
    [`search/issues?q=${CANARY}`, "GET", "issue-search"],
    [
      `repos/${REPOSITORY}/collaborators/${CANARY}/permission`,
      "GET",
      "collaborator-permission",
    ],
    [`repos/${REPOSITORY}/${CANARY}`, "GET", "unclassified"],
  ])(
    "retains only the closed route for %s %s",
    async (endpoint, method, purpose) => {
      const result = await failedRequest(
        endpoint,
        method,
        `gh: ${CANARY} (HTTP 403)\n`
      );
      expect(result).toContain(`provider=${purpose} method=${method}`);
      expect(result).toContain(
        "http-reported=403 reports=child-reported-nonauthoritative"
      );
    }
  );

  it.each([
    `gh: ${CANARY} (HTTP 200)\n`,
    `gh: ${CANARY} (HTTP 999)\n`,
    `gh: ${CANARY} (HTTP 403)\n${CANARY}\n`,
    `\u001b[31mgh: ${CANARY} (HTTP 403)\n`,
    `gh: ${CANARY.repeat(20)} (HTTP 403)\n`,
    `gh: ${CANARY} (HTTP 403) trailing\n`,
    `gh: ${CANARY} (HTTP 429) (HTTP 403)\n`,
  ])("leaves malformed or excessive HTTP hints unclassified", async line => {
    expect(
      await failedRequest(`repos/${REPOSITORY}/issues/42/comments`, "GET", line)
    ).not.toContain(HTTP_HINT);
  });

  it("labels a frozen observed exception while preserving its exact identity", async () => {
    await withPrivateRoot(async (root, env) => {
      const native = await runProcess(
        process.execPath,
        ["-e", "process.exitCode=1"],
        { cwd: root, env }
      ).catch(value => value);
      Object.freeze(native);
      const observed = await withProviderOperation(
        COMMENT_PURPOSE,
        "GET",
        async () => {
          throw native;
        }
      ).catch(value => value);
      expect(observed).toBe(native);
      expect(publicFailure(observed)).toContain(
        "provider=issue-comments method=GET"
      );
      expect(publicFailure(observed)).not.toContain(HTTP_HINT);
    });
  });

  it("does not trust forged error properties or replace the original exception", async () => {
    const error = Object.create(null);
    for (const name of [
      "message",
      "stack",
      "stdout",
      "stderr",
      "provider",
      "native",
    ])
      Object.defineProperty(error, name, {
        get() {
          throw new Error(CANARY);
        },
      });
    const fixture = {
      policy: { repository: REPOSITORY, ghExecutable: CANARY },
      token: CANARY,
      execute: async () => {
        throw error;
      },
    };
    const observed = await Reflect.apply(GitHub.prototype.request, fixture, [
      `repos/${REPOSITORY}/issues/42/comments`,
      "GET",
    ]).catch(value => value);
    expect(observed).toBe(error);
    expect(publicFailure(error)).not.toContain("provider=");
    expect(publicFailure(error)).not.toContain(HTTP_HINT);
    expect(publicFailure(error)).not.toContain(CANARY);
  });
});
