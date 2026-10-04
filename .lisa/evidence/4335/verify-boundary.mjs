import {
  readFile,
  writeFile,
  mkdir,
  unlink,
  lstat,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  root,
  evidence,
  host,
  tools,
  commands,
  legacyPackage,
  run,
  runs,
  sha,
  ANONYMOUS_HOST,
  HOOK_DIR,
  INSTALLED_LISA,
  HOOKS_FILE,
  SAMPLE_RB,
  RUBOCOP_ID,
  SCANNER_ID,
} from "./verify-boundary-support.mjs";
const applyArgs = [
  path.join(root, "dist/index.js"),
  "--no-update-check",
  "apply",
  host,
  "--yes",
  "--skip-git-check",
  "--refresh-templates",
  "--harness",
  "codex",
];
const apply = run("explicit-full-apply", "node", applyArgs);
if (apply.status !== 0)
  throw Error(`Explicit full apply failed: ${JSON.stringify(apply)}`);
const generated = JSON.parse(
  await readFile(path.join(host, HOOKS_FILE), "utf8")
);
const fallback = generated.hooks.PreToolUse.flatMap(g => g.hooks).find(
  h => h._lisaId === "enforcement-fallback"
).command;
commands.forEach(c => run(`after-${c.id}`, "bash", ["-c", c.command], "{}\n"));
const old = commands.find(c => c.id === "block-no-verify").command;
const blocked = `${JSON.stringify({
  tool_name: "Bash",
  tool_input: { command: "git commit --no-verify --dry-run" },
})}\n`;
const allowed = `${JSON.stringify({
  tool_name: "Bash",
  tool_input: { command: "git status --short" },
})}\n`;
run("legacy-real-deny", "bash", ["-c", old], blocked);
run("fallback-real-block", "bash", ["-c", fallback], blocked);
run("legacy-legitimate-command", "bash", ["-c", old], allowed);
run("fallback-legitimate-command", "bash", ["-c", fallback], allowed);
run(
  "legacy-real-shell-write-notice",
  "bash",
  ["-c", commands.find(c => c.id === "shell-write-nudge").command],
  `${JSON.stringify({
    tool_name: "Bash",
    tool_input: { command: "printf safe > sample.rb" },
  })}\n`
);
await writeFile(
  path.join(host, "verify.rubocop.yml"),
  "AllCops:\n  NewCops: disable\n  TargetRubyVersion: 3.4\nLayout/SpaceAroundOperators:\n  Enabled: true\n"
);
await writeFile(
  path.join(host, ".rubocop.yml"),
  "inherit_from: verify.rubocop.yml\n"
);
await writeFile(
  path.join(host, SAMPLE_RB),
  "# frozen_string_literal: true\nvalue=1\nputs value\n"
);
const edit = `${JSON.stringify({
  tool_name: "Write",
  tool_input: { file_path: SAMPLE_RB },
})}\n`;
run("real-rubocop-before", "bundle", [
  "exec",
  "rubocop",
  "--only",
  "Layout/SpaceAroundOperators",
  SAMPLE_RB,
]);
run(
  "legacy-real-rubocop-autocorrect",
  "bash",
  ["-c", commands.find(c => c.id === RUBOCOP_ID).command],
  edit
);
const corrected = await readFile(path.join(host, SAMPLE_RB), "utf8");
await writeFile(path.join(host, SAMPLE_RB), "def broken(\n");
run(
  "legacy-real-rubocop-error",
  "bash",
  ["-c", commands.find(c => c.id === RUBOCOP_ID).command],
  edit
);
await writeFile(path.join(host, SAMPLE_RB), "object.send(params[:action])\n");
run(
  "legacy-real-scanner-error",
  "bash",
  ["-c", commands.find(c => c.id === SCANNER_ID).command],
  edit
);
await writeFile(
  path.join(host, SAMPLE_RB),
  "object.public_method(:safe).call\n"
);
run(
  "legacy-real-scanner-clean",
  "bash",
  ["-c", commands.find(c => c.id === SCANNER_ID).command],
  edit
);
const manifestBefore = await readFile(
  path.join(host, ".codex/.lisa-managed.json"),
  "utf8"
);
const hooksBefore = await readFile(path.join(host, HOOKS_FILE), "utf8");
run("repeat-full-apply", "node", applyArgs);
const manifestAfter = await readFile(
  path.join(host, ".codex/.lisa-managed.json"),
  "utf8"
);
const hooksAfter = await readFile(path.join(host, HOOKS_FILE), "utf8");
const regular = [];
for (const name of [
  ...commands.map(c => `${c.id}.sh`),
  "_extract-edit-paths.sh",
  "lisa-edit-gate.sh",
])
  regular.push({
    name,
    isRegular: (await lstat(path.join(host, HOOK_DIR, name))).isFile(),
    sha256: sha(await readFile(path.join(host, HOOK_DIR, name))),
  });
await unlink(path.join(host, INSTALLED_LISA));
await mkdir(path.join(host, INSTALLED_LISA));
await rm(legacyPackage, { recursive: true });
for (const c of commands)
  run(`package-replacement-${c.id}`, "bash", ["-c", c.command], "{}\n");
run("package-replacement-old-deny", "bash", ["-c", old], blocked);
run("package-replacement-fallback-block", "bash", ["-c", fallback], blocked);
await writeFile(path.join(host, SAMPLE_RB), "object.send(params[:action])\n");
run(
  "package-replacement-real-scanner",
  "bash",
  ["-c", commands.find(c => c.id === SCANNER_ID).command],
  edit
);
await writeFile(
  path.join(host, SAMPLE_RB),
  "# frozen_string_literal: true\nvalue=1\nputs value\n"
);
run(
  "package-replacement-real-rubocop",
  "bash",
  ["-c", commands.find(c => c.id === RUBOCOP_ID).command],
  edit
);
const replacementCorrected = await readFile(path.join(host, SAMPLE_RB), "utf8");
run(
  "package-replacement-real-shell-write",
  "bash",
  ["-c", commands.find(c => c.id === "shell-write-nudge").command],
  `${JSON.stringify({
    tool_name: "Bash",
    tool_input: { command: "printf safe > sample.rb" },
  })}\n`
);
const hashes = {};
for (const f of [
  "src/codex/hooks-installer.ts",
  "src/codex/project-overlay.ts",
  "src/codex/project-hooks-cleanup.ts",
  "dist/codex/hooks-installer.js",
  "dist/codex/project-overlay.js",
  "dist/codex/project-hooks-cleanup.js",
  "dist/index.js",
  "scripts/lisa-enforcement-fallback.sh",
  "plugins/lisa/hooks/block-no-verify.sh",
  ...commands.map(c => `dist/codex/scripts/${c.id}.sh`),
  "dist/codex/scripts/_extract-edit-paths.sh",
  "dist/codex/scripts/lisa-edit-gate.sh",
])
  hashes[f] = sha(await readFile(path.join(root, f)));
for (const file of [
  "scripts/lisa-enforcement-fallback.sh",
  "scripts/lisa-hooks/block-no-verify.sh",
  "ast-grep/rules/ruby/no-unsafe-send.yml",
])
  hashes[`anonymous-host/${file}`] = sha(await readFile(path.join(host, file)));
const diff = spawnSync("/usr/bin/git", ["diff", "HEAD", "--binary"], {
  cwd: root,
  encoding: "utf8",
}).stdout;
const sourcePaths = spawnSync(
  "/usr/bin/git",
  ["status", "--porcelain", "--untracked-files=all"],
  { cwd: root, encoding: "utf8" }
)
  .stdout.split("\n")
  .filter(Boolean)
  .map(line => line.slice(3))
  .filter(
    file =>
      file.startsWith("src/") ||
      file.startsWith("tests/") ||
      file.startsWith("docs/") ||
      file === "README.md"
  )
  .sort();
const patchSourceHashes = {};
for (const file of sourcePaths)
  patchSourceHashes[file] = sha(await readFile(path.join(root, file)));
const report = {
  captured_at: new Date().toISOString(),
  base_sha: "728d35afbd3de4d522023e0b65fd0f730c94820c",
  shipping_head_sha: null,
  host: ANONYMOUS_HOST,
  saved_commands_sha256: sha(JSON.stringify(commands)),
  runs,
  generatedHooks: generated,
  regularCopies: regular,
  rubocopCorrected: corrected,
  packageReplacementRubocopCorrected: replacementCorrected,
  repeatHooksStable: hooksBefore === hooksAfter,
  repeatManifestStable: manifestBefore === manifestAfter,
  sourceHashes: hashes,
  trackedPatchSha256: sha(diff),
  localPatchSourceHashes: patchSourceHashes,
  localSourceFingerprintSha256: sha(JSON.stringify(patchSourceHashes)),
  limitations: [
    "Local uncommitted patch only; shipping identity pending",
    "Real ast-grep uses shipped Rails no-unsafe-send error rule in anonymous supported-stack fixture",
    "RuboCop uses normally installed isolated verifier bundle via BUNDLE_GEMFILE",
  ],
};
await writeFile(
  path.join(evidence, "verify-boundary-results.json"),
  `${JSON.stringify(report, null, 2)}\n`
);
await writeFile(
  path.join(evidence, "verify-host-location.json"),
  `${JSON.stringify(
    { host, tools: tools.host, bundle_path: tools.bundle_path },
    null,
    2
  )}\n`
);
console.log(
  JSON.stringify(
    {
      host,
      statuses: runs.map(({ id, status }) => ({ id, status })),
      regularCopies: regular,
      repeatHooksStable: report.repeatHooksStable,
      repeatManifestStable: report.repeatManifestStable,
    },
    null,
    2
  )
);
