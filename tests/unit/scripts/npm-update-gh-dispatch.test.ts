/** Native process controls exercise the closed transport; response fixtures are not GitHub proof. */
import { describe, expect, it } from "vitest";
import {
  realpathSync,
  mkdtempSync,
  rmSync,
  chmodSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createGhDispatcher } from "../../../all/copy-overwrite/scripts/lib/npm-update-gh-dispatch.mjs";
import { binaryDigest } from "../../../all/copy-overwrite/scripts/lib/npm-update-isolation.mjs";

function fixture(
  operation: (dispatch: any, root: string, profile: any) => void
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lisa-gh-")));
  try {
    const executable = join(root, "fixture-provider");
    writeFileSync(
      executable,
      "#!/bin/sh\nprintf 'native-fixture\\n'\nprintf 'native-stderr\\n' >&2\nexit 7\n"
    );
    chmodSync(executable, 0o700);
    const profile = {
      version: 1,
      deadline: Date.now() + 5000,
      cwd: root,
      home: root,
      nativeGh: { path: executable, sha256: binaryDigest(executable) },
      invocation: {
        entry: join(root, "canonical-fixture.mjs"),
        args: [join(root, "canonical-fixture.mjs")],
        cwd: root,
      },
      subject: {
        phase: "stage-read",
        repository: "acme/widgets",
        tracker: "acme/widgets",
        issue: "42",
        branch: `lisa/npm-${"a".repeat(64)}`,
        parent: "b".repeat(40),
        origin: { runId: "91", runAttempt: "2" },
        claim: "123",
        recovery: null,
        maintainer: "maintainer",
        pr: null,
        proofs: [],
      },
    };
    operation(
      createGhDispatcher(profile, "synthetic-memory-only-test-token"),
      root,
      profile
    );
  } finally {
    rmSync(root, { recursive: true });
  }
}

describe("closed native GH dispatch", () => {
  it("returns the actual native nonzero result unchanged", () =>
    fixture((dispatch, root) => {
      const result = dispatch(
        "spawnSync",
        "gh",
        ["--version"],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 5000,
          maxBuffer: 65536,
          killSignal: "SIGKILL",
          env: {},
        },
        spawnSync
      );
      expect(result.status).toBe(7);
      expect(result.signal).toBeNull();
      expect(result.stdout).toBe("native-fixture\n");
      expect(result.stderr).toBe("native-stderr\n");
    }));
  it("refuses alternate methods, commands, options, directories and expired scopes before native dispatch", () =>
    fixture((dispatch, root, profile) => {
      let calls = 0;
      const mustNotExecute = () => {
        calls++;
        throw new Error("executed");
      };
      const options = { cwd: root, encoding: "utf8", timeout: 1000, env: {} };
      for (const [method, command, changed] of [
        ["spawn", "gh", options],
        ["spawnSync", "/unqualified/gh", options],
        ["spawnSync", "gh", { ...options, shell: true }],
        ["spawnSync", "gh", { ...options, cwd: "/" }],
        [
          "spawnSync",
          "gh",
          { ...options, env: { HTTPS_PROXY: "https://elsewhere" } },
        ],
      ])
        expect(() =>
          dispatch(method, command, ["--version"], changed, mustNotExecute)
        ).toThrow();
      profile.deadline = Date.now() - 1;
      expect(() => createGhDispatcher(profile, "synthetic")).toThrow();
      expect(calls).toBe(0);
    }));
  it("retains a genuine native capture failure rather than fabricating success", () =>
    fixture((dispatch, root) => {
      const result = dispatch(
        "spawnSync",
        "gh",
        ["--version"],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 1000,
          maxBuffer: 1,
          killSignal: "SIGKILL",
          env: {},
        },
        spawnSync
      );
      expect(result.error).toBeDefined();
      expect(result.status === 0).toBe(false);
    }));
});
