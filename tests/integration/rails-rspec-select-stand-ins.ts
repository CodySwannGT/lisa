/**
 * The stand-in `bundle` and `gh` executables for the Rails push-time
 * spec-selection fixture (CodySwannGT/lisa#4612). See
 * rails-rspec-select-fixture.ts for what each one records and plays.
 * @module tests/integration/rails-rspec-select-stand-ins
 */

/** The stand-in `bundle`. */
export const FAKE_BUNDLE = `#!/usr/bin/env node
const { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const argv = process.argv.slice(2);
appendFileSync(".bundle-calls", JSON.stringify(argv) + "\\n");
const dir = process.env.LISA_RSPEC_PARTIAL_COVERAGE_DIR;
const partialRun = argv.some(arg => arg.endsWith("lisa_rspec_partial_coverage.rb"));
if (dir && partialRun && !existsSync("handoff-silent")) {
  mkdirSync(dir, { recursive: true });
  if (existsSync("handoff-unavailable")) {
    writeFileSync(join(dir, "status.json"), JSON.stringify({ measuring: true, escalate: "this SimpleCov has no finalize_merge" }));
    process.exit(1);
  }
  if (existsSync("coverage.json")) {
    const raw = JSON.parse(readFileSync("coverage.json", "utf8"));
    const coverage = Object.fromEntries(Object.entries(raw).map(([file, lines]) => [resolve(file), { lines, branches: {} }]));
    writeFileSync(join(dir, ".resultset.json"), JSON.stringify({ "Lisa partial push run": { coverage } }));
    writeFileSync(join(dir, "status.json"), JSON.stringify({ measuring: true }));
  } else {
    writeFileSync(join(dir, "status.json"), JSON.stringify({ measuring: false }));
  }
}
if (!partialRun && existsSync("whole-coverage.fail")) process.exit(1);
process.exit(argv.some(arg => arg.includes("failing")) ? 1 : 0);
`;

/** The stand-in `gh`. */
export const FAKE_GH = `#!/usr/bin/env node
const { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const argv = process.argv.slice(2);
appendFileSync(".gh-calls", JSON.stringify(argv) + "\\n");
if (argv[0] === "api") {
  process.stdout.write(existsSync("gh-artifacts.ndjson") ? readFileSync("gh-artifacts.ndjson", "utf8") : "");
  process.exit(0);
}
if (argv[0] === "run" && argv[1] === "download") {
  const dir = argv[argv.indexOf("--dir") + 1];
  const names = argv.flatMap((arg, i) => (arg === "--name" ? [argv[i + 1]] : []));
  for (const name of names) {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, "map.json"), readFileSync("gh-map.json", "utf8"));
  }
  process.exit(0);
}
process.exit(1);
`;
