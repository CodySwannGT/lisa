/**
 * @file vendor-errors.mjs
 * @description Actual pinned scanner child failures must never become clean scans.
 * @module history-secrets-fixtures
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Fault only the actual vendor Git log after proving real default-rule detection.
 * @param harness - Private disposable fixture operations
 * @returns Nothing; records bounded witnesses or fails without vendor payloads
 */
export function vendorErrorCases(harness) {
  try {
    const {
      initialize,
      commit,
      secret,
      values,
      scan,
      scratch,
      command,
      requireFact,
      emitted,
      SCANNER_ENTRY,
      scanner,
      observations,
    } = harness;
    const fixture = initialize("vendor-errors");
    const zero = "0".repeat(40);
    scan(
      fixture.cwd,
      "vendor-clean-control",
      [{ before: zero, after: fixture.base }],
      0
    );
    const finding = commit(fixture.cwd, "credential.txt", secret());
    scan(
      fixture.cwd,
      "vendor-default-rule-control",
      [{ before: fixture.base, after: finding }],
      42
    );
    const directory = join(scratch, "vendor-fault");
    mkdirSync(directory, { mode: 0o700 });
    const valueFile = join(directory, "value");
    writeFileSync(valueFile, values.at(-1), { mode: 0o600 });
    const realGit = command("which", ["git"], fixture.cwd);
    requireFact(realGit.status === 0, "Actual Git executable is unavailable.");
    const adapter = join(directory, "adapter.mjs");
    writeFileSync(
      adapter,
      `import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "-C" && args[2] === "log") {
  appendFileSync(process.env.LISA_VENDOR_TRACE, "invoked\\n", { mode: 0o600 });
  if (process.env.LISA_VENDOR_MODE === "hostile")
    process.stderr.write(readFileSync(${JSON.stringify(valueFile)}));
  process.exitCode = 1;
} else {
  const result = spawnSync(${JSON.stringify(realGit.stdout.trim())}, args, { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
}
`,
      { mode: 0o600 }
    );
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
    writeFileSync(
      join(directory, "git"),
      `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(adapter)} "$@"\n`,
      { mode: 0o700 }
    );
    const input = `refs/heads/fixture ${finding} refs/heads/fixture ${fixture.base}\n`;
    for (const mode of ["hostile", "silent"]) {
      const trace = join(directory, `${mode}.trace`);
      writeFileSync(trace, "", { mode: 0o600 });
      const program = `import { spawnSync } from "node:child_process";
const result = spawnSync(process.execPath, ${JSON.stringify([join(emitted, SCANNER_ENTRY), "pre-push", "--scanner", scanner])}, {
  input: ${JSON.stringify(input)}, encoding: "utf8", timeout: 150000,
  env: { ...process.env, PATH: ${JSON.stringify(directory)} + ":" + process.env.PATH,
    LISA_VENDOR_TRACE: ${JSON.stringify(trace)}, LISA_VENDOR_MODE: ${JSON.stringify(mode)} }
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exitCode = result.status ?? 1;`;
      const result = command(
        process.execPath,
        ["--input-type=module", "-e", program],
        fixture.cwd
      );
      requireFact(
        result.status === 1,
        "Actual vendor child failure became a clean result."
      );
      requireFact(
        readFileSync(trace, "utf8") === "invoked\n",
        "Actual scanner Git log was not exercised."
      );
      requireFact(
        result.stderr.includes("Repair"),
        "Vendor failure lacks actionable remediation."
      );
      requireFact(
        !`${result.stdout}${result.stderr}`.includes(values.at(-1)),
        "Vendor failure output was not redacted."
      );
      observations.push({
        name: `actual-vendor-${mode}-git-failure`,
        exit: result.status,
      });
    }
  } catch {
    throw new Error(
      "Actual vendor error fixture failed; private synthetic diagnostics are withheld."
    );
  }
}
