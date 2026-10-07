/**
 * @file journey.mjs
 * @description Actual synthetic history journey boundary witnesses.
 * @module history-secrets-fixtures
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { createHarness } from "./harness.mjs";
import { emitArtifacts, runEvidenceCases } from "./package.mjs";
import { graphCases } from "./graphs.mjs";
import { errorCases } from "./errors.mjs";
import { nativePushCases } from "./native-push.mjs";
import { reportModeCase } from "./report-mode.mjs";
const harness = createHarness(process.argv.slice(2));
const { outputs, values, requireFact, observations, scratch } = harness;
const EVIDENCE_FILE = "evidence.json";
const HEAD = "HEAD";
/** Exercise evidence decisions through emitted CLI bytes and real Git preimages. */
function evidenceCases() {
  const { initialize, write, git, command, emitted, scanner, secret } = harness;
  const selector = flag => {
    const matches = harness.args.filter(arg => arg.startsWith(flag));
    if (matches.length > 1 || matches.some(arg => arg !== flag))
      throw new Error("Duplicate or malformed evidence control selector.");
    return matches.length ? (harness.option(flag) ?? "") : null;
  };
  const group = selector("--evidence-group");
  const partition = selector("--evidence-partition");
  if (
    ![null, "positive", "digest", "narrative"].includes(group) ||
    ![null, "first", "second"].includes(partition) ||
    (partition !== null && group !== "digest")
  )
    throw new Error("Unknown evidence control selector.");
  const selection = { index: 0 };
  const selected = name =>
    (group === null ||
      name.startsWith(group === "positive" ? "verified-" : `${group}-`)) &&
    (partition === null || selection.index++ < 14 === (partition === "first"));
  const source = "config/credentials.yml.enc";
  const taxonomy = "Disk/missing/corrupt";
  const prefix = "AccessDenied boundaries,";
  const narrative = `${prefix} ${taxonomy} falsifications.`;
  const bytes = Buffer.from(" ordinary non-secret content\n\n");
  const digest = value => createHash("sha256").update(value).digest("hex");
  const hash = digest(bytes);
  const role = { [source]: hash };
  const encodedRole = JSON.stringify(role);
  const map = (fields = {}) =>
    JSON.stringify({ source_sha256: role, ...fields }, null, 2);
  const mapHash = (value = hash, path = source) =>
    map({ source_sha256: { [path]: value } });
  const binary = Buffer.from([0, 255, 10, 32, 120, 10]);
  const binaryHash = digest(binary);
  const substituted = randomBytes(32).toString("hex");
  const commitAll = cwd => {
    git(cwd, "add", ".");
    git(cwd, "commit", "-qm", "evidence fixture");
  };
  const prove = (cwd, revision, path, expected) => {
    const proof = command(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import { execFileSync } from "node:child_process"; import { createHash } from "node:crypto"; const bytes = execFileSync("git", ["--no-replace-objects", "show", `${process.argv[1]}:${process.argv[2]}`]); if (createHash("sha256").update(bytes).digest("hex") !== process.argv[3]) process.exit(1); console.log("preimage-ok");',
        revision,
        path,
        expected,
      ],
      cwd
    );
    requireFact(
      proof.status === 0 && proof.stdout === "preimage-ok\n",
      "Actual Git byte preimage witness failed."
    );
  };
  const scan = (cwd, name, expected, preimageVerified = false) => {
    const head = git(cwd, "rev-parse", HEAD);
    const commits = git(cwd, "rev-list", head).split("\n").length;
    const result = command(
      process.execPath,
      [join(emitted, harness.SCANNER_ENTRY), "pre-push", "--scanner", scanner],
      cwd,
      `refs/heads/fixture ${head} refs/heads/fixture ${"0".repeat(head.length)}\n`
    );
    if (result.status !== expected)
      throw new Error(
        `${name}: unexpected evidence verdict; raw output withheld.`
      );
    const report = JSON.parse(result.stdout);
    requireFact(
      report.version === "8.30.1" &&
        report.commits === commits &&
        Array.isArray(report.findings) &&
        (expected === 0
          ? report.findings.length === 0
          : report.findings.length > 0),
      `${name}: actual default scanner coverage/attribution missing.`
    );
    if (name === "digest-other-default-rule")
      requireFact(
        report.findings.some(finding => finding.rule === "aws-access-token"),
        "Other default detector attribution missing."
      );
    observations.push({ name, exit: result.status, commits, preimageVerified });
  };
  const fixture = (name, content, expected = 42, setup) => {
    if (!selected(name)) return;
    const { cwd } = initialize(name);
    write(cwd, source, bytes);
    if (setup) setup(cwd);
    write(
      cwd,
      EVIDENCE_FILE,
      typeof content === "function" ? content(cwd) : content
    );
    commitAll(cwd);
    if (expected === 0) prove(cwd, HEAD, source, hash);
    scan(cwd, name, expected, expected === 0);
  };
  values.push(taxonomy, hash, binaryHash, substituted);
  fixture("verified-digest-exact-bytes", map(), 0);
  if (selected("verified-binary-preimage")) {
    const name = "verified-binary-preimage";
    const binaryFixture = initialize(name);
    write(binaryFixture.cwd, source, binary);
    write(binaryFixture.cwd, EVIDENCE_FILE, mapHash(binaryHash));
    commitAll(binaryFixture.cwd);
    prove(binaryFixture.cwd, HEAD, source, binaryHash);
    scan(binaryFixture.cwd, name, 0, true);
  }
  fixture(
    "verified-unicode-byte-attribution",
    JSON.stringify({ note: "é", source_sha256: role }),
    0
  );
  if (selected("verified-reachable-history")) {
    const name = "verified-reachable-history";
    const history = initialize(name);
    const revision = harness.commit(history.cwd, source, bytes);
    git(history.cwd, "rm", "-q", source);
    write(history.cwd, EVIDENCE_FILE, map({ source_revision: revision }));
    commitAll(history.cwd);
    prove(history.cwd, revision, source, hash);
    scan(history.cwd, name, 0, true);
  }
  for (const [name, content] of Object.entries({
    "wrong-role": JSON.stringify({ api_key: hash }),
    "nested-role": JSON.stringify({ nested: { source_sha256: role } }),
    mismatch: mapHash(digest(Buffer.from("different\n"))),
    "absent-preimage": mapHash(hash, "absent/credentials.yml.enc"),
    "malformed-map": map({ source_sha256: [hash], api_key: hash }),
    "duplicate-key": `{"source_sha256":${encodedRole},"source_sha256":${encodedRole}}`,
    "escaped-duplicate-key": `{"source_sha256":${encodedRole},"source_\\u0073ha256":${encodedRole}}`,
    "escaped-path-alias": `{"source_sha256": {"${source}": "${hash}", "config/credential\\u0073.yml.enc": "${hash}"}}`,
    "escaped-value": map().replace(
      hash,
      `\\u00${hash.charCodeAt(0).toString(16)}${hash.slice(1)}`
    ),
    "unverified-sibling": map({
      source_sha256: { ...role, "other/credentials.yml.enc": hash },
    }),
    "unsafe-parent": mapHash(hash, "../credentials.yml.enc"),
    "unsafe-absolute": mapHash(hash, "/credentials.yml.enc"),
    ...Object.fromEntries(
      Object.entries({
        unavailable: "f".repeat(40),
        null: null,
        false: false,
        empty: "",
        numeric: 42,
      }).map(([name, source_revision]) => [
        `${name}-revision`,
        map({ source_revision }),
      ])
    ),
    "ambiguous-line": JSON.stringify({ source_sha256: role, other: role }),
    "invalid-utf8": Buffer.concat([Buffer.from(map()), Buffer.from([255])]),
    "depth-budget": map({
      metadata: JSON.parse(`${"[".repeat(34)}0${"]".repeat(34)}`),
    }),
    "token-budget": map({ metadata: Array(4200).fill(0) }),
    "byte-budget": map({ metadata: "x".repeat(1024 * 1024) }),
  }))
    fixture(`digest-${name}`, content);
  fixture("digest-symlink-preimage", map(), 42, cwd => {
    rmSync(join(cwd, source));
    write(cwd, "ordinary.txt", bytes);
    symlinkSync("../ordinary.txt", join(cwd, source));
  });
  fixture("digest-source-credential", cwd => {
    const credential = Buffer.from(secret());
    const credentialHash = digest(credential);
    values.push(credentialHash);
    write(cwd, source, credential);
    // A truthful map must not suppress the credential in its actual source.
    return mapHash(credentialHash);
  });
  fixture("digest-adjacent-credential", map(), 42, cwd =>
    write(cwd, "credential.txt", secret())
  );
  fixture("digest-other-default-rule", map(), 42, cwd => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const symbols = [...randomBytes(alphabet.length)]
      .map((byte, index) => ({ byte, symbol: alphabet[index] }))
      .sort((left, right) => left.byte - right.byte)
      .slice(0, 16)
      .map(entry => entry.symbol)
      .join("");
    const value = `AKIA${symbols}`;
    values.push(value);
    write(cwd, "credential.txt", `aws_access_key_id = "${value}"\n`);
  });
  if (selected("digest-tag-object-revision")) {
    const name = "digest-tag-object-revision";
    const tagFixture = initialize(name);
    harness.commit(tagFixture.cwd, source, bytes);
    git(tagFixture.cwd, "tag", "-a", "fixture", "-m", "tag object");
    const tag = git(tagFixture.cwd, "rev-parse", "refs/tags/fixture");
    harness.commit(
      tagFixture.cwd,
      EVIDENCE_FILE,
      map({ source_revision: tag })
    );
    scan(tagFixture.cwd, name, 42);
  }
  if (selected("digest-unreachable-revision")) {
    const name = "digest-unreachable-revision";
    const unreachable = initialize(name);
    const orphanRevision = harness.commit(unreachable.cwd, source, bytes);
    git(unreachable.cwd, "checkout", "-qb", "fixture", unreachable.base);
    write(
      unreachable.cwd,
      EVIDENCE_FILE,
      map({ source_revision: orphanRevision })
    );
    commitAll(unreachable.cwd);
    scan(unreachable.cwd, name, 42);
  }
  for (const [name, text, expected] of [
    ["verified-narrative-paragraph", `${narrative}\n`, 0],
    ["verified-narrative-no-newline", narrative, 0],
    [
      "narrative-credential-assignment",
      `AccessDenied boundaries,\napi_key = "${taxonomy}"\n`,
      42,
    ],
    [
      "narrative-credential-json",
      JSON.stringify({ validation: prefix, api_key: taxonomy }),
      42,
    ],
    [
      "narrative-code-context",
      `// AccessDenied boundaries,\nconst api_key = "${taxonomy}";\n`,
      42,
    ],
    [
      "narrative-interpolation",
      `AccessDenied boundaries,\napi_key = "${taxonomy}" + \`\${suffix}\`;\n`,
      42,
    ],
    [
      "narrative-arbitrary-substitution",
      `AccessDenied boundaries, ${substituted} falsifications.\n`,
      42,
    ],
    ["narrative-adjacent-credential", `${narrative}\n${secret()}`, 42],
  ]) {
    if (!selected(name)) continue;
    const { cwd } = initialize(name);
    harness.commit(cwd, "validation.txt", text);
    scan(cwd, name, expected);
  }
}
try {
  emitArtifacts(harness);
  const portable = runEvidenceCases(harness, evidenceCases);
  if (!portable && !harness.args.includes("--evidence-only")) {
    const fixture = graphCases(harness);
    await reportModeCase(harness, fixture);
    errorCases(harness, fixture);
    nativePushCases(harness);
  }
  for (const output of outputs)
    for (const value of values)
      requireFact(
        !output.includes(value),
        "Captured outward output contains a matched synthetic value; proof withheld."
      );
  const report = {
    scanner: "Gitleaks 8.30.1",
    observations,
    redaction: true,
    cleanup: "all owned fixture repositories/processes removed on exit",
  };
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const fallback = "Journey failed; raw proof withheld.";
  console.error(error instanceof Error ? error.message : fallback);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
  requireFact(!existsSync(scratch), "Positive scratch cleanup failed.");
}
