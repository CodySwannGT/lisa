/** Real payload used by the lisa-test-run process lifecycle regression. */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

import "../../../src/configs/vitest/scratch-setup.js";

const marker = process.env["LISA_TEST_RUN_MARKER"];
if (marker === undefined) throw new Error("fixture marker is required");

const mode = process.env["LISA_TEST_RUN_MODE"] ?? "pass";
const descendant = mode.startsWith("grandchild-")
  ? spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], {
      stdio: "ignore",
    })
  : undefined;
descendant?.unref();

if (mode === "ignore-signals") {
  process.removeAllListeners("SIGINT");
  process.removeAllListeners("SIGTERM");
  process.on("SIGINT", () => undefined);
  process.on("SIGTERM", () => undefined);
  setInterval(() => undefined, 1_000);
}

fs.writeFileSync(
  marker,
  JSON.stringify({
    pid: process.pid,
    root: tmpdir(),
    opaque: process.env["LISA_TEST_RUN_OPAQUE_CONTROL"],
    descendantPid: descendant?.pid,
  }),
  "utf8"
);

if (mode === "fail") process.exitCode = 23;
if (mode === "wait") setInterval(() => undefined, 1_000);
if (mode === "grandchild-pass") setTimeout(() => process.exit(0), 500);
if (mode === "grandchild-fail") setTimeout(() => process.exit(23), 500);
if (mode === "grandchild-sigkill") {
  setTimeout(() => process.kill(process.pid, "SIGKILL"), 500);
}
