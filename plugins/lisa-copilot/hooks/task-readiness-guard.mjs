/** Portable native-envelope adapter. Policy remains in the secrets preflight. */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

try {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  const root = payload.cwd ?? process.cwd();
  const event = {
    ...payload,
    hook_event_name: payload.hook_event_name ?? "PreToolUse",
  };
  // Fixed orientation is safe even before a package exists; no access is attested.
  if (
    ["Read", "Glob", "Grep", "read", "glob", "grep"].includes(
      event.tool_name
    ) ||
    (event.tool_name === "Bash" &&
      [
        "pwd",
        "git status --short",
        "git status --porcelain=v1",
        "git rev-parse HEAD",
      ].includes(event.tool_input?.command))
  ) {
    process.exitCode = 0;
  } else {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      join(here, "../skills/lisa-secrets-access/scripts"),
      join(root, "plugins/lisa/skills/lisa-secrets-access/scripts"),
      join(
        root,
        "node_modules/@codyswann/lisa/plugins/lisa/skills/lisa-secrets-access/scripts"
      ),
    ];
    const owner = candidates.find(
      dir =>
        existsSync(join(dir, "task-readiness.mjs")) &&
        existsSync(join(dir, "preflight-secrets.mjs"))
    );
    if (!owner) {
      console.error(
        "tool-missing: Update the installed Lisa readiness tool before affected work."
      );
      process.exitCode = 2;
    } else {
      const result = spawnSync(
        process.execPath,
        [
          join(owner, "preflight-secrets.mjs"),
          process.argv.includes("--observe-native")
            ? "--observe-native"
            : "--hook",
        ],
        {
          cwd: root,
          env: process.env,
          input: JSON.stringify(event),
          encoding: "utf8",
          timeout: 120000,
          killSignal: "SIGKILL",
          maxBuffer: 1024 * 1024,
        }
      );
      if (
        result.status !== 0 &&
        result.stderr?.startsWith("NATIVE_OWNER_REQUIRED: ")
      ) {
        console.error(
          "native-proof-needed: The ordinary action is withheld until required native access is proved."
        );
        process.exitCode = 2;
      } else if (result.status !== 0) {
        // Only the fixed owner result is published. Environment errors never echo.
        const safe =
          /^(?:credential-missing|provider-unreachable|capability-unreachable|bootstrap-missing|tool-missing|config-invalid|config-unreadable|config-undiscovered|config-unknown|identity-mismatch|adapter-unsupported|requirements-stale|requirements-prepared|native-proof-needed|native-response-unrepresented): [^\n]*\n?$/.test(
            result.stderr ?? ""
          );
        console.error(
          safe
            ? result.stderr.trim()
            : "tool-missing: Restore the Lisa readiness tool before affected work."
        );
        process.exitCode = 2;
      }
    }
  }
} catch {
  console.error(
    "requirements-stale: Refresh complete task requirements before affected work."
  );
  process.exitCode = 2;
}
