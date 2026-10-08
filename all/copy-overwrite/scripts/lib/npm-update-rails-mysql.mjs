// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** The one authenticated Rails profile uses exactly four fixed test databases. */
import { realpathSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { required } from "./npm-update-contract.mjs";
import { runtimeSchemas } from "./npm-update-rails-runtime-contract.mjs";
import { runtimeTime } from "./npm-update-rails-tool-identity.mjs";
import { runProcess } from "./npm-update-process-core.mjs";
import {
  openMysqlResource,
  assertMysqlRoot,
  mysqlFailure,
} from "./npm-update-rails-mysql-resource.mjs";

const APPLICATION_KEYS = new Set([
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TZ",
  "TMPDIR",
  "TMP",
  "TEMP",
  "NPM_CONFIG_USERCONFIG",
  "NPM_CONFIG_GLOBALCONFIG",
  "NPM_CONFIG_CACHE",
  "NPM_CONFIG_REGISTRY",
  "NPM_CONFIG_AUDIT",
  "NPM_CONFIG_FUND",
  "NPM_CONFIG_UPDATE_NOTIFIER",
  "NPM_CONFIG_IGNORE_SCRIPTS",
  "GIT_TERMINAL_PROMPT",
  "BUNDLE_PATH",
  "BUNDLE_APP_CONFIG",
  "BUNDLE_FROZEN",
  "BUNDLER_VERSION",
  "BUNDLE_SILENCE_ROOT_WARNING",
  "GEM_HOME",
  "GEM_PATH",
]);

/** Readiness is a real authenticated SQL query; query refusal never becomes ready. */
async function waitReady(resource, deadline) {
  for (;;) {
    runtimeTime(deadline);
    try {
      required(
        (await resource.query("SELECT 1, @@partial_revokes;\n")) === "1\t1\n",
        "MySQL fixed privilege mode differs"
      );
      return;
    } catch (error) {
      if (error.code === null || error.code === undefined) throw error;
      runtimeTime(deadline);
      await new Promise(resolve =>
        setTimeout(resolve, Math.min(200, runtimeTime(deadline)))
      );
    }
  }
}

/** Only local schema privileges are granted; underscores are literal under the checked fixed mode. */
function grantSql(schemas, user, password) {
  const statements = [
    `CREATE USER '${user}'@'%' IDENTIFIED BY '${password}';`,
    ...schemas.flatMap(name => [
      `CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;`,
      `GRANT ALL PRIVILEGES ON \`${name}\`.* TO '${user}'@'%';`,
    ]),
  ];
  return `${statements.join("\n")}\n`;
}

/** The least-privilege account, not administrator metadata alone, reaches every role. */
async function verifySchemas(resource, schemas, user) {
  const grants = (
    await resource.query("SHOW GRANTS FOR CURRENT_USER();\n", true)
  )
    .trim()
    .split("\n");
  const account = `\`${user}\`@\`%\``;
  const expected = [
    `GRANT USAGE ON *.* TO ${account}`,
    ...schemas.map(
      name => `GRANT ALL PRIVILEGES ON \`${name}\`.* TO ${account}`
    ),
  ].sort();
  required(
    grants.sort().join("\n") === expected.join("\n"),
    "MySQL account schema privileges differ"
  );
  const selected = schemas.map(name => `'${name}'`).join(",");
  const rows = await resource.query(
    `SELECT SCHEMA_NAME, DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (${selected}) ORDER BY SCHEMA_NAME;\n`,
    true
  );
  required(
    rows.trim().split("\n").sort().join("\n") ===
      schemas
        .map(name => `${name}\tutf8mb4\tutf8mb4_0900_ai_ci`)
        .sort()
        .join("\n"),
    "MySQL four-schema readback differs"
  );
  for (const name of schemas)
    required(
      (await resource.query(`USE \`${name}\`; SELECT 1;\n`, true)) === "1\n",
      "MySQL role access readback differs"
    );
}

/** Empty administrator-created databases cannot masquerade as Rails schema preparation. */
async function verifyPreparedSchemas(resource, schemas) {
  const selected = schemas.map(name => `'${name}'`).join(",");
  const rows = await resource.query(
    `SELECT TABLE_SCHEMA, TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA IN (${selected}) AND TABLE_NAME IN ('ar_internal_metadata','schema_migrations') ORDER BY TABLE_SCHEMA, TABLE_NAME;\n`,
    true
  );
  const expected = schemas
    .flatMap(name =>
      ["ar_internal_metadata", "schema_migrations"].map(
        table => `${name}\t${table}`
      )
    )
    .sort();
  required(
    rows.trim().split("\n").sort().join("\n") === expected.join("\n"),
    "MySQL prepared four-schema metadata differs"
  );
}

/** Caller-authenticated profile and frozen Bundler must precede this fixed resource lifecycle. */
export async function openRailsMysqlRuntime(
  { cwd, root, deadline, profile, docker },
  env
) {
  const schemas = runtimeSchemas({ runtime: profile });
  runtimeTime(deadline);
  assertMysqlRoot(root);
  required(realpathSync(cwd) === cwd, "MySQL application cwd is aliased");
  required(
    env &&
      Object.keys(env).every(name => APPLICATION_KEYS.has(name)) &&
      Object.values(env).every(value => typeof value === "string") &&
      env.BUNDLE_FROZEN === "true",
    "MySQL application environment is not closed frozen Bundler data"
  );
  required(
    env.BUNDLER_VERSION === "2.4.10",
    "MySQL Bundler version is not qualified"
  );
  const user = `lisa_${randomBytes(12).toString("hex")}`;
  const password = randomBytes(32).toString("hex");
  const resource = await openMysqlResource({
    root,
    deadline,
    docker,
    user,
    password,
  });
  let prepared = false;
  const environment = Object.freeze({
    ...env,
    DATABASE_NAME: profile.database,
    DATABASE_USER: user,
    DATABASE_PASSWORD: password,
    DATABASE_PORT: resource.state.port,
    PRIMARY_DB_HOST: "127.0.0.1",
    DATABASE_REPLICA_HOST: "127.0.0.1",
    DATABASE_SSL: "false",
    DATABASE_IAM_AUTH: "false",
    RAILS_ENV: "test",
    RACK_ENV: "test",
  });
  try {
    await waitReady(resource, deadline);
    await resource.query(grantSql(schemas, user, password));
    await verifySchemas(resource, schemas, user);
  } catch (error) {
    try {
      await resource.close();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        "MySQL readiness and cleanup failed",
        { cause: error }
      );
    }
    throw error;
  }
  return {
    env: environment,
    async prepareSchemas() {
      required(!resource.state.closed, "MySQL runtime is closed");
      try {
        await runProcess("bundle", ["exec", "rails", "db:prepare"], {
          cwd,
          env: environment,
          timeout: runtimeTime(deadline, 1800000),
          maximum: 3145728,
        });
      } catch (error) {
        throw mysqlFailure(error, "Rails prepare");
      }
      await verifySchemas(resource, schemas, user);
      await verifyPreparedSchemas(resource, schemas);
      prepared = true;
    },
    close: resource.close,
    get receipt() {
      return Object.freeze({
        ...resource.state,
        schemas: [...schemas],
        prepared,
      });
    },
  };
}
