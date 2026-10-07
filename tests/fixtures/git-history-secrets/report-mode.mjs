/**
 * @file report-mode.mjs
 * @description Observe genuine vendor creation through the emitted private launch boundary.
 * @module history-secrets-fixtures
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPORT = "permission-report.json";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const unknown = {
  regular: false,
  mode: null,
  readable: false,
  findingsCount: null,
  matchedValuesAbsent: null,
};

/**
 * Retain bounded predicates; unavailable or malformed reports cannot certify safety.
 * @param report - Owned vendor report path
 * @param values - Known synthetic matches, never serialized
 * @returns Safe actual report predicates
 */
export const observeReport = (report, values) => {
  try {
    const stat = lstatSync(report);
    const metadata = {
      ...unknown,
      regular: stat.isFile(),
      mode: stat.mode & 0o777,
    };
    // This observation retains the original fixture's 32 MiB capture ceiling.
    if (!metadata.regular || stat.size > 32 * 1024 * 1024) return metadata;
    try {
      const bytes = readFileSync(report, "utf8");
      const rows = JSON.parse(bytes);
      if (!Array.isArray(rows)) return metadata;
      return {
        ...metadata,
        readable: true,
        findingsCount: rows.length,
        matchedValuesAbsent: values.every(value => !bytes.includes(value)),
      };
    } catch {
      // probe-direction: fail-closed — malformed/unreadable contents cannot certify safety.
      return metadata;
    }
  } catch {
    // probe-direction: fail-closed — missing metadata never certifies a regular report.
    return unknown;
  }
};

const reportArguments = (scratch, fixture) => [
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
  join(scratch, REPORT),
  "--log-opts",
  `--no-walk --root ${fixture.earlier}`,
];

const retain = (harness, record) => {
  harness.observations.push(record);
  if (harness.proof) {
    try {
      harness.write(
        harness.proof,
        "private-report-predicates.json",
        JSON.stringify(record, null, 2)
      );
    } catch {
      throw new Error(
        "Private report predicate retention failed; raw proof withheld."
      );
    }
  }
};

const observation = (harness, prepared, result) => ({
  name: "actual-scanner-private-report-overwrite",
  identity: prepared.identity,
  nativeReturned: result !== null,
  exit: result?.status ?? null,
  signal: result?.signal ?? null,
  parentMaskBefore: prepared.parentMask,
  parentMaskAfter: process.umask(),
  ...observeReport(join(harness.scratch, REPORT), harness.values),
});

const prepare = async harness => {
  const parentMask = process.umask();
  try {
    const helper = join(
      harness.emitted,
      "scripts/lib/history-secret-scanner.mjs"
    );
    const source = await import(pathToFileURL(helper).href);
    const qualified = source.qualifyScanner(harness.scanner);
    const identity = {
      scannerVersion: source.VERSION,
      scannerSha256: hash(readFileSync(qualified)),
      sourceSha256: hash(readFileSync(helper)),
      fixtureSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
      archiveSha256: harness.archive
        ? hash(readFileSync(harness.archive))
        : null,
    };
    harness.requireFact(
      identity.scannerSha256 ===
        source.PINS[`${process.platform}_${process.arch}`].binary,
      "Scanner identity changed after qualification."
    );
    return { source, qualified, identity, parentMask };
  } catch {
    retain(harness, observation(harness, { identity: null, parentMask }, null));
    throw new Error("Private report preparation failed; raw proof withheld.");
  }
};

const execute = (harness, fixture, prepared) => {
  const { scratch, write, command, requireFact } = harness;
  try {
    write(scratch, REPORT, "[]");
    write(scratch, "permission-default.toml", "[extend]\nuseDefault = true\n");
    write(scratch, "permission-ignore", "");
    requireFact(
      (lstatSync(join(scratch, REPORT)).mode & 0o777) === 0o600,
      "Private report creation prerequisite failed."
    );
    const invocation = prepared.source.scannerInvocation(
      prepared.qualified,
      reportArguments(scratch, fixture)
    );
    return command(invocation.binary, invocation.argv, scratch);
  } catch {
    retain(harness, observation(harness, prepared, null));
    throw new Error("Private scanner execution failed; raw proof withheld.");
  }
};

/**
 * Execute the actual emitted source or immutable archive helper, never a copied launcher.
 * @param harness - Owned synthetic fixture operations
 * @param fixture - Genuine dirty Git graph
 * @returns Completion after actual permission/detection/redaction assertions
 */
export const reportModeCase = async (harness, fixture) => {
  try {
    const prepared = await prepare(harness);
    const result = execute(harness, fixture, prepared);
    const record = observation(harness, prepared, result);
    retain(harness, record);
    harness.requireFact(
      record.nativeReturned &&
        record.exit === 42 &&
        record.readable &&
        record.findingsCount > 0,
      "Actual scanner permission control did not detect the fixture."
    );
    harness.requireFact(
      record.regular && record.mode === 0o600,
      "Actual scanner overwrote private report permissions."
    );
    harness.requireFact(
      record.matchedValuesAbsent &&
        record.parentMaskAfter === prepared.parentMask,
      "Private scanner report redaction or caller-mask control failed."
    );
  } catch {
    throw new Error(
      "Actual scanner report permission/redaction witness failed; raw proof withheld."
    );
  }
};
