import {
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  symlink,
  rename,
  chmod,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = process.cwd();
const host = await mkdtemp(
  path.join(tmpdir(), "lisa-4335-anonymous-dependencies-")
);
const source = path.join(host, "installed-package");
const files = [
  "sg-scan-on-edit.sh",
  "_extract-edit-paths.sh",
  "lisa-edit-gate.sh",
];
const sourceHashes = {};
await mkdir(source);
for (const name of files) {
  await copyFile(
    path.join(root, "dist/codex/scripts", name),
    path.join(source, name)
  );
  sourceHashes[name] = createHash("sha256")
    .update(await readFile(path.join(source, name)))
    .digest("hex");
}
for (const mode of ["linked", "copied"]) {
  const fixture = path.join(host, mode);
  await mkdir(path.join(fixture, ".codex/hooks/lisa"), { recursive: true });
  await mkdir(path.join(fixture, "node_modules/.bin"), { recursive: true });
  for (const name of files) {
    const dest = path.join(fixture, ".codex/hooks/lisa", name);
    if (mode === "linked") await symlink(path.join(source, name), dest);
    else await copyFile(path.join(source, name), dest);
  }
  await writeFile(path.join(fixture, "sample.rb"), "x = 1\n");
  await writeFile(path.join(fixture, "sgconfig.yml"), "ruleDirs: []\n");
  const runner = path.join(fixture, "node_modules/.bin/ast-grep");
  await writeFile(
    runner,
    '#!/bin/sh\nprintf "ast-grep invoked: %s\\n" "$*"\nexit 3\n'
  );
  await chmod(runner, 0o755);
}
const payload = JSON.stringify({
  tool_name: "Write",
  tool_input: { file_path: "sample.rb" },
});
const invoke = mode => {
  const out = spawnSync("/bin/bash", [".codex/hooks/lisa/sg-scan-on-edit.sh"], {
    cwd: path.join(host, mode),
    input: payload,
    encoding: "utf8",
  });
  return {
    status: out.status,
    stdout: out.stdout,
    stderr: out.stderr.replaceAll(host, "<anonymous-host>"),
  };
};
const before = { linked: invoke("linked"), copied: invoke("copied") };
await rename(source, path.join(host, "retired-package"));
const after = { linked: invoke("linked"), copied: invoke("copied") };
const report = {
  captured_at: new Date().toISOString(),
  sourceHashes,
  payload,
  before,
  after,
  conclusion:
    "Regular copies keep entrypoints and sourced helpers operational when the installed package is replaced. Absolute package symlinks lose their targets.",
};
await writeFile(
  path.join(root, ".lisa/evidence/4335/red-dependency-results.json"),
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(JSON.stringify(report, null, 2));
if (
  before.linked.status !== 1 ||
  before.copied.status !== 1 ||
  after.linked.status !== 127 ||
  after.copied.status !== 1 ||
  !after.copied.stdout.includes("ast-grep invoked: scan sample.rb")
)
  process.exitCode = 1;
