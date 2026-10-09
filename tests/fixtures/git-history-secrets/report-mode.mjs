/**
 * @file report-mode.mjs
 * @description Observe genuine vendor creation through the emitted private launch boundary.
 * @module history-secrets-fixtures
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { commitFixture } from "./harness.mjs";
import { proveCredentialParagraphRefusal } from "./native-push.mjs";

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

/**
 * Require exact native status, selected commits and original finding attribution.
 * @param harness - Bounded native fixture operations
 * @param fixture - Exact expected status and source coordinates
 * @returns Actual bounded native observation after every original assertion
 */
export const scanImmutableCase = (harness, fixture) => {
  const { cwd, name, expected, before, head, target } = fixture;
  const { git, command, emitted, scanner, requireFact, observations } = harness;
  const selectedCommits = git(cwd, "rev-list", `${before}..${head}`)
    .split("\n")
    .filter(Boolean);
  const result = command(
    process.execPath,
    [join(emitted, harness.SCANNER_ENTRY), "pre-push", "--scanner", scanner],
    cwd,
    `refs/heads/fixture ${head} refs/heads/fixture ${before}\n`
  );
  const report = (() => {
    requireFact(
      result.status === expected,
      `${name}: immutable verdict differs; raw output withheld.`
    );
    return JSON.parse(result.stdout);
  })();
  requireFact(
    report.version === "8.30.1" &&
      report.commits === selectedCommits.length &&
      !report.findings.some(row => row.commit === fixture.legacyCommit) &&
      (expected === 0
        ? report.findings.length === 0
        : report.findings.some(
            row =>
              row.rule === "generic-api-key" &&
              row.commit === target.commit &&
              row.line === target.line
          )),
    `${name}: actual default scanner coverage missing.`
  );
  if (fixture.targets)
    requireFact(
      report.findings.every(
        row =>
          row.rule === "generic-api-key" &&
          row.commit === fixture.origin &&
          fixture.targets.some(target => target.line === row.line)
      ) &&
        (fixture.findingsCount === undefined ||
          report.findings.length === fixture.findingsCount),
      `${name}: complete actual detector attribution differs.`
    );
  observations.push({
    name,
    exit: result.status,
    expected,
    selectedCommits: selectedCommits.length,
    preimagesVerified: fixture.preimagesVerified ?? 0,
    legacyPreimageVerified: fixture.legacyPreimageVerified ?? false,
    ...(fixture.budget
      ? { budget: fixture.budget, findingsCount: report.findings.length }
      : {}),
  });
  return observations.at(-1);
};

/**
 * Exercise all eight full-paragraph positive and refusal controls.
 * @param harness - Private fixture operations
 * @param group - Exact narrative partition
 */
export const immutableNarrativeCases = (harness, group) => {
  const { values, initialize, write } = harness;
  if (group.startsWith("narrative")) {
    const phrase =
      "AccessDenied boundaries" + ", Disk/missing/corrupt falsifications";
    const credentialParagraph = `password: ${phrase}, while describing the example.\n`;
    values.push("Disk/missing/corrupt");
    const narrativeCases =
      group === "narrative"
        ? [
            [
              "immutable-larger-paragraph",
              `These controls establish validation.\nThey cover ${phrase},\nand the \`node probe\` invocation while preserving detection.\n`,
              0,
            ],
            [
              "immutable-quoted-paragraph",
              `These controls report '${phrase},' as the example.\n`,
              42,
            ],
            [
              "immutable-inline-paragraph",
              `These controls report \`${phrase},\` as the example.\n`,
              42,
            ],
            [
              "immutable-linked-paragraph",
              `These controls report [${phrase},](https://example.invalid) as the example.\n`,
              42,
            ],
          ]
        : [
            [
              "immutable-lazy-blockquote",
              `> These controls are quoted.\nThey cover ${phrase}, while describing the example.\n`,
              42,
            ],
            [
              "immutable-credential-field-prose",
              `password:\nThese controls cover ${phrase}, while describing the example.\n`,
              42,
            ],
            [
              "immutable-unrelated-quotation",
              `These controls use "ordinary examples".\nThey cover ${phrase},\nand the \`node probe\` invocation while preserving detection.\n`,
              0,
            ],
            [
              "immutable-fenced-paragraph",
              `\`\`\`text\nThese controls cover ${phrase}, while describing the example.\n\`\`\`\n`,
              42,
            ],
          ];
    for (const [name, text, expected] of narrativeCases) {
      if (name === "immutable-credential-field-prose")
        proveCredentialParagraphRefusal(harness, credentialParagraph);
      const { cwd, base } = initialize(name);
      write(cwd, "evidence/validation.md", text);
      const head = commitFixture(harness, cwd);
      scanImmutableCase(harness, {
        cwd,
        name,
        expected,
        before: base,
        head,
        target: {
          commit: head,
          line: text.slice(0, text.indexOf("Disk/missing/corrupt")).split("\n")
            .length,
        },
      });
    }
  }
};
