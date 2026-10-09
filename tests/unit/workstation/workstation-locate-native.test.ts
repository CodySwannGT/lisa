/** Native presence probes must neither execute a tool nor interpolate its name. */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { locate } from "../../../plugins/src/base/skills/lisa-setup-workstation/scripts/workstation.mjs";
import {
  boundedExecFileSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

useIoLatencyBudget();

it("finds literal executable names without running them or expanding shell input", async () => {
  const root = await createTempDir();
  try {
    const bin = join(root, "bin");
    const invoked = join(root, "invoked");
    const injected = join(root, "injected");
    const name = "fixture tool";
    mkdirSync(bin);
    writeFileSync(join(bin, name), `#!/bin/sh\ntouch '${invoked}'\n`, {
      mode: 0o755,
    });
    const run = (command: string, args: string[]) =>
      boundedExecFileSync({
        label: "actual workstation executable presence probe",
        command,
        args,
        env: { PATH: `${bin}:/usr/bin:/bin` },
      });
    expect(locate(name, run)).toBe(join(bin, name));
    expect(existsSync(invoked)).toBe(false);
    expect(locate(`$(touch '${injected}')`, run)).toBeNull();
    expect(existsSync(injected)).toBe(false);
  } finally {
    await cleanupTempDir(root);
  }
});
