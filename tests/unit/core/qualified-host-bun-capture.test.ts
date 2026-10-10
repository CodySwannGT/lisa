/** Exercise actual CI capture across genuine setup-bun executable replacement. */
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
} from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { parse } from "yaml";
import { expect, it } from "vitest";
import {
  boundedExecFileSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";
import { qualifiedHostBun } from "../../support/qualified-host-bun.js";

const ROOT = path.resolve(import.meta.dirname, "../../..");
useIoLatencyBudget();

/**
 * Extract the commands the required workflows will actually execute.
 * @returns Equal native capture commands in all three required CI consumers
 */
function captureCommand(): string {
  const entries = [
    [".github/workflows/quality.yml", "test_unit"],
    [".github/workflows/quality.yml", "test_integration"],
    [".github/workflows/plugins-sync.yml", "plugins-sync"],
  ];
  const commands = entries.map(([file, job]) => {
    const workflow = parse(readFileSync(path.join(ROOT, file!), "utf8"));
    const command = workflow.jobs[job!].steps.find((step: { run?: string }) =>
      step.run?.includes("LISA_TEST_HOST_BUN=")
    )?.run as string | undefined;
    expect(command).toBeDefined();
    return command!;
  });
  expect(new Set(commands).size).toBe(1);
  return commands[0]!;
}

/**
 * Observe a genuine Bun executable through a bounded child process.
 * @param executable - Actual runtime selected by an absolute path or PATH
 * @param env - Explicit native observation environment
 * @returns Runtime version and executable path observed by the executable itself
 */
function observeBun(executable: string, env: NodeJS.ProcessEnv = process.env) {
  return JSON.parse(
    boundedExecFileSync({
      label: "observe actual CI Bun",
      command: executable,
      args: [
        "-e",
        "console.log(JSON.stringify({version:Bun.version,path:require('node:fs').realpathSync(process.execPath)}))",
      ],
      env,
    })
  ) as { version: string; path: string };
}

/**
 * Execute the real workflow command against an owned shared runtime path.
 * @param shared - Disposable single-path setup destination
 * @param command - Actual workflow command
 * @param env - Owned workflow environment
 * @param native - Genuine native source executable
 * @returns Saved native executable from the workflow's actual export
 */
function captureSharedBun(
  shared: string,
  command: string,
  env: NodeJS.ProcessEnv,
  native: string
): string {
  mkdirSync(path.dirname(shared), { recursive: true });
  copyFileSync(native, shared);
  chmodSync(shared, 0o755);
  boundedExecFileSync({
    label: "execute actual CI native Bun capture",
    command: "bash",
    args: ["-c", command],
    cwd: path.dirname(shared),
    env,
  });
  return readFileSync(env["GITHUB_ENV"]!, "utf8")
    .trim()
    .replace(/^LISA_TEST_HOST_BUN=/, "");
}

/**
 * Repeat the pinned action's single-path replacement only in an owned fixture.
 * @param root - Disposable, owned test root
 * @param command - Actual parsed YAML capture command
 */
function verifyCapture(root: string, command: string): void {
  const native = qualifiedHostBun();
  const tooling = observeBun("bun");
  const shared = path.join(root, "shared-bin", "bun");
  const replacement = path.join(root, "replacement-bun");
  const environmentFile = path.join(root, "github-env");
  const env = {
    ...process.env,
    PATH: `${path.dirname(shared)}${path.delimiter}${process.env["PATH"] ?? ""}`,
    RUNNER_TEMP: path.join(root, "runner-temp"),
    GITHUB_ENV: environmentFile,
  };
  const sourceDigest = createHash("sha256")
    .update(readFileSync(native.path))
    .digest("hex");
  const saved = captureSharedBun(shared, command, env, native.path);
  expect(native.version).toBe("1.3.11");
  expect(tooling.version).toBe("1.3.8");
  copyFileSync(tooling.path, replacement);
  renameSync(replacement, shared);
  expect(observeBun(shared).version).toBe("1.3.8");
  expect(observeBun(saved).version).toBe("1.3.11");
  expect(createHash("sha256").update(readFileSync(saved)).digest("hex")).toBe(
    sourceDigest
  );
  expect(
    observeBun("bun", {
      ...env,
      PATH: `${path.dirname(saved)}${path.delimiter}${env.PATH}`,
    }).version
  ).toBe("1.3.11");
}

it("retains genuine native Bun after the shared setup path is replaced by tooling", async () => {
  const root = await createTempDir();
  try {
    verifyCapture(root, captureCommand());
  } finally {
    await cleanupTempDir(root);
  }
});
