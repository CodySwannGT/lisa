#!/usr/bin/env node
/**
 * Fleet enforcement census — re-measures how many host checkouts resolve a
 * Lisa enforcement guard, and reports it.
 *
 * The per-session staleness notice in `scripts/lisa-enforcement-fallback.sh`
 * tells THIS session about THIS checkout, which is right and is not the gap.
 * The gap is that nobody was looking at the fleet, so the only fleet-wide
 * number that ever existed was taken by hand and frozen in a comment
 * (CodySwannGT/lisa#3490). This runs the measurement again, every time.
 *
 * Two properties it must keep:
 *
 *   - It REPORTS. Its exit status is 0 for every finding about the fleet,
 *     including a fleet where every checkout is stale. A census that could
 *     redden someone's build would be routed around.
 *   - It keeps "resolves nothing" apart from "resolves something old". They are
 *     different failures with different remedies, and folding them loses the
 *     serious half.
 *
 * Usage:
 *   node scripts/lisa-enforcement-census.mjs [options]
 *
 * Options:
 *   --roster <path>    Roster file (default: .lisa.workspaces.json beside this repo)
 *   --scan <dir>       Also discover checkouts under <dir>. Repeatable.
 *   --depth <n>        How deep --scan descends (default 2)
 *   --reference <ver>  Compare against this version instead of the newest found
 *   --redact           Replace real paths with stable anonymous labels
 *   --json             Emit the measured fleet as JSON
 *
 * Exit status: 0 for every fleet finding. 1 only when an explicitly named
 * roster cannot be read, and 2 for a usage error — both are failures of the
 * census's own inputs, never findings about the fleet.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const census = await import(
  path.join(repoRoot, "dist", "core", "enforcement-census.js")
).catch(error => {
  process.stderr.write(
    `Could not load the census from dist/. Run \`bun run build:dist\` first.\n${error.message}\n`
  );
  process.exit(2);
});
const report = await import(
  path.join(repoRoot, "dist", "core", "enforcement-census-report.js")
);

const options = {
  roster: null,
  scans: [],
  depth: 2,
  reference: null,
  redact: false,
  json: false,
};

const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  const flag = argv[index];
  const value = argv[index + 1];
  // A value-taking flag left at the end of the line has no value. Assigning
  // `undefined` there silently falls back to the default roster or drops the
  // requested setting, so the run measures something other than what was
  // asked for and says nothing about it — a census reporting the wrong fleet
  // is worse than one that refuses. This is the census's own input being
  // wrong, so it exits 2 like any other usage error and never as a finding.
  const VALUE_FLAGS = ["--roster", "--scan", "--depth", "--reference"];
  if (VALUE_FLAGS.includes(flag) && value === undefined) {
    process.stderr.write(`${flag} requires a value\n`);
    process.exit(2);
  }
  if (flag === "--roster") {
    options.roster = value;
    index += 1;
  } else if (flag === "--scan") {
    options.scans.push(value);
    index += 1;
  } else if (flag === "--depth") {
    options.depth = Number.parseInt(value ?? "", 10);
    index += 1;
  } else if (flag === "--reference") {
    options.reference = value;
    index += 1;
  } else if (flag === "--redact") {
    options.redact = true;
  } else if (flag === "--json") {
    options.json = true;
  } else if (flag === "--help" || flag === "-h") {
    process.stdout.write(
      "Usage: node scripts/lisa-enforcement-census.mjs [--roster <path>] [--scan <dir>] [--depth <n>] [--reference <ver>] [--redact] [--json]\n"
    );
    process.exit(0);
  } else {
    process.stderr.write(`Unknown option: ${flag}\n`);
    process.exit(2);
  }
}

if (!Number.isInteger(options.depth) || options.depth < 0) {
  process.stderr.write("--depth must be a non-negative integer\n");
  process.exit(2);
}

const rosterPath =
  options.roster ?? path.join(repoRoot, census.DEFAULT_ROSTER_FILE);
const rosterEntries = await census.readFleetRoster(rosterPath);

// An explicitly named roster that cannot be read is an input error, not a
// finding: the operator asked for a specific file and did not get it. A missing
// DEFAULT roster is neither — this repository is simply not a fleet hub — so it
// reports an empty fleet and still exits 0.
if (rosterEntries === null && options.roster !== null) {
  process.stderr.write(`Could not read the roster: ${rosterPath}\n`);
  process.exit(1);
}

const scanned = (
  await Promise.all(
    options.scans.map(directory =>
      census.scanForCheckouts(directory, options.depth)
    )
  )
).flat();

const roster = await census.dedupeRoster([
  ...(rosterEntries ?? []),
  ...scanned,
]);

const origins = [
  rosterEntries === null ? null : rosterPath,
  ...options.scans.map(directory => `scan of ${directory}`),
].filter(Boolean);

const seedVersion = await import(path.join(repoRoot, "package.json"), {
  with: { type: "json" },
})
  .then(module => module.default.version ?? null)
  .catch(() => null);

const measured = await census.runFleetCensus({
  roster,
  rosterOrigin: origins.length === 0 ? "no roster found" : origins.join(" + "),
  seedVersion,
  reference: options.reference,
});

const output = options.redact ? report.redactCensus(measured) : measured;

process.stdout.write(
  options.json
    ? `${JSON.stringify(output, null, 2)}\n`
    : report.renderFleetCensusReport(output)
);

// Unconditional. Nothing above may change it.
//
// Set rather than called: `process.exit()` tears the process down synchronously
// and can drop a pending `process.stdout.write` when stdout is a pipe, which is
// exactly how this is read — piped to a pager, a file, or a scheduled loop's
// log. A truncated census reports a smaller fleet than it measured, silently.
process.exitCode = 0;
