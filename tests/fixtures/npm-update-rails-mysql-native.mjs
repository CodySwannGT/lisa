/** Generic emulated Linux runtime fixture; no hosted/provider/issuer acceptance. */
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  readJson,
  writeJson,
  runProcess,
} from "../../all/copy-overwrite/scripts/lib/npm-update-process-core.mjs";
import { required } from "../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import {
  runtimeTime,
  assertDockerQualified,
} from "../../all/copy-overwrite/scripts/lib/npm-update-rails-tool-identity.mjs";
import { openRailsMysqlRuntime } from "../../all/copy-overwrite/scripts/lib/npm-update-rails-mysql.mjs";
import { observeMysqlFailure } from "./npm-update-rails-mysql-observation.mjs";

const descriptor = readJson(process.argv[2], 65536);
const { root, deadline, docker } = descriptor;
const sourceNames = Object.keys(descriptor.sourcePins);
required(
  sourceNames.length >= 7 &&
    sourceNames.every(
      name =>
        /^[a-zA-Z0-9_./-]+\.mjs$/.test(name) &&
        !name.split("/").includes("..") &&
        createHash("sha256")
          .update(readFileSync(join("/proof/source", name)))
          .digest("hex") === descriptor.sourcePins[name]
    ),
  "executed frozen source snapshot differs"
);
required(
  process.platform === "linux" && process.arch === "x64",
  "native fixture process must actually be Linux AMD64"
);
const env = {
  PATH: "/proof/tools/node/bin:/proof/tools:/proof/bootstrap-gems/bin:/usr/local/bin:/usr/bin:/bin",
  HOME: "/proof/home",
  TMPDIR: join(root, "tmp"),
  GEM_HOME: "/proof/bootstrap-gems",
  GEM_PATH: "/proof/bootstrap-gems:/usr/local/bundle",
  BUNDLE_PATH: "/proof/gems",
  BUNDLE_APP_CONFIG: "/proof/bundle-config",
  BUNDLE_FROZEN: "true",
  BUNDLER_VERSION: "2.4.10",
};
const profile = {
  profile: "rails-mysql",
  database: "lisa_runtime",
  browser: false,
  dockerFixtures: false,
};
const physical = String.raw`
require "mysql2"
require "json"
observations = %w[test queue_test cache_test cable_test].map do |role|
  name = "#{ENV.fetch("DATABASE_NAME")}_#{role}"
  client = Mysql2::Client.new(host: ENV.fetch("PRIMARY_DB_HOST"), port: Integer(ENV.fetch("DATABASE_PORT")), username: ENV.fetch("DATABASE_USER"), password: ENV.fetch("DATABASE_PASSWORD"), database: name)
  raise "wrong physical schema" unless client.query("SELECT DATABASE() AS name").first.fetch("name") == name
  client.query("INSERT INTO runtime_witnesses(payload) VALUES ('synthetic-owned-runtime')")
  raise "wrong actual row" unless client.query("SELECT payload FROM runtime_witnesses").to_a == [{"payload" => "synthetic-owned-runtime"}]
  denied = false
  begin
    client.query("SELECT User FROM mysql.user")
  rescue Mysql2::Error => error
    denied = error.error_number == 1142
  end
  raise "administrator access was not refused" unless denied
  client.close
  {role: role, actual_rows: 1, administrator_read_denied: denied}
end
puts JSON.generate(observations)
`;

const report = {
  scope:
    "actual generic LinuxAMD64 original hook/runtime on an emulated Docker daemon; no hosted qualification",
  process: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  },
  prepare: false,
  originalHook: false,
  physicalRoles: [],
  closed: false,
  sourceSnapshotParity: true,
  sourceMembers: sourceNames.length,
};
const operation = { runtime: null, failure: null };
const applicationCwd = "/proof/case";
try {
  await assertDockerQualified(docker, deadline);
  operation.runtime = await openRailsMysqlRuntime(
    { cwd: applicationCwd, root, deadline, profile, docker },
    env
  );
  await operation.runtime.prepareSchemas();
  report.prepare = operation.runtime.receipt.prepared;
  const observed = await runProcess(
    "bundle",
    ["exec", "ruby", "-e", physical],
    {
      cwd: applicationCwd,
      env: operation.runtime.env,
      timeout: runtimeTime(deadline, 1800000),
      maximum: 65536,
    }
  );
  report.physicalRoles = JSON.parse(observed.stdout.toString());
  required(
    report.physicalRoles.length === 4 &&
      report.physicalRoles.every(
        value =>
          value.actual_rows === 1 && value.administrator_read_denied === true
      ),
    "actual four-role observations differ"
  );
  const hook = await runProcess(
    "git",
    ["push", "origin", "HEAD:refs/heads/main"],
    {
      cwd: applicationCwd,
      env: operation.runtime.env,
      timeout: runtimeTime(deadline, 1800000),
      maximum: 3145728,
    }
  );
  report.originalHook = hook.code === 0;
  report.originalHookCapture = {
    stdoutBytes: hook.stdout.length,
    stderrBytes: hook.stderr.length,
    stdoutSha256: createHash("sha256").update(hook.stdout).digest("hex"),
    stderrSha256: createHash("sha256").update(hook.stderr).digest("hex"),
  };
  report.service = {
    image: operation.runtime.receipt.image,
    imageId: operation.runtime.receipt.imageId,
    port: operation.runtime.receipt.port,
  };
} catch (error) {
  operation.failure = error;
  report.failure = {
    category: error.constructor.name,
    status: Number.isInteger(error.code) ? error.code : null,
    observation: observeMysqlFailure(error),
  };
} finally {
  if (operation.runtime) {
    try {
      await operation.runtime.close();
      report.closed = operation.runtime.receipt.closed;
    } catch (error) {
      report.cleanupFailure = {
        category: error.constructor.name,
        status: Number.isInteger(error.code) ? error.code : null,
        observation: observeMysqlFailure(error),
      };
      operation.failure ??= error;
    }
  }
  writeJson(descriptor.report, report);
}
if (
  operation.failure ||
  !report.prepare ||
  !report.originalHook ||
  !report.closed
)
  process.exitCode = 1;
