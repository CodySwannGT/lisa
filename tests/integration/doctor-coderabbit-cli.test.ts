/** Built CLI regression for hosted and project-supplied local review policy. */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { readDoctorJson } from "./doctor-nightly-e2e-guard-cli-helper.js";

const execute = promisify(execFile);
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * Observe the actual CLI with a genuinely absent executable in an owned PATH.
 * Other doctor findings may legitimately fail this deliberately minimal host.
 * @param gates - Complete configured gates block
 * @returns The named CodeRabbit row emitted by the built doctor process
 */
async function doctorCodeRabbit(gates: unknown): Promise<{
  readonly status: string;
  readonly detail: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lisa-coderabbit-cli-"));
  try {
    const emptyBin = path.join(root, "empty-bin");
    await mkdir(emptyBin);
    await writeFile(
      path.join(root, ".lisa.config.json"),
      JSON.stringify({ gates })
    );
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        private: true,
        scripts: { "review:local": "coderabbit review --plain" },
      })
    );
    const stdout = await readDoctorJson(async () =>
      execute(
        process.execPath,
        ["dist/index.js", "doctor", root, "--offline", "--json"],
        {
          cwd: REPOSITORY_ROOT,
          env: { ...process.env, PATH: emptyBin },
          timeout: 20_000,
        }
      ).then(
        result => ({
          ...result,
          code: 0,
          signal: null,
          killed: false,
        }),
        (error: {
          stdout?: string;
          stderr?: string;
          code?: string | number;
          signal?: string;
          killed?: boolean;
        }) => ({
          stdout: error.stdout ?? "",
          stderr: error.stderr ?? "",
          code: error.code ?? null,
          signal: error.signal ?? null,
          killed: error.killed ?? false,
        })
      )
    );
    const payload = JSON.parse(stdout) as {
      readonly checks: readonly {
        readonly name: string;
        readonly status: string;
        readonly detail: string;
      }[];
    };
    const finding = payload.checks.find(
      check => check.name === "CodeRabbit CLI ready?"
    );
    if (!finding) throw new Error("built doctor omitted the CodeRabbit row");
    return finding;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("built doctor CodeRabbit CLI scope", () => {
  it("accepts hosted review without a local CodeRabbit executable", async () => {
    const check = await doctorCodeRabbit({
      "code-review": {
        "pull-request": { level: "required", await: "CodeRabbit" },
      },
    });
    expect(check.status).toBe("ok");
    expect(check.detail).toContain("hosted check run");
    expect(check.detail).toContain("optional");
  });

  it("names the required local run task's gate and moment when its CLI is absent", async () => {
    const check = await doctorCodeRabbit({
      "code-review": {
        needs: { tools: ["coderabbit"] },
        push: { level: "required", run: "review:local" },
      },
    });
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("code-review at push");
    expect(check.detail).toContain("CLI is unavailable");
  });

  it("keeps an optional local run task advisory when its CLI is absent", async () => {
    const check = await doctorCodeRabbit({
      "code-review": {
        needs: { tools: ["coderabbit"] },
        push: { level: "optional", run: "review:local" },
      },
    });
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("code-review at push");
  });
});
