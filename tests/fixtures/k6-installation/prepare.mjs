import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GIT_BIN } from "../../support/git-executable.ts";
import { extractSetup } from "./extract.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const git = args =>
  execFileSync(GIT_BIN, args, { cwd: root, encoding: "utf8" }).trim();

/**
 * Freeze candidate bytes and independent expectations before any installer execution.
 * @param control Selected installation control.
 * @param output New private evidence directory.
 * @param expectedSource Required checkout commit.
 * @param keyPath Actual captured public key for the controlled fault.
 * @param strict Require committed production bytes in hosted execution.
 * @returns Frozen source, input, harness and independent oracle identities.
 */
export function prepare(
  control,
  output,
  expectedSource,
  keyPath,
  strict = false
) {
  if (!["latest", "explicit", "negative"].includes(control))
    throw new Error("Unknown control");
  const sourceSha = git(["rev-parse", "HEAD"]);
  if (sourceSha !== expectedSource)
    throw new Error("Checked-out source differs from expected head");
  const source = readFileSync(join(root, ".github/workflows/load-test.yml"));
  const committed = execFileSync(
    GIT_BIN,
    ["show", "HEAD:.github/workflows/load-test.yml"],
    { cwd: root }
  );
  if (strict && !source.equals(committed))
    throw new Error("Hosted workflow source is dirty");
  const extracted = extractSetup(
    source,
    control === "explicit" ? "2.3.0" : undefined
  );
  if (extracted.runner !== "ubuntu-latest")
    throw new Error("Owning runner changed");
  const write = (name, bytes) =>
    writeFileSync(join(output, name), bytes, { flag: "wx", mode: 0o600 });
  const harness = join(output, "harness");
  const payloads = readdirSync(dirname(fileURLToPath(import.meta.url)))
    .filter(name => /\.(?:mjs|js|sh|py|json)$/u.test(name))
    .map(name => {
      const bytes = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), name)
      );
      return { name, bytes, sha256: hash(bytes) };
    });
  const freeze = {
    control,
    sourceSha,
    committedWorkflow: source.equals(committed),
    ...extracted,
    files: payloads.map(({ name, sha256 }) => ({ name, sha256 })),
    frozenAt: new Date().toISOString(),
    publicKeySha256:
      control === "negative" ? hash(readFileSync(keyPath)) : null,
    expected: JSON.parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "qualification-oracles.json"
        ),
        "utf8"
      )
    ),
    shellArgv: ["bash", "-e", "setup.sh"],
  };
  mkdirSync(output, { mode: 0o700 });
  write("workflow.yml", source);
  write("setup.sh", extracted.script);
  mkdirSync(harness, { mode: 0o700 });
  for (const { name, bytes } of payloads) {
    writeFileSync(join(harness, name), bytes, { flag: "wx", mode: 0o600 });
  }
  if (control === "negative") write("public-key.gpg", readFileSync(keyPath));
  write("freeze.json", `${JSON.stringify(freeze, null, 2)}\n`);
  return freeze;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [control, output, expectedSource, keyPath, strictFlag] =
    process.argv.slice(2);
  const frozen = prepare(
    control,
    output,
    expectedSource,
    keyPath,
    strictFlag === "--strict"
  );
  console.log(
    JSON.stringify({
      control,
      sourceSha: frozen.sourceSha,
      workflowSha256: frozen.workflowSha256,
      renderedStepSha256: frozen.renderedStepSha256,
      input: frozen.input,
      shell: frozen.shell,
    })
  );
}
