import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const hash = value => createHash("sha256").update(value).digest("hex");

/**
 * Extract the owning step without maintaining a second installation recipe.
 * @param source Actual YAML bytes.
 * @param [suppliedVersion] Optional explicit workflow input.
 * @returns Original and rendered commands with their input and shell identities.
 */
export function extractSetup(source, suppliedVersion) {
  const workflow = parse(source.toString("utf8"));
  const job = workflow.jobs?.k6_test;
  const matches = job?.steps?.filter(step => step.name === "Set up k6") ?? [];
  if (matches.length !== 1 || typeof matches[0].run !== "string") {
    throw new Error("Expected exactly one executable Set up k6 step");
  }
  const step = matches[0];
  const version =
    suppliedVersion ?? workflow.on?.workflow_call?.inputs?.k6_version?.default;
  if (
    typeof version !== "string" ||
    !/^(?:latest|\d+\.\d+\.\d+)$/u.test(version)
  ) {
    throw new Error("Unsupported installation input");
  }
  const declaredShell =
    step.shell ?? job.defaults?.run?.shell ?? workflow.defaults?.run?.shell;
  if (declaredShell !== undefined || job.container !== undefined) {
    throw new Error(
      "Shell/container contract changed; resolve actual runner semantics first"
    );
  }
  const script = step.run.replaceAll("${{ inputs.k6_version }}", version);
  if (script.includes("${{")) throw new Error("Unresolved workflow expression");
  return {
    script,
    originalStep: step.run,
    input: {
      supplied: suppliedVersion !== undefined,
      name: "k6_version",
      resolved: version,
    },
    runner: job["runs-on"],
    shell: {
      declared: null,
      argv: ["bash", "-e", "{script}"],
      pipefail: false,
    },
    workflowSha256: hash(source),
    originalStepSha256: hash(step.run),
    renderedStepSha256: hash(script),
  };
}

/**
 * Freeze an extracted baseline for the standalone historical reproducer.
 */
function main() {
  const [workflowPath, outputPath, sourceSha] = process.argv.slice(2);
  if (
    !workflowPath ||
    !outputPath ||
    !/^[a-f0-9]{40}$/u.test(sourceSha ?? "")
  ) {
    throw new Error(
      "Usage: node extract.mjs <actual-workflow> <new-output-directory> <source-sha>"
    );
  }
  const source = readFileSync(workflowPath);
  const extracted = extractSetup(source);
  if (
    extracted.input.resolved !== "latest" ||
    extracted.runner !== "ubuntu-latest"
  ) {
    throw new Error(
      "Baseline default/runner changed; do not silently choose new inputs"
    );
  }
  const emit = (name, bytes) =>
    writeFileSync(join(outputPath, name), bytes, { flag: "wx", mode: 0o600 });
  mkdirSync(outputPath, { mode: 0o700 });
  emit("test-workflow.yml", source);
  emit("test-original-step.txt", extracted.originalStep);
  emit("test-setup-k6.sh", extracted.script);
  emit(
    "test-extraction.json",
    `${JSON.stringify(
      {
        sourceSha,
        owner: ".github/workflows/load-test.yml",
        job: "k6_test",
        step: "Set up k6",
        ...extracted,
      },
      null,
      2
    )}\n`
  );
  console.log(
    JSON.stringify({
      sourceSha,
      input: extracted.input,
      shell: extracted.shell,
      workflowSha256: extracted.workflowSha256,
      renderedStepSha256: extracted.renderedStepSha256,
    })
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
