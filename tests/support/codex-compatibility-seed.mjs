/** Materialize the exact saved command fixture before migration. */
import { mkdir, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { installHooks } from "../../dist/codex/hooks-installer.js";
import {
  candidate,
  host,
  evidence,
  saved,
  commands,
  output,
  run,
  INSTALLED_LISA,
} from "./codex-compatibility-state.mjs";
/** Seed one anonymous supported-stack host and save its loaded commands. */
export async function seedCompatibilityHost() {
  await output(
    "package.json",
    JSON.stringify({
      name: "anonymous-host",
      version: "1.0.0",
      private: true,
      devDependencies: { "@codyswann/lisa": "4.68.0" },
    })
  );
  await output(
    ".lisa.config.json",
    JSON.stringify({
      harness: "codex",
      tracker: "github",
      github: { org: "example", repo: "host-app" },
      deploy: { branches: { production: "main" } },
    })
  );
  await output("Gemfile", 'source "https://rubygems.org"\ngem "rails"\n');
  await output(
    "config/application.rb",
    "# anonymous supported Rails fixture\n"
  );
  await output("sample.rb", "puts 'anonymous fixture'\n");
  await mkdir(path.join(host, "node_modules/@codyswann"), { recursive: true });
  await symlink(candidate, path.join(host, INSTALLED_LISA), "dir");
  await installHooks(candidate, host, ["rails"]);
  for (const command of commands) {
    const destination = path.join(
      host,
      ".codex/hooks/lisa",
      `${command.id}.sh`
    );
    await unlink(destination);
    await symlink(
      path.join(
        host,
        "node_modules/@codyswann/lisa/dist/codex/scripts",
        `${command.id}.sh`
      ),
      destination
    );
  }
  saved.hooks.PreToolUse.unshift({
    matcher: "Bash",
    hooks: [{ type: "command", command: "printf host-handler-preserved" }],
  });
  await output(".codex/hooks.json", JSON.stringify(saved));
  await output(
    ".codex/hooks/lisa/host-check.sh",
    "#!/bin/sh\nprintf host-owned\n",
    0o755
  );
  await writeFile(
    path.join(evidence, "green-saved-commands.json"),
    `${JSON.stringify(commands, null, 2)}\n`
  );
  run("git", ["init", "--initial-branch=main"]);
  run("git", ["add", "sample.rb"]);
}
