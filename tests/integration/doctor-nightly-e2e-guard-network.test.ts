/**
 * @file doctor-nightly-e2e-guard-network.test.ts
 * @description Built-CLI bite proving doctor never gives an inspected target a network turn
 * @module tests/integration/doctor-nightly-e2e-guard-network.test
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../..");

let projectRoot = "";

afterEach(async () => {
  if (projectRoot !== "") {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

describe("built doctor nightly guard network boundary", () => {
  it("does not let an untrusted contract target POST to a local listener", async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lisa-network-bite-"));
    await mkdir(path.join(projectRoot, ".github", "workflows"), {
      recursive: true,
    });
    await mkdir(path.join(projectRoot, "scripts"));
    await writeFile(
      path.join(projectRoot, ".github", "workflows", "active.yml"),
      `
'on': [pull_request]
jobs:
  gate:
    runs-on: ubuntu-latest
    env:
      GATE_BYPASS: \${{ contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}
    steps:
      - run: node scripts/check-nightly-e2e-health.mjs
`
    );

    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.end("ok");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("local network bite listener did not expose a TCP port");
    }
    await writeFile(
      path.join(projectRoot, "scripts", "check-nightly-e2e-health.mjs"),
      `
import http from "node:http";
if (process.argv.includes("--contract-version")) {
  const request = http.request({ host: "127.0.0.1", port: ${address.port}, method: "POST" }, response => {
    response.resume();
    response.on("end", () => process.stdout.write("1.7.0\\n"));
  });
  request.on("error", () => process.stdout.write("1.7.0\\n"));
  request.end("doctor-must-not-send-this");
}
`
    );

    let stdout = "";
    try {
      const result = await execute(
        process.execPath,
        ["dist/index.js", "doctor", projectRoot, "--offline", "--json"],
        { cwd: REPOSITORY_ROOT, timeout: 20_000 }
      );
      stdout = result.stdout;
    } catch (error) {
      stdout = (error as { readonly stdout?: string }).stdout ?? "";
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(closeError =>
          closeError ? reject(closeError) : resolve()
        )
      );
    }

    const doctor = JSON.parse(stdout) as {
      readonly checks: readonly {
        readonly name: string;
        readonly status: string;
        readonly detail: string;
      }[];
    };
    expect(requests).toBe(0);
    expect(doctor.checks).toContainEqual(
      expect.objectContaining({
        name: "Nightly E2E bypass guard bounded?",
        status: "fail",
        detail: expect.stringMatching(/trusted|provenance|unavailable/u),
      })
    );
  });
});
