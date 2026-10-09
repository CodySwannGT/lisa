/** Fixed generic Rails data and original hooks contain no provider or application credentials. */
import { mkdirSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { required } from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";

const GIT = "/usr/bin/git";
const GIT_STAGE = "fixture-git";
const BUNDLE = "bundle";
const LOCKFILE = "Gemfile.lock";
const FILES = {
  Gemfile:
    'source "https://rubygems.org"\ngem "rails", "8.1.4"\ngem "mysql2", "0.5.7"\ngem "lefthook", "2.1.16"\n',
  "config/boot.rb":
    'ENV["BUNDLE_GEMFILE"] ||= File.expand_path("../Gemfile", __dir__)\nrequire "bundler/setup"\n',
  "config/application.rb":
    'require "rails"\nrequire "active_record/railtie"\nmodule RuntimeFixture\n  class Application < Rails::Application\n    config.load_defaults 8.1\n    config.eager_load = false\n    config.secret_key_base = "synthetic-owned-runtime-only"\n  end\nend\n',
  "config/environment.rb":
    'require_relative "boot"\nrequire_relative "application"\nRails.application.initialize!\n',
  "bin/rails":
    '#!/usr/bin/env ruby\nAPP_PATH = File.expand_path("../config/application", __dir__)\nrequire_relative "../config/boot"\nrequire "rails/commands"\n',
  Rakefile:
    'require_relative "config/application"\nRails.application.load_tasks\n',
  "lefthook.yml":
    "pre-commit:\n  commands:\n    four-roles:\n      run: bundle exec ruby verify-hook.rb\npre-push:\n  commands:\n    rails-runtime:\n      run: RAILS_ENV=test bundle exec rails db:prepare\n",
};

const DATABASE = `default: &default
  adapter: mysql2
  encoding: utf8mb4
  collation: utf8mb4_0900_ai_ci
  host: <%= ENV.fetch("PRIMARY_DB_HOST") %>
  port: <%= Integer(ENV.fetch("DATABASE_PORT")) %>
  username: <%= ENV.fetch("DATABASE_USER") %>
  password: <%= ENV.fetch("DATABASE_PASSWORD") %>
test:
`;
const MIGRATION =
  "class CreateRuntimeWitnesses < ActiveRecord::Migration[8.1]\n  def change\n    create_table :runtime_witnesses do |table|\n      table.string :payload, null: false\n    end\n  end\nend\n";

/**
 * Source fixture preparation creates its own lock before frozen installation; production never does this.
 * @param {string} root Owned private fixture root.
 * @param {object} tools Qualified fixed native tools and environment.
 * @param {function(string, string, object, string, Array<string>): Promise<object>} native Original supervised command recorder.
 * @returns {Promise<object>} Owned frozen fixture and measured lock digest.
 */
export async function prepareApplication(root, tools, native) {
  const cwd = join(root, "application");
  const roles = ["primary", "queue", "cache", "cable"];
  const suffixes = {
    primary: "test",
    queue: "queue_test",
    cache: "cache_test",
    cable: "cable_test",
  };
  const database =
    DATABASE +
    roles
      .map(
        role =>
          `  ${role}:\n    <<: *default\n    database: <%= ENV.fetch("DATABASE_NAME") %>_${suffixes[role]}\n    migrations_paths: db/${role}_migrate\n`
      )
      .join("");
  const hook = fileURLToPath(new URL("./verify-hook.rb", import.meta.url));
  const remote = join(root, "remote.git");
  const state = {};
  const env = {
    ...tools.env,
    BUNDLE_PATH: join(root, "ruby-dependencies"),
    BUNDLE_APP_CONFIG: join(root, BUNDLE),
    BUNDLER_VERSION: "2.4.10",
  };
  mkdirSync(cwd, { mode: 0o700 });
  for (const dir of ["config", "bin", "app", "db"])
    mkdirSync(join(cwd, dir), { mode: 0o700 });
  for (const [name, bytes] of Object.entries(FILES))
    writeFileSync(join(cwd, name), bytes, {
      flag: "wx",
      mode: name === "bin/rails" ? 0o700 : 0o600,
    });
  writeFileSync(join(cwd, "config/database.yml"), database, {
    flag: "wx",
    mode: 0o600,
  });
  for (const role of roles) {
    const dir = join(cwd, "db", `${role}_migrate`);
    mkdirSync(dir, { mode: 0o700 });
    writeFileSync(
      join(dir, "20261008000000_create_runtime_witnesses.rb"),
      MIGRATION,
      { flag: "wx", mode: 0o600 }
    );
  }
  copyFileSync(hook, join(cwd, "verify-hook.rb"));
  await native("fixture-lock", cwd, env, BUNDLE, ["lock"]);
  state.lock = readFileSync(join(cwd, LOCKFILE));
  env.BUNDLE_FROZEN = "true";
  await native("fixture-install", cwd, env, BUNDLE, [
    "install",
    "--jobs",
    "2",
    "--retry",
    "0",
  ]);
  required(
    readFileSync(join(cwd, LOCKFILE)).equals(state.lock),
    "fixture frozen lock changed"
  );
  await native(GIT_STAGE, cwd, env, GIT, ["init", "--quiet"]);
  await native(GIT_STAGE, cwd, env, GIT, [
    "config",
    "user.name",
    "Synthetic runtime fixture",
  ]);
  await native(GIT_STAGE, cwd, env, GIT, [
    "config",
    "user.email",
    "fixture@example.invalid",
  ]);
  await native(GIT_STAGE, cwd, env, GIT, [
    "add",
    "Gemfile",
    LOCKFILE,
    "config",
    "bin",
    "Rakefile",
    "lefthook.yml",
    "db",
    "verify-hook.rb",
  ]);
  await native(GIT_STAGE, cwd, env, GIT, [
    "commit",
    "--quiet",
    "-m",
    "test: establish original runtime hooks",
  ]);
  await native(GIT_STAGE, root, env, GIT, [
    "init",
    "--bare",
    "--quiet",
    remote,
  ]);
  await native(GIT_STAGE, cwd, env, GIT, ["remote", "add", "origin", remote]);
  await native("fixture-manager", cwd, env, BUNDLE, [
    "exec",
    "lefthook",
    "install",
  ]);
  return {
    cwd,
    env,
    lockSha256: createHash("sha256").update(state.lock).digest("hex"),
  };
}
