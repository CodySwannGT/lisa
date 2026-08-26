/** Standalone real-CDK process killed externally to prove successor reclaim. */
import { renameSync, writeFileSync } from "node:fs";

import { App, Stack } from "aws-cdk-lib";

import "../../../src/configs/vitest/scratch-setup.js";

const marker = process.env["LISA_CDK_SYNTH_MARKER"];
if (marker === undefined) throw new Error("LISA_CDK_SYNTH_MARKER is required");

const app = new App();
new Stack(app, "KilledFixtureStack");
const assembly = app.synth();
const temporaryMarker = `${marker}.partial`;
writeFileSync(temporaryMarker, assembly.directory, "utf8");
renameSync(temporaryMarker, marker);
setInterval(() => undefined, 1_000);
