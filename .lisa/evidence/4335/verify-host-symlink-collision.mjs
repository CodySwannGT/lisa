/** Measure the source-ownership suffix convention against a host-owned link. */
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  symlink,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { installHookCompatibility } from "../../../dist/codex/hooks-installer.js";
const host = await mkdtemp(path.join(tmpdir(), "lisa-4335-verify-link-"));
const filename = "block-no-verify.sh";
const target = path.join(host, "host-owned/codex/scripts", filename);
const entrypoint = path.join(host, ".codex/hooks/lisa", filename);
await mkdir(path.dirname(target), { recursive: true });
await mkdir(path.dirname(entrypoint), { recursive: true });
await writeFile(
  target,
  "#!/usr/bin/env bash\nprintf HOST_AUTHORED_LINK_MARKER\n"
);
await symlink(target, entrypoint);
const before = spawnSync("/bin/bash", [entrypoint], {
  input: "{}",
  encoding: "utf8",
});
const managed = await installHookCompatibility(process.cwd(), host, [], []);
const after = spawnSync("/bin/bash", [entrypoint], {
  input: "{}",
  encoding: "utf8",
});
const report = {
  captured_at: new Date().toISOString(),
  scenario:
    "Unowned host-authored symlink target has a matching catalog suffix but is outside any Lisa package; no manifest or tagged hook",
  managed,
  stillSymlink: (await lstat(entrypoint)).isSymbolicLink(),
  hostBehaviorPreserved: before.stdout === after.stdout,
  before: { status: before.status, stdout: before.stdout },
  after: { status: after.status, stdout: after.stdout },
  built_source_sha256: createHash("sha256")
    .update(await readFile("dist/codex/hooks-installer.js"))
    .digest("hex"),
};
await writeFile(
  ".lisa/evidence/4335/verify-host-symlink-collision-results.json",
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(JSON.stringify(report, null, 2));
