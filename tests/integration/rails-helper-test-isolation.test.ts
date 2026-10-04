/** Executable safety contract for the shared create-only Rails helper. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CreateOnlyStrategy } from "../../dist/strategies/create-only.js";
import {
  databases,
  execute,
  roles,
  sourceHash,
} from "./support/rails-helper-fixture.js";
import type { Observation } from "./support/rails-helper-fixture.js";

const root = path.resolve(".");
const helperRelative = "spec/rails_helper.rb";
const databaseRelative = "config/database.yml";
const completion = "helper-complete";
const source = path.join(root, "rails/create-only", helperRelative);
let project = "";

/**
 * Emit through the actual compiled strategy, retaining host ownership.
 * @returns Actual create-only operation result.
 */
async function emit() {
  return new CreateOnlyStrategy().apply(
    source,
    path.join(project, helperRelative),
    helperRelative,
    {
      config: {
        lisaDir: root,
        destDir: project,
        dryRun: false,
        yesMode: true,
        validateOnly: false,
        skipGitCheck: false,
        harness: "codex",
      },
      backupFile: async () => {},
      promptOverwrite: async () => true,
    }
  );
}

/**
 * A denial must precede application boot, connections and schema work.
 * @param result - Actual subprocess observation.
 * @param earliest - Require refusal before any host code.
 */
function denied(result: Observation, earliest = false): void {
  expect(result.status, result.output + JSON.stringify(result.events)).not.toBe(
    0
  );
  expect(result.output).toContain("Rails test isolation");
  expect(
    result.events.filter(event =>
      /application-boot|connection|database:|schema|helper-complete/.test(event)
    )
  ).toEqual([]);
  if (earliest) expect(result.events).toEqual([]);
}

/**
 * Successful runs must observe every positive boundary and setup component.
 * @param result - Actual subprocess observation.
 */
function accepted(result: Observation): void {
  expect(result.status, result.output).toBe(0);
  for (const event of [
    "bundler-boot",
    "spec-helper",
    "application-boot",
    "connection-spy",
    "schema-spy",
    "rspec-infer",
    "rspec-filter",
    "factory-bot",
    "rspec-configured",
    "shoulda-configured",
    completion,
  ])
    expect(result.events).toContain(event);
  expect(
    result.events.filter(event => event.startsWith("database:"))
  ).toHaveLength(4);
}

beforeEach(async () => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-rails-isolation-"));
  fs.cpSync(
    path.join(root, "tests/fixtures/rails-helper-test-isolation"),
    project,
    { recursive: true }
  );
  fs.writeFileSync(path.join(project, databaseRelative), databases());
  expect((await emit()).action).toBe("created");
  expect(sourceHash(path.join(project, helperRelative))).toBe(
    sourceHash(source)
  );
});
afterEach(() => fs.rmSync(project, { recursive: true, force: true }));

describe("actual emitted Rails test isolation", () => {
  it.each(["development", "staging", "production", "preview", "", " ", "TEST"])(
    "rejects explicit Rails %j before any boot",
    value => denied(execute(project, { RAILS_ENV: value }), true)
  );
  it.each(["development", "staging", "production", "preview", "", " ", "TEST"])(
    "rejects explicit Rack %j even with Rails test",
    value =>
      denied(execute(project, { RAILS_ENV: "test", RACK_ENV: value }), true)
  );
  it.each([
    {},
    { RAILS_ENV: "test" },
    { RACK_ENV: "test" },
    { RAILS_ENV: "test", RACK_ENV: "test" },
  ])("preserves test behavior for %j", env => accepted(execute(project, env)));
  it("normalizes missing inputs before a defined lazy Rails environment is resolved", () => {
    accepted(
      execute(
        project,
        {},
        "module Rails; def self.env; @env ||= ENV['RAILS_ENV'] || ENV['RACK_ENV'] || 'development'; end; end\n"
      )
    );
  });
  it("rejects cached non-test Rails env before boot", () =>
    denied(
      execute(
        project,
        {},
        "module Rails; def self.env; 'development'; end; end\n"
      ),
      true
    ));
  it.each(roles)("rejects unsafe %s identity before application boot", role => {
    fs.writeFileSync(path.join(project, databaseRelative), databases(role));
    denied(execute(project));
  });
  it.each([
    ["config/boot.rb", "ENV['RAILS_ENV'] = 'development'\n"],
    ["spec/spec_helper.rb", "ENV['RACK_ENV'] = 'staging'\n"],
    [
      "spec/spec_helper.rb",
      "module Rails; def self.env; 'production'; end; end\n",
    ],
  ])(
    "rejects environment changes in %s before application boot",
    (file, mutation) => {
      fs.appendFileSync(path.join(project, file), mutation);
      denied(execute(project));
    }
  );
  it.each(["replica: true", "database_tasks: false"])(
    "includes hidden configs with %s",
    flag => {
      fs.appendFileSync(
        path.join(project, databaseRelative),
        `  hidden:\n    adapter: mysql2\n    database: sample_live\n    ${flag}\n`
      );
      denied(execute(project));
    }
  );
  it.each([
    "DATABASE_URL",
    "PRIMARY_DATABASE_URL",
    "QUEUE_DATABASE_URL",
    "CACHE_DATABASE_URL",
    "CABLE_DATABASE_URL",
  ])("denies effective %s override without disclosing credentials", key => {
    const result = execute(project, {
      [key]: "mysql2://synthetic_user:synthetic_password@localhost/sample_live",
    });
    denied(result);
    expect(result.output).not.toContain("synthetic_password");
  });
  it("uses actual URL query resolution over a safe path", () =>
    denied(
      execute(project, {
        DATABASE_URL: "mysql2://localhost/sample_test?database=sample_live",
      })
    ));
  it.each([
    "",
    "test: {}\n",
    "test: []\n",
    "test:\n  adapter: mysql2\n",
    "test:\n  adapter: mysql2\n  database: latest_records\n",
    "test:\n  primary: [broken\n",
    "test: 'invalid-url'\n",
  ])("fails closed for %j", yaml => {
    fs.writeFileSync(path.join(project, databaseRelative), yaml);
    denied(execute(project));
  });
  it("fails closed when database.yml is absent", () => {
    fs.unlinkSync(path.join(project, databaseRelative));
    denied(execute(project));
  });
  it("resolves shared YAML aliases and ERB without application boot", () => {
    fs.writeFileSync(
      path.join(project, databaseRelative),
      `shared: &defaults\n  adapter: mysql2\n  database: sample_test\ntest:\n${roles
        .map(
          role =>
            `  ${role}:\n    <<: *defaults\n    database: <%= 'sample_test_${role}' %>\n`
        )
        .join("")}`
    );
    accepted(execute(project));
  });
  it("rejects an unsafe inherited shared identity", () => {
    fs.writeFileSync(
      path.join(project, databaseRelative),
      "shared:\n  adapter: mysql2\n  database: sample_live\ntest:\n  primary:\n    pool: 5\n"
    );
    denied(execute(project));
  });
  it("supports an explicit anchored host convention for every role", () => {
    fs.writeFileSync(
      path.join(project, databaseRelative),
      databases(undefined, "isolated_ci")
    );
    const convention =
      "LISA_TEST_DATABASE_NAME = /\\Aisolated_ci_(?:primary|queue|cache|cable)\\z/\n";
    accepted(execute(project, {}, convention));
    fs.writeFileSync(
      path.join(project, databaseRelative),
      databases("queue", "isolated_ci")
    );
    denied(execute(project, {}, convention));
  });
  it("accepts conventional SQLite paths", () => {
    fs.writeFileSync(
      path.join(project, databaseRelative),
      `test:\n${roles
        .map(
          role =>
            `  ${role}:\n    adapter: sqlite3\n    database: storage/test_${role}.sqlite3\n`
        )
        .join("")}`
    );
    accepted(execute(project));
  });
  it("resolves role-specific shared defaults", () => {
    const defaults = roles
      .map(
        role =>
          `  ${role}:\n    adapter: mysql2\n    database: sample_test_${role}\n`
      )
      .join("");
    const configs = roles.map(role => `  ${role}:\n    pool: 5\n`).join("");
    fs.writeFileSync(
      path.join(project, databaseRelative),
      `shared:\n${defaults}test:\n${configs}`
    );
    accepted(execute(project));
  });
  it.each(["database", "environment"])(
    "rejects late %s changes before schema maintenance",
    change => {
      const mutation =
        change === "database"
          ? "ActiveRecord::Base.configurations = { 'test' => { 'adapter' => 'mysql2', 'database' => 'sample_live' } }\n"
          : "Rails.instance_variable_set(:@env, ActiveSupport::StringInquirer.new('production'))\n";
      fs.appendFileSync(path.join(project, "config/environment.rb"), mutation);
      const result = execute(project);
      expect(result.status, result.output).not.toBe(0);
      expect(result.events).toContain("application-boot");
      expect(result.events).not.toContain("schema-spy");
      expect(result.events).not.toContain(completion);
    }
  );
  it("rejects invalid naming configuration and test only in a directory", () => {
    denied(execute(project, {}, "LISA_TEST_DATABASE_NAME = true\n"));
    fs.writeFileSync(
      path.join(project, databaseRelative),
      "test:\n  adapter: sqlite3\n  database: test/sample_live.sqlite3\n"
    );
    denied(execute(project));
  });
  it("accepts safe URL identities and denies decoded unsafe queries", () => {
    accepted(
      execute(project, {
        DATABASE_URL: "mysql2://localhost/sample_test_primary",
      })
    );
    denied(
      execute(project, {
        DATABASE_URL: "mysql2://localhost/sample_test?database=sample%5Flive",
      })
    );
  });
  it("preserves modified host-owned bytes on repeated apply", async () => {
    const destination = path.join(project, helperRelative);
    const sentinel = `${fs.readFileSync(
      destination,
      "utf8"
    )}\n# Host customization sentinel\n`;
    fs.writeFileSync(destination, sentinel);
    expect((await emit()).action).toBe("skipped");
    expect(fs.readFileSync(destination, "utf8")).toBe(sentinel);
  });
  it("proves the positive witness rejects missing completion", () => {
    const result = execute(project);
    accepted(result);
    expect(() =>
      accepted({
        ...result,
        events: result.events.filter(event => event !== completion),
      })
    ).toThrow();
  });
});
