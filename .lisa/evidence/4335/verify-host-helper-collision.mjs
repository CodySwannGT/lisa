/** Exercise preservation of a host-authored companion under a legacy hook. */
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  readlink,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { installHookCompatibility } from "../../../dist/codex/hooks-installer.js";
const root = process.cwd();
const host = await mkdtemp(path.join(tmpdir(), "lisa-4335-verify-helper-"));
const directory = path.join(host, ".codex/hooks/lisa");
await mkdir(directory, { recursive: true });
await symlink(
  path.join(root, "dist/codex/scripts/rubocop-on-edit.sh"),
  path.join(directory, "rubocop-on-edit.sh")
);
const entrypoint = path.join(directory, "rubocop-on-edit.sh");
const entrypointBefore = await readlink(entrypoint);
const config = path.join(host, ".codex/hooks.json");
const configBefore = JSON.stringify({
  hooks: {
    PostToolUse: [
      {
        matcher: "Edit|Write|apply_patch",
        hooks: [
          {
            type: "command",
            _lisaManaged: true,
            _lisaId: "rubocop-on-edit",
            command:
              'bash "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.codex/hooks/lisa/rubocop-on-edit.sh"',
          },
        ],
      },
    ],
  },
});
await writeFile(config, configBefore);
const file = path.join(directory, "_extract-edit-paths.sh");
const original = "#!/usr/bin/env bash\necho HOST_AUTHORED_HELPER\n";
await writeFile(file, original);
const outcome = { managed: null, error: null };
try {
  outcome.managed = await installHookCompatibility(root, host, ["rails"], []);
} catch (error) {
  outcome.error = error.message.replaceAll(host, "<anonymous-host>");
}
const current = await readFile(file, "utf8");
const entrypointAfter = await readlink(entrypoint).catch(() => null);
const command = spawnSync("/bin/bash", [file], { encoding: "utf8" });
const hash = value => createHash("sha256").update(value).digest("hex");
const report = {
  captured_at: new Date().toISOString(),
  scenario:
    "Source-owned legacy hook with unowned host-authored regular companion and no manifest",
  ...outcome,
  hostAuthoredPreserved: current === original,
  hookConfigPreserved: (await readFile(config, "utf8")) === configBefore,
  loadedEntrypointPreserved: entrypointAfter === entrypointBefore,
  loadedEntrypointStillSymlink: (await lstat(entrypoint)).isSymbolicLink(),
  unexpectedCompanionCreated: await lstat(
    path.join(directory, "lisa-edit-gate.sh")
  )
    .then(() => true)
    .catch(() => false),
  afterCommand: { status: command.status, stdout: command.stdout },
  before_sha256: hash(original),
  after_sha256: hash(current),
  built_source_sha256: hash(await readFile("dist/codex/hooks-installer.js")),
};
await writeFile(
  ".lisa/evidence/4335/verify-host-helper-collision-results.json",
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(JSON.stringify(report, null, 2));
