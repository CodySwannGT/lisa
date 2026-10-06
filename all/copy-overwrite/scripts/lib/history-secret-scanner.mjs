// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file history-secret-scanner.mjs
 * @description Pin offline scanner identity and contain all scanner output.
 * @module history-secrets
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import {
  gitEnvironment,
  gitRead,
  HistorySecretError,
} from "./history-secret-git.mjs";

export const VERSION = "8.30.1";
/** Archive and extracted executable pins both come from the same official release. */
export const PINS = Object.freeze({
  darwin_arm64: {
    archive: "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5",
    binary: "ba52fb1bfabbcde42f032afad3d6e0b19dff8ed105229a16e7caa338bbc0e84f",
  },
  darwin_x64: {
    archive: "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709",
    binary: "cee01fea7173f1b779dff188e1c26ecbcb4027d394acc573b23aaf0be260e291",
  },
  linux_x64: {
    archive: "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
    binary: "88f91962aa2f93ac6ab281d553b9e125f5197bbbce38f9f2437f7299c32e5509",
  },
  linux_arm64: {
    archive: "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080",
    binary: "00e91bbe655bd7c47753e8cfe61cb76ea1a5d7e7702fe161ee40102b46b3823b",
  },
});
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;

/** Audit the actual vendor Git children: Gitleaks can swallow their failures. */
const auditedGit = scratch => {
  const environment = gitEnvironment();
  const binary = (environment.PATH ?? "")
    .split(delimiter)
    .map(directory => resolve(directory || ".", "git"))
    .find(candidate => {
      try {
        accessSync(candidate, constants.X_OK);
        return statSync(candidate).isFile();
      } catch {
        return false;
      }
    });
  if (!binary)
    throw new HistorySecretError(
      "Git is unavailable for scanner execution. Restore Git on PATH and retry; safety is unproved."
    );
  const directory = join(scratch, "audited-git");
  mkdirSync(directory, { mode: 0o700 });
  const record = join(directory, "status.jsonl");
  writeFileSync(record, "", { mode: 0o600 });
  const launcher = join(directory, "audit.mjs");
  // Inherit streaming stdin/stdout/stderr. Only status is captured here; the
  // parent contains vendor diagnostics. The child deadline precedes the
  // vendor's 120-second deadline, which precedes the outer 130-second deadline.
  writeFileSync(
    launcher,
    `import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
let failure = false;
const child = spawn(${JSON.stringify(binary)}, args, {
  stdio: "inherit", timeout: 110000, killSignal: "SIGKILL"
});
child.once("error", () => { failure = true; });
child.once("close", (status, signal) => {
  appendFileSync(${JSON.stringify(record)}, JSON.stringify({
    log: args[0] === "-C" && args[2] === "log",
    status, signal, failure
  }) + "\\n", { mode: 0o600 });
  process.exitCode = !failure && !signal && status === 0 ? 0 : 1;
});
`,
    { mode: 0o600 }
  );
  writeFileSync(
    join(directory, "git"),
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(launcher)} "$@"\n`,
    { mode: 0o700 }
  );
  return {
    environment: {
      ...environment,
      PATH: `${directory}${delimiter}${environment.PATH ?? ""}`,
    },
    begin: () => writeFileSync(record, "", { mode: 0o600 }),
    succeeded: () => {
      try {
        const rows = readFileSync(record, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map(line => JSON.parse(line));
        return (
          rows.some(row => row.log === true) &&
          rows.every(
            row =>
              row.status === 0 && row.signal === null && row.failure === false
          )
        );
      } catch {
        // probe-direction: fail-closed — unreadable or malformed audit denies
        // scanner success because successful Git execution cannot be proved.
        return false;
      }
    },
  };
};
const pin = () => {
  const selected = PINS[`${process.platform}_${process.arch}`];
  if (!selected)
    throw new HistorySecretError(
      "Unsupported scanner platform. Use supported Linux/macOS x64/arm64 with pinned Gitleaks 8.30.1."
    );
  return selected;
};

/** Provisioning is explicit; scanning itself stays offline and fails missing tools. */
export const provisionScanner = async destination => {
  const selected = pin();
  const archiveName = `gitleaks_${VERSION}_${process.platform}_${process.arch}.tar.gz`;
  const response = await fetch(
    `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${archiveName}`,
    { signal: AbortSignal.timeout(120000) }
  );
  if (!response.ok)
    throw new HistorySecretError(
      "Pinned scanner download failed. Restore access to the official release and retry provisioning."
    );
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== selected.archive)
    throw new HistorySecretError(
      "Scanner archive checksum mismatch. Discard the download and restore the official pinned release."
    );
  const scratch = mkdtempSync(join(tmpdir(), "lisa-scanner-provision-"));
  chmodSync(scratch, 0o700);
  try {
    const archive = join(scratch, "release.tar.gz");
    writeFileSync(archive, bytes, { mode: 0o600 });
    const extraction = spawnSync("tar", ["-xOf", archive, "gitleaks"], {
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120000,
    });
    if (
      extraction.error ||
      extraction.status !== 0 ||
      digest(extraction.stdout) !== selected.binary
    )
      throw new HistorySecretError(
        "Pinned scanner extraction failed identity verification. Repair tar/provisioning and retry."
      );
    writeFileSync(destination, extraction.stdout, { mode: 0o700 });
    chmodSync(destination, 0o700);
    qualifyScanner(destination);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

/** A forged same-version executable cannot satisfy the required scanner identity. */
export const qualifyScanner = requested => {
  const binary = requested
    ? resolve(requested)
    : (process.env.PATH ?? "")
        .split(delimiter)
        .map(directory => join(directory, "gitleaks"))
        .find(existsSync);
  if (!binary)
    throw new HistorySecretError(
      "Gitleaks 8.30.1 is unavailable. Run node scripts/lisa-history-secrets.mjs provision <executable-path>, then put that executable on PATH or supply --scanner."
    );
  let bytes;
  try {
    bytes = readFileSync(binary);
  } catch {
    throw new HistorySecretError(
      "Scanner executable is unreadable. Provision the pinned Gitleaks 8.30.1 executable and retry."
    );
  }
  if (digest(bytes) !== pin().binary)
    throw new HistorySecretError(
      "Scanner executable checksum/version mismatch. Provision the official pinned Gitleaks 8.30.1 release; required scanning cannot use an unqualified executable."
    );
  const version = spawnSync(binary, ["version"], {
    env: gitEnvironment(),
    encoding: "utf8",
    timeout: 10000,
  });
  if (
    version.error ||
    version.signal ||
    version.status !== 0 ||
    version.stdout.trim() !== VERSION
  )
    throw new HistorySecretError(
      "Scanner version execution failed. Repair permissions and provision pinned Gitleaks 8.30.1."
    );
  return binary;
};

const EVIDENCE_BUDGET = 64 * 1024 * 1024;
const NO_REPLACEMENTS = "--no-replace-objects";
const TAXONOMY = "Disk/missing/corrupt";
const NARRATIVE = [
  "AccessDenied boundaries,",
  `${TAXONOMY} falsifications.`,
].join(" ");
const safePath = value =>
  typeof value === "string" &&
  value.length > 0 &&
  !/[\\\u0000-\u001f\u007f]/u.test(value) &&
  !/^(?:\/|[A-Za-z]:)/u.test(value) &&
  value.split("/").every(part => part && part !== "." && part !== "..");

/** Read authentic regular Git blobs, never trimmed text or worktree evidence. */
const readBlob = (file, commit, cwd, budget) => {
  if (!safePath(file)) return null;
  const entries = gitRead(
    ["--literal-pathspecs", "ls-tree", "-z", commit, "--", file],
    cwd
  )
    .split("\0")
    .filter(Boolean);
  if (entries.length !== 1) return null;
  const entry = entries[0].match(
    /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t([\s\S]*)$/u
  );
  if (!entry || entry[3] !== file || entry[2].length !== commit.length)
    return null;
  const sizeText = gitRead(["cat-file", "-s", entry[2]], cwd);
  const size = Number(sizeText);
  if (!/^\d+$/u.test(sizeText) || !Number.isSafeInteger(size))
    throw new HistorySecretError(
      "Git blob size is invalid. Repair complete Git objects and retry; safety is unproved."
    );
  if (size > budget.remaining) return null;
  const result = spawnSync(
    "git",
    [NO_REPLACEMENTS, "cat-file", "blob", entry[2]],
    {
      cwd,
      env: gitEnvironment(),
      timeout: 120000,
      maxBuffer: EVIDENCE_BUDGET,
    }
  );
  if (
    result.error ||
    result.signal ||
    result.status !== 0 ||
    result.stdout.length !== size ||
    createHash(commit.length === 40 ? "sha1" : "sha256")
      .update(`blob ${size}\0`)
      .update(result.stdout)
      .digest("hex") !== entry[2]
  )
    throw new HistorySecretError(
      "Git blob bytes cannot be verified. Repair complete Git objects and retry; no raw source is published."
    );
  budget.remaining -= size;
  return result.stdout;
};

/** Native JSON validation plus bounded duplicate-aware lexical role attribution. */
const evidenceMap = bytes => {
  if (bytes.length > 1024 * 1024) return null;
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes)) return null;
  try {
    const value = JSON.parse(text);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !value.source_sha256 ||
      typeof value.source_sha256 !== "object" ||
      Array.isArray(value.source_sha256)
    )
      return null;
    const entries = Object.entries(value.source_sha256);
    if (
      !entries.length ||
      entries.length > 256 ||
      entries.some(
        ([file, hash]) =>
          !safePath(file) ||
          typeof hash !== "string" ||
          !/^[a-f0-9]{64}$/u.test(hash)
      )
    )
      return null;
    const tokens = [
      ...text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}[\],:]|[^{}[\],:\s]+/gu),
    ];
    if (tokens.length > 8192) return null;
    let cursor = 0;
    const spans = [];
    const visit = (path, depth) => {
      if (depth > 32) throw new Error("Bounded JSON depth");
      const token = tokens[cursor++];
      if (token[0] === "{") {
        const keys = new Set();
        while (tokens[cursor][0] !== "}") {
          const key = JSON.parse(tokens[cursor++][0]);
          if (keys.has(key)) throw new Error("Duplicate decoded JSON key");
          keys.add(key);
          cursor++; // Native JSON validation already proved the colon.
          visit([...path, key], depth + 1);
          if (tokens[cursor][0] === ",") cursor++;
        }
        cursor++;
      } else if (token[0] === "[") {
        let index = 0;
        while (tokens[cursor][0] !== "]") {
          visit([...path, index++], depth + 1);
          if (tokens[cursor][0] === ",") cursor++;
        }
        cursor++;
      } else if (
        path.length === 2 &&
        path[0] === "source_sha256" &&
        token[0][0] === '"'
      ) {
        const hash = JSON.parse(token[0]);
        // Escaped values do not supply an unambiguous literal detector span.
        if (token[0] !== JSON.stringify(hash))
          throw new Error("Ambiguous digest spelling");
        spans.push({
          file: path[1],
          hash,
          start: Buffer.byteLength(text.slice(0, token.index + 1)),
          end: Buffer.byteLength(
            text.slice(0, token.index + token[0].length - 1)
          ),
        });
      }
    };
    visit([], 0);
    return cursor === tokens.length && spans.length === entries.length
      ? { value, spans }
      : null;
  } catch {
    // probe-direction: fail-closed — malformed, duplicate or over-budget JSON
    // cannot establish evidence role; its detector findings remain blocking.
    return null;
  }
};

/** Clear only a uniquely attributed, independently established benign finding. */
const classifyEvidence = cwd => {
  const budget = { remaining: EVIDENCE_BUDGET };
  const blobs = new Map();
  const maps = new Map();
  const blob = (file, commit) => {
    const key = `${commit}\0${file}`;
    if (!blobs.has(key)) {
      if (blobs.size >= 256) return null;
      blobs.set(key, readBlob(file, commit, cwd, budget));
    }
    return blobs.get(key);
  };
  return row => {
    if (
      row.RuleID !== "generic-api-key" ||
      !safePath(row.File) ||
      row.SymlinkFile !== "" ||
      row.Secret !== "REDACTED" ||
      typeof row.Match !== "string" ||
      row.EndLine !== row.StartLine ||
      !Number.isSafeInteger(row.StartColumn) ||
      !Number.isSafeInteger(row.EndColumn) ||
      row.StartColumn < 1 ||
      row.EndColumn < row.StartColumn
    )
      return false;
    const bytes = blob(row.File, row.Commit);
    if (!bytes) return false;
    let lineStart = 0;
    for (let line = 1; line < row.StartLine; line++) {
      const next = bytes.indexOf(10, lineStart);
      if (next < 0) return false;
      lineStart = next + 1;
    }
    const newline = bytes.indexOf(10, lineStart);
    const lineEnd = newline < 0 ? bytes.length : newline;
    const replacements = row.Match.split("REDACTED");
    if (replacements.length !== 2) return false;
    const line = bytes.subarray(lineStart, lineEnd);
    const attributed = (candidate, left, right) => {
      const template = replacements.join(candidate);
      if (template.split(candidate).length !== 2) return false;
      const original = Buffer.from(template);
      const offset = line.indexOf(original);
      if (offset < 0 || line.indexOf(original, offset + 1) >= 0) return false;
      const start = lineStart + offset;
      const end = start + original.length;
      if (
        left !== start + Buffer.byteLength(replacements[0]) ||
        right !== left + Buffer.byteLength(candidate)
      )
        return false;
      // Pinned 8.30.1 detect/location.go counts a preceding fragment newline
      // in columns after its first line. Prove exactly one of those two byte
      // frames against the actual unique Git span; never infer fragment state.
      return (
        [0, 1].filter(
          newlineByte =>
            start === lineStart + row.StartColumn - 1 - newlineByte &&
            end === lineStart + row.EndColumn - newlineByte
        ).length === 1
      );
    };
    // A complete standalone validation paragraph excludes surrounding JSON,
    // assignments and interpolated/code contexts, not merely their filenames.
    if (
      (bytes.equals(Buffer.from(NARRATIVE)) ||
        bytes.equals(Buffer.from(`${NARRATIVE}\n`))) &&
      attributed(
        TAXONOMY,
        NARRATIVE.indexOf(TAXONOMY),
        NARRATIVE.indexOf(TAXONOMY) + TAXONOMY.length
      )
    )
      return true;
    const key = `${row.Commit}\0${row.File}`;
    if (!maps.has(key)) {
      const parsed = evidenceMap(bytes);
      let valid = parsed !== null;
      const revision =
        parsed && Object.hasOwn(parsed.value, "source_revision")
          ? parsed.value.source_revision
          : row.Commit;
      if (parsed && Object.hasOwn(parsed.value, "source_revision")) {
        valid =
          typeof revision === "string" &&
          new RegExp(`^[a-f0-9]{${row.Commit.length}}$`, "u").test(revision);
        if (valid) {
          const type = spawnSync(
            "git",
            [NO_REPLACEMENTS, "cat-file", "-t", revision],
            {
              cwd,
              env: gitEnvironment(),
              timeout: 120000,
              maxBuffer: 1024 * 1024,
            }
          );
          const ancestry = spawnSync(
            "git",
            [
              NO_REPLACEMENTS,
              "merge-base",
              "--is-ancestor",
              revision,
              row.Commit,
            ],
            {
              cwd,
              env: gitEnvironment(),
              timeout: 120000,
              maxBuffer: 1024 * 1024,
            }
          );
          // probe-direction: fail-closed — an absent/unreachable revision or
          // failed ancestry probe cannot establish a historical preimage.
          valid =
            !type.error &&
            !type.signal &&
            type.status === 0 &&
            type.stdout.toString() === "commit\n" &&
            !type.stderr.length &&
            !ancestry.error &&
            !ancestry.signal &&
            ancestry.status === 0 &&
            !ancestry.stdout.length &&
            !ancestry.stderr.length;
        }
      }
      if (valid)
        for (const span of parsed.spans) {
          const sourceBytes = blob(span.file, revision);
          if (!sourceBytes || digest(sourceBytes) !== span.hash) {
            valid = false;
            break;
          }
        }
      maps.set(key, valid ? parsed.spans : []);
    }
    const candidates = maps
      .get(key)
      .filter(span => attributed(span.hash, span.start, span.end));
    return candidates.length === 1;
  };
};

/** Only structured safe attribution is serialized, never stderr or metadata strings. */
export const scanCommits = (commits, cwd, requested) => {
  const binary = qualifyScanner(requested);
  const scratch = mkdtempSync(join(tmpdir(), "lisa-history-scan-"));
  chmodSync(scratch, 0o700);
  try {
    const scanner = join(scratch, "gitleaks");
    const executable = readFileSync(binary);
    if (digest(executable) !== pin().binary)
      throw new HistorySecretError(
        "Scanner identity changed during qualification. Provision the pinned executable and retry."
      );
    writeFileSync(scanner, executable, { mode: 0o700 });
    const config = join(scratch, "default.toml");
    const report = join(scratch, "report.json");
    const ignore = join(scratch, "ignore");
    writeFileSync(config, "[extend]\nuseDefault = true\n", { mode: 0o600 });
    // Gitleaks truncates this existing file: its report keeps private mode even
    // when the caller's umask would otherwise create world-readable metadata.
    writeFileSync(report, "[]", { mode: 0o600 });
    writeFileSync(ignore, "", { mode: 0o600 });
    // An isolated bare view excludes caller ignore files even in Git metadata.
    const source = join(scratch, "repository");
    gitRead(
      [
        "init",
        "--bare",
        `--object-format=${gitRead(["rev-parse", "--show-object-format"], cwd)}`,
        source,
      ],
      scratch
    );
    const objects = gitRead(
      ["rev-parse", "--path-format=absolute", "--git-path", "objects"],
      cwd
    );
    writeFileSync(join(source, "objects/info/alternates"), `${objects}\n`, {
      mode: 0o600,
    });
    const findings = [];
    const audit = auditedGit(scratch);
    const benign = classifyEvidence(cwd);
    for (let offset = 0; offset < commits.length; offset += 100) {
      const group = commits.slice(offset, offset + 100);
      audit.begin();
      const result = spawnSync(
        scanner,
        [
          "git",
          source,
          "--config",
          config,
          "--gitleaks-ignore-path",
          ignore,
          "--ignore-gitleaks-allow",
          "--redact=100",
          "--no-banner",
          "--no-color",
          "--log-level",
          "error",
          "--platform",
          "none",
          "--exit-code",
          "42",
          "--timeout",
          "120",
          "--report-format",
          "json",
          "--report-path",
          report,
          "--log-opts",
          `--no-walk=unsorted --root --diff-merges=separate --no-ext-diff --no-textconv --no-renames ${group.join(" ")}`,
        ],
        {
          cwd: scratch,
          env: audit.environment,
          timeout: 130000,
          maxBuffer: 16 * 1024 * 1024,
        }
      );
      if (
        result.error ||
        result.signal ||
        ![0, 42].includes(result.status) ||
        result.stdout.length ||
        result.stderr.length ||
        !audit.succeeded()
      )
        throw new HistorySecretError(
          "Gitleaks 8.30.1 execution/configuration failed. Repair the pinned scanner and complete Git objects; no safety result was established."
        );
      let rows;
      try {
        rows = JSON.parse(readFileSync(report, "utf8"));
      } catch {
        throw new HistorySecretError(
          "Scanner report is missing or malformed. Repair pinned scanner execution and retry; safety is unproved."
        );
      }
      if (!Array.isArray(rows) || (result.status === 42) !== rows.length > 0)
        throw new HistorySecretError(
          "Scanner exit/report disagreement. Repair pinned scanner execution; required safety is unproved."
        );
      for (const row of rows) {
        if (
          !group.includes(row.Commit) ||
          !/^[a-z][a-z0-9-]{1,64}$/u.test(row.RuleID) ||
          !Number.isSafeInteger(row.StartLine) ||
          row.StartLine < 1
        )
          throw new HistorySecretError(
            "Scanner attribution is invalid. Repair pinned scanner execution; no raw report is published."
          );
        if (!benign(row))
          findings.push({
            rule: row.RuleID,
            commit: row.Commit,
            line: row.StartLine,
          });
      }
    }
    return {
      scanner: "Gitleaks",
      version: VERSION,
      commits: commits.length,
      findings,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};
