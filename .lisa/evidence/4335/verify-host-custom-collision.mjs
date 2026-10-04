/** Exercise preservation of an unowned customized catalog-name hook. */
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { installHookCompatibility } from "../../../dist/codex/hooks-installer.js";
const host = await mkdtemp(
  path.join(tmpdir(), "lisa-4335-verify-host-custom-")
);
const file = path.join(host, ".codex/hooks/lisa/block-no-verify.sh");
await mkdir(path.dirname(file), { recursive: true });
const original =
  "#!/usr/bin/env bash\n# Lisa-managed Codex hook script\n# Host-authored customized behavior; no manifest or Lisa-tagged handler.\necho HOST_CUSTOM_MARKER\n";
await writeFile(file, original);
const beforeCommand = spawnSync("/bin/bash", [file], { encoding: "utf8" });
await writeFile(
  path.join(host, ".codex/hooks.json"),
  JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command:
                'bash "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.codex/hooks/lisa/block-no-verify.sh"',
            },
          ],
        },
      ],
    },
  })
);
const managed = await installHookCompatibility(process.cwd(), host, [], []);
const current = await readFile(file, "utf8");
const afterCommand = spawnSync("/bin/bash", [file], { encoding: "utf8" });
const hash = value => createHash("sha256").update(value).digest("hex");
const report = {
  captured_at: new Date().toISOString(),
  probe: "current built installHookCompatibility",
  scenario:
    "Host-authored untagged catalog-name regular file retains original Lisa header, with no ownership manifest",
  managed,
  hostAuthoredPreserved: current === original,
  markerPreserved: current.includes("HOST_CUSTOM_MARKER"),
  beforeCommand: { status: beforeCommand.status, stdout: beforeCommand.stdout },
  afterCommand: { status: afterCommand.status, stdout: afterCommand.stdout },
  before_sha256: hash(original),
  after_sha256: hash(current),
  built_source_sha256: hash(await readFile("dist/codex/hooks-installer.js")),
};
await writeFile(
  ".lisa/evidence/4335/verify-host-custom-collision-results.json",
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(JSON.stringify(report, null, 2));
