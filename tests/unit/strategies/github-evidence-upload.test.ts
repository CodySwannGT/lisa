/** Execute the documented evidence upload against GitHub CLI filename semantics. */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();

const relativeSkill = "skills/lisa-github-evidence/SKILL.md";
const variants = [
  "plugins/src/base",
  "plugins/lisa",
  "plugins/lisa/.codex-plugin",
  "plugins/lisa-cursor",
  "plugins/lisa-agy",
  "plugins/lisa-copilot",
  "plugins/lisa-devin",
];
const skill = readFileSync(path.join(variants[0]!, relativeSkill), "utf8");
const roots: string[] = [];
const HEALTH_CONTENT = '{"ok":true}\n';
const VALID_ASSET_NAME = "pr-123-01-health-check.json";
const FIRST_ASSET_NAME = "pr-123-01-health.json";
const INPUT_FILE_NAME = "01-health.json";
const PRIOR_ASSET_NAME = "pr-123-01-health.check.json";
const PRIOR_CONTENT = "existing evidence\n";
const HEALTH_CHECK_FILE = "01-health-check.json";
/** A rotated evidence release, as step 2's `evidence-release --ensure` prints. */
const ROTATED_RELEASE = "pr-assets-2026-11";

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * Read the actual upload block, changing only repository placeholders.
 * @returns The shipped Bash upload block with fixture repository coordinates.
 */
function uploadSnippet(): string {
  const heading = skill.indexOf("3. **Upload each evidence file**");
  const start = skill.indexOf("```bash\n", heading) + "```bash\n".length;
  const end = start + skill.slice(start).search(/\n[ \t]*```/);
  expect(heading).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return skill
    .slice(start, end)
    .replaceAll("<impl-org>/<impl-repo>", "fixture/evidence");
}

/**
 * A controlled provider preserves the real CLI's basename/display-label split.
 * @returns Owned paths for the evidence, provider, staging and upload log.
 */
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-evidence-upload-"));
  const evidence = path.join(root, "evidence files");
  const store = path.join(root, "release");
  const scratch = path.join(root, "scratch");
  const log = path.join(root, "uploads.jsonl");
  const command = path.join(root, "gh");
  const script = path.join(root, "upload.sh");
  roots.push(root);
  for (const directory of [evidence, store, scratch]) mkdirSync(directory);
  writeFileSync(log, "");
  writeFileSync(
    command,
    `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] !== "release") process.exit(77);
if (args[2] !== process.env.RELEASE) process.exit(79);
if (args[1] === "upload") {
  const [file, label = ""] = args.at(-1).split("#");
  const name = path.basename(file).replaceAll(" ", ".");
  if (process.env.EVIDENCE_FAILURE === "upload" && name.includes("01-")) process.exit(7);
  fs.copyFileSync(file, path.join(process.env.EVIDENCE_STORE, name));
  fs.appendFileSync(process.env.EVIDENCE_LOG, JSON.stringify({name,label})+"\\n");
} else if (args[1] === "view") {
  if (process.env.EVIDENCE_FAILURE === "view") process.exit(8);
  let names = fs.readdirSync(process.env.EVIDENCE_STORE);
  if (process.env.EVIDENCE_FAILURE === "missing") names = [];
  if (process.env.EVIDENCE_FAILURE === "lookalike") names = names.map(name => name.replace(".", "X"));
  if (names.length) console.log(names.join("\\n"));
} else process.exit(77);
`
  );
  chmodSync(command, 0o755);
  writeFileSync(script, uploadSnippet());
  return { root, evidence, store, scratch, log, script };
}

/**
 * Execute the skill exactly as a caller would, with bounded process ownership.
 * @param value - Owned provider and evidence paths.
 * @param pr - Pull request whose evidence is uploaded.
 * @param failure - Optional provider failure to exercise.
 * @param release - The evidence release step 2 resolved, or none.
 * @returns Native shell completion and captured diagnostics.
 */
function runUpload(
  value: ReturnType<typeof fixture>,
  pr: number,
  failure = "",
  release: string | undefined = ROTATED_RELEASE
) {
  return boundedSpawnSync({
    label: "shipped GitHub evidence upload",
    command: "/bin/bash",
    args: [value.script],
    cwd: value.root,
    env: {
      ...process.env,
      PATH: `${value.root}:${process.env.PATH}`,
      TMPDIR: value.scratch,
      EVIDENCE_DIR: value.evidence,
      PR_NUMBER: String(pr),
      EVIDENCE_STORE: value.store,
      EVIDENCE_LOG: value.log,
      EVIDENCE_FAILURE: failure,
      EVIDENCE_POST_MARKER: path.join(value.root, "posted.txt"),
      RELEASE: release,
    },
  });
}

describe("documented GitHub evidence upload", () => {
  it("uploads to the release step 2 resolved, and refuses to guess one", () => {
    const value = fixture();
    writeFileSync(path.join(value.evidence, HEALTH_CHECK_FILE), HEALTH_CONTENT);
    const unresolved = runUpload(value, 123, "", "");
    expect(unresolved.status).not.toBe(0);
    expect(unresolved.stderr).toContain("Resolve the evidence release");
    expect(readdirSync(value.store)).toEqual([]);
    const result = runUpload(value, 123);
    expect(result.status, result.stderr).toBe(0);
    expect(readdirSync(value.store)).toEqual([VALID_ASSET_NAME]);
  });

  it.each(variants)(
    "%s never uses a display label to name an asset",
    directory => {
      const text = readFileSync(path.join(directory, relativeSkill), "utf8");
      const commands = text.match(/gh release upload[^\n]*(?:\\\n[^\n]*)*/g);
      expect(commands).not.toBeNull();
      expect(commands!.join("\n")).not.toContain("#");
    }
  );

  it("stores the prefixed name, preserves source bytes and leaves no display label", () => {
    const value = fixture();
    writeFileSync(path.join(value.evidence, HEALTH_CHECK_FILE), HEALTH_CONTENT);
    const result = runUpload(value, 123);
    expect(result.status, result.stderr).toBe(0);
    expect(readdirSync(value.store)).toEqual([VALID_ASSET_NAME]);
    expect(readFileSync(path.join(value.store, VALID_ASSET_NAME), "utf8")).toBe(
      HEALTH_CONTENT
    );
    expect(JSON.parse(readFileSync(value.log, "utf8"))).toEqual({
      name: VALID_ASSET_NAME,
      label: "",
    });
    expect(
      readFileSync(path.join(value.evidence, HEALTH_CHECK_FILE), "utf8")
    ).toBe(HEALTH_CONTENT);
    expect(readdirSync(value.scratch)).toEqual([]);
  });

  it("keeps two pull requests' same-named evidence and contents independent", () => {
    const value = fixture();
    const file = path.join(value.evidence, INPUT_FILE_NAME);
    writeFileSync(file, "first\n");
    expect(runUpload(value, 123).status).toBe(0);
    writeFileSync(file, "second\n");
    expect(runUpload(value, 124).status).toBe(0);
    expect(
      readdirSync(value.store).sort((left, right) => left.localeCompare(right))
    ).toEqual([FIRST_ASSET_NAME, "pr-124-01-health.json"]);
    expect(readFileSync(path.join(value.store, FIRST_ASSET_NAME), "utf8")).toBe(
      "first\n"
    );
    expect(
      readFileSync(path.join(value.store, "pr-124-01-health.json"), "utf8")
    ).toBe("second\n");
  });

  it.each([
    "01-health check.json",
    "01-Health.json",
    "01-health_check.json",
    "01-health.check.json",
    "01-health#check.json",
    "01-health\ncheck.json",
    "01-héalth.json",
  ])(
    "rejects invalid %j before uploading any file or replacing prior evidence",
    invalid => {
      const value = fixture();
      const prior = path.join(value.store, PRIOR_ASSET_NAME);
      writeFileSync(prior, PRIOR_CONTENT);
      writeFileSync(path.join(value.evidence, "00-valid.json"), "valid\n");
      writeFileSync(path.join(value.evidence, invalid), "invalid\n");
      const result = runUpload(value, 123);
      expect(readFileSync(prior, "utf8"), result.stderr).toBe(PRIOR_CONTENT);
      expect(result.status).not.toBe(0);
      expect(readFileSync(value.log, "utf8")).toBe("");
      expect(readdirSync(value.store)).toEqual([PRIOR_ASSET_NAME]);
      expect(result.stderr).toContain("Invalid evidence filename");
      expect(readdirSync(value.scratch)).toEqual([]);
    }
  );

  it.each(["upload", "view", "missing", "lookalike"])(
    "stops on %s failure and removes temporary staging",
    failure => {
      const value = fixture();
      writeFileSync(path.join(value.evidence, INPUT_FILE_NAME), "first\n");
      writeFileSync(path.join(value.evidence, "02-other.json"), "second\n");
      const result = runUpload(value, 123, failure);
      expect(result.status).not.toBe(0);
      if (failure === "missing" || failure === "lookalike")
        expect(result.stderr).toContain(FIRST_ASSET_NAME);
      if (failure === "upload") expect(readdirSync(value.store)).toEqual([]);
      expect(readdirSync(value.scratch)).toEqual([]);
    }
  );

  it("does not upload unmatched glob patterns for an empty evidence directory", () => {
    const value = fixture();
    expect(runUpload(value, 123).status).toBe(0);
    expect(readFileSync(value.log, "utf8")).toBe("");
    expect(readdirSync(value.scratch)).toEqual([]);
  });

  it("stops an outer Bash invocation before posting after an upload failure", () => {
    const value = fixture();
    writeFileSync(path.join(value.evidence, INPUT_FILE_NAME), "first\n");
    writeFileSync(
      value.script,
      `${uploadSnippet()}\nprintf '%s\\n' posted > "$EVIDENCE_POST_MARKER"\n`
    );
    const result = runUpload(value, 123, "upload");
    expect(existsSync(path.join(value.root, "posted.txt"))).toBe(false);
    expect(result.status).not.toBe(0);
    expect(readdirSync(value.scratch)).toEqual([]);
  });
});
