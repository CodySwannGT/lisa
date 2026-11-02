/** Execute the documented evidence upload against GitHub CLI filename semantics. */
import {
  chmodSync,
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
const SPACED_ASSET_NAME = "pr-123-01-health check.json";
const FIRST_ASSET_NAME = "pr-123-01-health.json";

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
if (args[1] === "upload") {
  const [file, label = ""] = args.at(-1).split("#");
  const name = path.basename(file);
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
 * @returns Native shell completion and captured diagnostics.
 */
function runUpload(
  value: ReturnType<typeof fixture>,
  pr: number,
  failure = ""
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
    },
  });
}

describe("documented GitHub evidence upload", () => {
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
    writeFileSync(
      path.join(value.evidence, "01-health check.json"),
      HEALTH_CONTENT
    );
    const result = runUpload(value, 123);
    expect(result.status, result.stderr).toBe(0);
    expect(readdirSync(value.store)).toEqual([SPACED_ASSET_NAME]);
    expect(
      readFileSync(path.join(value.store, SPACED_ASSET_NAME), "utf8")
    ).toBe(HEALTH_CONTENT);
    expect(JSON.parse(readFileSync(value.log, "utf8"))).toEqual({
      name: SPACED_ASSET_NAME,
      label: "",
    });
    expect(
      readFileSync(path.join(value.evidence, "01-health check.json"), "utf8")
    ).toBe(HEALTH_CONTENT);
    expect(readdirSync(value.scratch)).toEqual([]);
  });

  it("keeps two pull requests' same-named evidence and contents independent", () => {
    const value = fixture();
    const file = path.join(value.evidence, "01-health.json");
    writeFileSync(file, "first\n");
    expect(runUpload(value, 123).status).toBe(0);
    writeFileSync(file, "second\n");
    expect(runUpload(value, 124).status).toBe(0);
    expect(readdirSync(value.store)).toEqual([
      FIRST_ASSET_NAME,
      "pr-124-01-health.json",
    ]);
    expect(readFileSync(path.join(value.store, FIRST_ASSET_NAME), "utf8")).toBe(
      "first\n"
    );
    expect(
      readFileSync(path.join(value.store, "pr-124-01-health.json"), "utf8")
    ).toBe("second\n");
  });

  it.each(["upload", "view", "missing", "lookalike"])(
    "stops on %s failure and removes temporary staging",
    failure => {
      const value = fixture();
      writeFileSync(path.join(value.evidence, "01-health.json"), "first\n");
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
});
