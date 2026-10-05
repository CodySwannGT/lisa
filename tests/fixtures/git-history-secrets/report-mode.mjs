/**
 * @file report-mode.mjs
 * @description Observe actual scanner overwrite permissions and complete matched-value redaction.
 * @module history-secrets-fixtures
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
export const reportModeCase = (harness, fixture) => {
  const {
    scratch,
    write,
    command,
    scanner,
    requireFact,
    values,
    observations,
  } = harness;
  try {
    const report = join(scratch, "permission-report.json");
    write(scratch, "permission-report.json", "[]");
    write(scratch, "permission-default.toml", "[extend]\nuseDefault = true\n");
    write(scratch, "permission-ignore", "");
    const result = command(
      scanner,
      [
        "git",
        fixture.cwd,
        "--config",
        join(scratch, "permission-default.toml"),
        "--gitleaks-ignore-path",
        join(scratch, "permission-ignore"),
        "--ignore-gitleaks-allow",
        "--redact=100",
        "--no-banner",
        "--no-color",
        "--exit-code",
        "42",
        "--report-format",
        "json",
        "--report-path",
        report,
        "--log-opts",
        `--no-walk --root ${fixture.earlier}`,
      ],
      scratch
    );
    const bytes = readFileSync(report, "utf8");
    requireFact(
      result.status === 42 && JSON.parse(bytes).length > 0,
      "Actual scanner permission control did not detect the fixture."
    );
    requireFact(
      (statSync(report).mode & 0o777) === 0o600,
      "Actual scanner overwrote private report permissions."
    );
    requireFact(
      values.every(value => !bytes.includes(value)),
      "Actual scanner report retained a matched value; raw proof withheld."
    );
    if (harness.proof)
      write(harness.proof, "actual-permission-report.json", bytes);
    observations.push({
      name: "actual-scanner-private-report-overwrite",
      exit: result.status,
      mode: "0600",
    });
  } catch {
    throw new Error(
      "Actual scanner report permission/redaction witness failed; raw proof withheld."
    );
  }
};
