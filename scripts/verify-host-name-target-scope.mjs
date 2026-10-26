#!/usr/bin/env node
/** Actual-wrapper target-scope proof; commands under inspection are never executed. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { boundedExecFileSync, boundedSpawnSync } from "./lib/bounded-spawn.mjs";
import { hostNameTargetCases } from "./lib/host-name-target-cases.mjs";
import { hostNameReviewCases } from "./lib/host-name-review-cases.mjs";

const root = process.cwd();
const DETECTOR_RELATIVE = "dist/core/downstream-references.js";
const fixtureName = "notarealhostproject";
const lisa = "CodySwannGT/lisa";
const host = `acme/${fixtureName}`;
const scratch = mkdtempSync(path.join(tmpdir(), "lisa-host-scope-"));
const historical = process.argv
  .find(arg => arg.startsWith("--historical-ref="))
  ?.split("=")[1];
const hookFlag = process.argv
  .find(arg => arg.startsWith("--hooks="))
  ?.slice("--hooks=".length);
const packageFlag = process.argv
  .find(arg => arg.startsWith("--package-root="))
  ?.slice("--package-root=".length);
const payloadRoot = path.resolve(packageFlag ?? root);
const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/^(?:GIT_|GH_|GITHUB_)/u.test(key)
  )
);
const fixtureEnv = {
  ...baseEnv,
  GH_CONFIG_DIR: path.join(scratch, "gh-config"),
  GH_TOKEN: "local-fixture-no-network-token",
  GH_PROMPT_DISABLED: "1",
  CDPATH: "",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  LISA_DOWNSTREAM_NAMES: fixtureName,
};
mkdirSync(fixtureEnv.GH_CONFIG_DIR);

/** @param {string} file @returns {string} Exact byte digest. */
const digest = file =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
/** @param {string} cwd @param {string[]} args @returns {string} Local Git output. */
const git = (cwd, args) =>
  boundedExecFileSync("git", ["-C", cwd, ...args], {
    env: fixtureEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
/** @param {string} name @param {string|undefined} origin @returns {string} Isolated checkout. */
function checkout(name, origin) {
  const cwd = path.join(scratch, name);
  mkdirSync(path.join(cwd, "node_modules/@codyswann/lisa"), {
    recursive: true,
  });
  symlinkSync(
    path.join(payloadRoot, "dist"),
    path.join(cwd, "node_modules/@codyswann/lisa/dist")
  );
  assert.equal(
    realpathSync(path.join(cwd, "node_modules/@codyswann/lisa/dist")),
    realpathSync(path.join(payloadRoot, "dist")),
    "fixture must load the selected payload detector, never a checkout substitute"
  );
  git(cwd, ["init", "-q"]);
  if (origin !== undefined)
    git(cwd, ["remote", "add", "origin", `git@github.com:${origin}.git`]);
  return cwd;
}

const records = [];
try {
  assert.ok(
    existsSync(path.join(payloadRoot, DETECTOR_RELATIVE)),
    "actual compiled detector must exist; build/access is not replaced by a fixture"
  );
  assert.ok(
    !(packageFlag && historical),
    "Published payload replay cannot mix historical hooks with package detector bytes"
  );
  let hooks = path.resolve(
    payloadRoot,
    hookFlag ?? (packageFlag ? "plugins/lisa/hooks" : "plugins/src/base/hooks")
  );
  if (historical !== undefined) {
    hooks = path.join(scratch, "historical-hooks");
    mkdirSync(hooks);
    for (const file of [
      "block-host-name-leak.mjs",
      "block-host-name-leak.sh",
    ]) {
      writeFileSync(
        path.join(hooks, file),
        boundedExecFileSync(
          "git",
          ["-C", root, "show", `${historical}:plugins/src/base/hooks/${file}`],
          { env: fixtureEnv, stdio: ["ignore", "pipe", "pipe"] }
        )
      );
    }
  }
  const wrapper = path.join(hooks, "block-host-name-leak.sh");
  const classifier = path.join(hooks, "block-host-name-leak.mjs");
  const identity = {
    proverCheckoutHead: git(root, ["rev-parse", "HEAD"]),
    proverSha256: digest(new URL(import.meta.url)),
    payloadRoot,
    payloadPackageVersion: JSON.parse(
      readFileSync(path.join(payloadRoot, "package.json"), "utf8")
    ).version,
    payloadPackageJsonSha256: digest(path.join(payloadRoot, "package.json")),
    detectorRealpath: realpathSync(path.join(payloadRoot, DETECTOR_RELATIVE)),
    historicalRef: historical ?? null,
    wrapperSha256: digest(wrapper),
    classifierSha256: digest(classifier),
    contextHelperSha256: existsSync(
      path.join(hooks, "host-name-command-context.mjs")
    )
      ? digest(path.join(hooks, "host-name-command-context.mjs"))
      : null,
    detectorSha256: digest(path.join(payloadRoot, DETECTOR_RELATIVE)),
    observation:
      "Actual Bash wrapper and MJS CLI with real compiled detector; synthetic name via documented environment extension. Inspected tracker writes are never executed; no GitHub API request is made.",
  };
  console.log(JSON.stringify({ identity }));
  const hostCwd = checkout("host", host);
  const lisaCwd = checkout("protected", lisa);
  const unknownCwd = checkout("unknown", undefined);
  const body = path.join(scratch, "body.md");
  writeFileSync(body, `Work-Item: ${host}#1\n`);
  const relative = path.join(lisaCwd, "subdirectory");
  mkdirSync(relative);
  writeFileSync(path.join(lisaCwd, "body.md"), "No identity here.\n");
  writeFileSync(
    path.join(relative, "body.md"),
    `Evidence from ${fixtureName}.\n`
  );
  const selectedLisa = checkout("selected-protected", host);
  git(selectedLisa, [
    "remote",
    "add",
    "upstream",
    `git@github.com:${lisa}.git`,
  ]);
  git(selectedLisa, ["config", "remote.upstream.gh-resolved", "base"]);
  const selectedHost = checkout("selected-host", lisa);
  git(selectedHost, [
    "remote",
    "add",
    "upstream",
    `git@github.com:${host}.git`,
  ]);
  git(selectedHost, ["config", "remote.upstream.gh-resolved", "base"]);
  for (const [cwd, expected] of [
    [selectedLisa, lisa],
    [selectedHost, host],
  ]) {
    const selected = boundedExecFileSync(
      "gh",
      ["repo", "set-default", "--view"],
      {
        cwd,
        env: fixtureEnv,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    ).trim();
    assert.equal(
      selected.toLowerCase(),
      expected.toLowerCase(),
      "real gh local default-repository read must confirm the fixture"
    );
    console.log(
      JSON.stringify({ localDefaultControl: path.basename(cwd), selected })
    );
  }
  const quotedHost = checkout("host; quoted-directory", host);
  const ambiguous = checkout("ambiguous", host);
  git(ambiguous, ["remote", "add", "upstream", `git@github.com:${lisa}.git`]);
  const cdStart = checkout("cd-start", host);
  const cdHost = checkout("cd-start/target", host);
  const cdProtected = checkout("cd-search/target", lisa);
  const cdSearch = path.dirname(cdProtected);
  writeFileSync(path.join(cdHost, "body.md"), "No identity here.\n");
  writeFileSync(path.join(cdProtected, "body.md"), fixtureName);
  const actualCd = boundedExecFileSync(
    "/bin/bash",
    ["-c", 'cd target && printf "%s" "$PWD"'],
    { cwd: cdStart, env: { ...fixtureEnv, CDPATH: cdSearch }, encoding: "utf8" }
  );
  assert.ok(
    actualCd.endsWith(cdProtected),
    "real Bash must confirm CDPATH fixture routing"
  );
  console.log(
    JSON.stringify({ localCdpathControl: { actualCd, expected: cdProtected } })
  );
  const actualArgv = boundedExecFileSync(
    "/bin/bash",
    [
      "-c",
      'gh() { printf "%s\\n" "$@"; }; gh issue comment 1 --repo "$HOST_REPOSITORY" $ROUTING --body "$KNOWN_NAME"',
    ],
    {
      cwd: hostCwd,
      env: {
        ...fixtureEnv,
        HOST_REPOSITORY: host,
        ROUTING: `--repo ${lisa}`,
        KNOWN_NAME: fixtureName,
      },
      encoding: "utf8",
    }
  )
    .trim()
    .split("\n");
  assert.deepEqual(actualArgv, [
    "issue",
    "comment",
    "1",
    "--repo",
    host,
    "--repo",
    lisa,
    "--body",
    fixtureName,
  ]);
  console.log(
    JSON.stringify({
      localArgvControl: { actualArgv, inspectedWriteExecuted: false },
    })
  );
  const continuation = "\\\n";
  for (const [name, command, expected] of [
    [
      "continuation removes no real argument",
      `gh issue ${continuation} create --body ${continuation} "$KNOWN_NAME"`,
      ["issue", "create", "--body", fixtureName],
    ],
    [
      "quoted empty word survives continuation",
      `gh issue create --body ""${continuation} "$KNOWN_NAME"`,
      ["issue", "create", "--body", "", fixtureName],
    ],
  ]) {
    const argv = boundedExecFileSync(
      "/bin/bash",
      ["-c", `gh() { printf "%s\\n" "$@"; }; ${command}`],
      {
        cwd: hostCwd,
        env: { ...fixtureEnv, KNOWN_NAME: fixtureName },
        encoding: "utf8",
      }
    )
      .trim()
      .split("\n");
    assert.deepEqual(argv, expected, name);
    console.log(
      JSON.stringify({
        localContinuationArgvControl: {
          name,
          argv,
          inspectedWriteExecuted: false,
        },
      })
    );
  }
  const context = {
    hostCwd,
    lisaCwd,
    unknownCwd,
    body,
    selectedLisa,
    selectedHost,
    relative,
    quotedHost,
    ambiguous,
    fixtureName,
    lisa,
    host,
    cdStart,
    cdSearch,
    cdHost,
  };
  const cases = [
    ...hostNameTargetCases(context),
    ...hostNameReviewCases(context),
  ];
  for (const [
    name,
    cwd,
    command,
    expected,
    overrides = {},
    refusal = "BLOCKED: this tracker write names a host project.",
  ] of cases) {
    const run = boundedSpawnSync("/bin/bash", [wrapper], {
      cwd,
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
      env: {
        ...fixtureEnv,
        ...overrides,
        CLAUDE_PROJECT_DIR: overrides.CLAUDE_PROJECT_DIR ?? cwd,
      },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    assert.ok(
      !output.includes("NOT active"),
      `${name}: a missing detector/interpreter is not a passing control`
    );
    assert.ok(
      run.status === 0 || run.status === 2,
      `${name}: expected an actual hook verdict, got ${run.status}`
    );
    const passed =
      run.status === expected && (expected !== 2 || output.includes(refusal));
    records.push({ name, expected, actual: run.status, passed, output });
    console.log(JSON.stringify(records.at(-1)));
  }
  const failed = records.filter(record => !record.passed);
  console.log(
    JSON.stringify({
      total: records.length,
      passed: records.length - failed.length,
      failed: failed.length,
    })
  );
  if (failed.length > 0) process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
