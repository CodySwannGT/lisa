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
import { classifyEvidence } from "./history-secret-evidence.mjs";

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

/** Keep vendor recreation private without changing the calling process's mask. */
export const scannerInvocation = (binary, argv) => ({
  binary: "/bin/sh",
  argv: [
    "-c",
    'umask 077 || exit 1; exec "$@"',
    "lisa-private-scanner",
    binary,
    ...argv,
  ],
});

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

/** Only structured safe attribution is serialized, never stderr or metadata strings. */
export const scanCommits = (commits, cwd, requested, heads = []) => {
  if (!Array.isArray(heads) || heads.some(head => !commits.includes(head)))
    throw new HistorySecretError(
      "Evidence heads are not actual introduced commits. Supply original Git input and retry."
    );
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
    // Gitleaks removes and recreates this file; its dedicated child sets umask
    // before vendor creation, while the caller's mask remains unchanged.
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
    const benign = classifyEvidence(cwd, commits, [...new Set(heads)]);
    for (let offset = 0; offset < commits.length; offset += 100) {
      const group = commits.slice(offset, offset + 100);
      audit.begin();
      const invocation = scannerInvocation(scanner, [
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
      ]);
      const result = spawnSync(invocation.binary, invocation.argv, {
        cwd: scratch,
        env: audit.environment,
        timeout: 130000,
        maxBuffer: 16 * 1024 * 1024,
      });
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
