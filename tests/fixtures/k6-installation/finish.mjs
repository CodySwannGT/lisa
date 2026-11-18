import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { judgeMetrics } from "./metrics.mjs";

const root = process.argv[2];
const read = name => readFileSync(join(root, name), "utf8");
const hash = name =>
  createHash("sha256")
    .update(readFileSync(join(root, name)))
    .digest("hex");
const freeze = JSON.parse(read("freeze.json"));
if (
  hash("workflow.yml") !== freeze.workflowSha256 ||
  hash("setup.sh") !== freeze.renderedStepSha256
) {
  throw new Error("Executed source changed after freeze");
}
for (const file of freeze.files) {
  if (hash(`harness/${file.name}`) !== file.sha256)
    throw new Error(`Harness changed: ${file.name}`);
}
const runtime = JSON.parse(read("runtime-result.json"));
const result = {
  ...runtime,
  sourceSha: freeze.sourceSha,
  workflowSha256: freeze.workflowSha256,
  originalStepSha256: freeze.originalStepSha256,
  renderedStepSha256: freeze.renderedStepSha256,
  input: freeze.input,
  shell: freeze.shell,
  frozenInputsVerified: true,
};
if (freeze.control !== "negative") {
  result.counts = judgeMetrics(
    JSON.parse(read("summary.json")),
    read("server.stderr"),
    runtime.loopbackExit,
    freeze.expected
  );
  result.k6Version = read("version.stdout").trim();
  result.binaryIdentity = read("binary-identity.stdout");
} else if (
  runtime.actualSetupExit !== 23 ||
  !runtime.validKeyAcceptedByGpg ||
  runtime.k6Executed
) {
  throw new Error("Negative control did not reach its required boundary");
}
writeFileSync(
  join(root, "result.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  { flag: "wx", mode: 0o600 }
);
console.log(
  `K6 installation regression: ${freeze.control}: ${JSON.stringify(result)}`
);
