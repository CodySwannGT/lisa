/** Real payload used by the lisa-test-run process lifecycle regression. */
import * as fs from "node:fs";
import { tmpdir } from "node:os";

import "../../../src/configs/vitest/scratch-setup.js";

const marker = process.env["LISA_TEST_RUN_MARKER"];
if (marker === undefined) throw new Error("fixture marker is required");

fs.writeFileSync(
  marker,
  JSON.stringify({
    pid: process.pid,
    root: tmpdir(),
    opaque: process.env["LISA_TEST_RUN_OPAQUE_CONTROL"],
  }),
  "utf8"
);

const mode = process.env["LISA_TEST_RUN_MODE"] ?? "pass";
if (mode === "fail") process.exitCode = 23;
if (mode === "wait") setInterval(() => undefined, 1_000);
