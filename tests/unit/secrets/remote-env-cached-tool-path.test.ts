/**
 * Cached remote sessions start in a new hook process, so PATH does not retain
 * the toolchain runner's prior in-process prepend. The committed entrypoint
 * must restore the install directory before probing or exact pins are fetched
 * again on every session.
 * @module tests/unit/secrets/remote-env-cached-tool-path
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const roots: string[] = [];
const entrypoint =
  "plugins/src/base/skills/lisa-setup-remote-env/assets/setup.sh";
const runner =
  "node_modules/@codyswann/lisa/plugins/lisa/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("cached remote tool discovery", () => {
  it("prepends the user-local install directory before invoking the runner", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-cached-tool-path-"));
    const home = path.join(root, "home");
    const script = path.join(root, "setup.sh");
    const resolvedRunner = path.join(root, runner);
    const inheritedPath = process.env.PATH ?? "/usr/bin:/bin";
    const localBin = path.join(home, ".local", "bin");
    const untrustedNode = path.join(localBin, "node");
    roots.push(root);
    mkdirSync(path.dirname(resolvedRunner), { recursive: true });
    mkdirSync(localBin, { recursive: true });
    writeFileSync(script, readFileSync(entrypoint, "utf8"));
    writeFileSync(resolvedRunner, "console.log(process.env.PATH);\n");
    writeFileSync(untrustedNode, "#!/usr/bin/env bash\nexit 99\n");
    chmodSync(untrustedNode, 0o755);

    const result = boundedSpawnSync({
      label: "the cached remote entrypoint PATH fixture",
      command: "/bin/bash",
      args: [script],
      cwd: root,
      env: { ...process.env, HOME: home, LISA_SKIP_INSTALL: "1" },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `${localBin}${path.delimiter}${inheritedPath}`
    );
  });
});
