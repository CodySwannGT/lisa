/** Real emitted Ruby execution with the ticket-authorized application spies. */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** Captured executable behavior, independent of a success exit alone. */
export interface Observation {
  status: number | null;
  output: string;
  events: string[];
}

export const roles = ["primary", "queue", "cache", "cable"] as const;

/**
 * Render four configured identities with optional one-role poisoning.
 * @param poison - Role receiving a non-test identity.
 * @param identity - Prefix for isolated names.
 * @returns YAML for four roles.
 */
export function databases(poison?: string, identity = "sample_test"): string {
  const names = roles.map(role => ({
    role,
    name: role === poison ? "sample_live" : `${identity}_${role}`,
  }));
  return `test:\n${names
    .map(
      ({ role, name }) =>
        `  ${role}:\n    adapter: mysql2\n    database: ${name}\n`
    )
    .join("")}`;
}

/**
 * Compare exact emitted and source bytes, with hashes visible in diagnostics.
 * @param file - File whose actual bytes are hashed.
 * @returns SHA256 digest.
 */
export function sourceHash(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * Execute the helper without inheriting ambient database URLs or Rails state.
 * @param project - Owned generated fixture directory.
 * @param env - Explicit test inputs.
 * @param preload - Trusted host-owned naming or cached Rails state.
 * @returns Exit, diagnostics and reached markers.
 */
export function execute(
  project: string,
  env: Record<string, string> = {},
  preload = ""
): Observation {
  const childEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !["RAILS_ENV", "RACK_ENV", "RUBYOPT", "BUNDLE_GEMFILE"].includes(key) &&
        !key.endsWith("DATABASE_URL")
    )
  );
  const result = boundedSpawnSync({
    command: "ruby",
    args: ["-I.", "-Ispec", "-r", "./preload.rb", "runner.rb"],
    cwd: prepare(project, preload),
    env: { ...childEnv, ...env },
    label: "emitted Rails helper Ruby",
  });
  const events = fs.existsSync(path.join(project, "events"))
    ? fs.readFileSync(path.join(project, "events"), "utf8").trim().split("\n")
    : [];
  return {
    status: result.status,
    output: result.stdout + result.stderr,
    events,
  };
}

/**
 * Prepare owned Ruby inputs before starting the executable observation.
 * @param project - Owned fixture directory.
 * @param preload - Trusted preloaded configuration.
 * @returns The prepared working directory.
 */
function prepare(project: string, preload: string): string {
  fs.writeFileSync(path.join(project, "preload.rb"), preload);
  fs.writeFileSync(
    path.join(project, "runner.rb"),
    "require_relative 'spec/rails_helper'\nFile.open('events', 'a') { |file| file.puts 'helper-complete' }\n"
  );
  fs.rmSync(path.join(project, "events"), { force: true });
  return project;
}
