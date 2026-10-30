/** Complete bounded reader resolves supported access before truthful header creation. */
import { existsSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  preheaderGithub,
  preheaderJournal,
} from "../../helpers/task-preheader-github.js";
import {
  preheaderFailures,
  preheaderFailure,
  WRONG_NATIVE,
} from "../../helpers/task-preheader-failures.js";
import { githubRequirement } from "../../helpers/task-github-fixture.js";
import { qualifyInstallation } from "../../helpers/task-preheader-installation.js";
import { intakeOwnerCommand } from "../../helpers/task-intake-owner.js";
import { intakeCommands } from "../../helpers/task-intake-gh.js";
import { nativeBash } from "../../helpers/task-native-bash.js";
import { nativeWrite } from "../../helpers/task-native-context.js";
import { readConfig } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/surfaces.mjs";
import { requirementsContext } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/task-requirements.mjs";
import { classifyReadyCandidate } from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";
const roots: string[] = [],
  CONTEXT = ".lisa/work-item-context.md";
const specs = [
  ["issue", "1"],
  ["comments", "1"],
  ["comment-count", "1"],
  ["graph", "1"],
  ["history", "1"],
  ["closing-prs", "1"],
  ["blocked-by", "1"],
  ["blocking", "1"],
  ["issue", "2"],
  ["comments", "2"],
  ["pr", "3"],
  ["review-threads", "3"],
  ["thread-comments", "PRRT_fixture"],
];
afterEach(() =>
  roots
    .splice(0)
    .forEach(root => rmSync(root, { recursive: true, force: true }))
);
/** Own isolated fixture and keep every operation pre-header.
 * @param source - Source under qualification.
 * @returns Installed strict fixture.
 */
function fixture(source: string) {
  const f = preheaderGithub(source);
  roots.push(f.root);
  return f;
}
describe("pre-header GitHub supported source bootstrap", () => {
  it.each(["native", "provider"])(
    "reads with established %s installation scope without inventing an actor",
    source => {
      qualifyInstallation(fixture("provider"), source);
    }
  );
  it.each(["provider", "materialized"])(
    "can actually read using %s with no native or ambient authentication",
    source => {
      const f = fixture(source);
      expect(f.run().counters).toEqual({
        claim: 0,
        branch: 0,
        code: 0,
        external: 0,
      });
      const reads = specs.map(([op, n]) => {
        const r = nativeBash(f, intakeOwnerCommand(f, op!, n));
        expect(r.guard.status).toBe(0);
        expect(r.tool?.status).toBe(0);
        expect(existsSync(path.join(f.root, CONTEXT))).toBe(false);
        expect(String(r.tool?.stdout) + String(r.tool?.stderr)).not.toContain(
          f.secret
        );
        return {
          operation: op,
          value: n,
          request: r.request,
          exit: r.tool?.status,
          raw: String(r.tool?.stdout),
        };
      });
      const primary = JSON.parse(reads[0]!.raw),
        comments = JSON.parse(reads[1]!.raw),
        total = JSON.parse(reads[2]!.raw);
      expect(comments).toHaveLength(total);
      expect(total).toBe(2);
      expect(
        JSON.parse(reads[3]!.raw)[0].data.repository.issue.parent
      ).toBeNull();
      expect(JSON.parse(reads[4]!.raw)).toHaveLength(2);
      expect(
        classifyReadyCandidate({
          labels: primary.labels,
          body: primary.body,
          comments,
          trustedHumanActorIds: ["17"],
        }).claimable
      ).toBe(true);
      expect(
        classifyReadyCandidate({
          labels: primary.labels,
          body: primary.body,
          comments: comments.slice(0, 1),
          trustedHumanActorIds: ["17"],
        }).claimable
      ).toBe(false);
      const journal = preheaderJournal(f);
      expect(journal.filter(row => row.tool === "bws")).toHaveLength(
        source === "provider" ? 13 : 0
      );
      expect(journal.some(row => row.selected_source === true)).toBe(true);
      const body = JSON.stringify({
        primary,
        comments,
        complete_raw_reads: reads,
      });
      const cfg = readConfig(f.root, {
        LISA_SECRETS_SURFACE: f.env.LISA_SECRETS_SURFACE,
      });
      const content = requirementsContext(
        cfg,
        "fixture/project#1",
        "github",
        [githubRequirement],
        body
      );
      const prepared = nativeWrite(f, content);
      expect(prepared.guard.status).toBe(2);
      expect(prepared.rawWrites).toBe(0);
      expect(readFileSync(path.join(f.root, CONTEXT), "utf8")).toBe(content);
      const continuation = f.run();
      expect(continuation.counters).toEqual({
        claim: 1,
        branch: 1,
        code: 1,
        external: 1,
      });
      expect(
        [
          body,
          String(prepared.guard.stdout),
          String(prepared.guard.stderr),
          String(continuation.stdout),
          String(continuation.stderr),
          JSON.stringify(journal),
        ].join()
      ).not.toContain(f.secret);
      console.info(
        "QUALIFICATION_OBSERVATION",
        JSON.stringify({
          case: `preheader-${source}`,
          reads: reads.length,
          complete_comments: comments.length,
          total,
          metadata_exit: prepared.guard.status,
          rawWrites: prepared.rawWrites,
          source_journal: journal,
          effects: continuation.counters,
        })
      );
      if (process.env.LISA_READINESS_FIXTURE_CAPTURE)
        for (const [name, value] of [
          [`preheader-${source}-reads.json`, JSON.stringify(reads)],
          [`preheader-${source}-context.md`, content],
        ])
          writeFileSync(
            path.join(process.env.LISA_READINESS_FIXTURE_CAPTURE, name!),
            value!,
            { flag: "wx", mode: 0o600 }
          );
    }
  );
  it.each(["native", "environment"])(
    "proves the strict fixture can really serve the complete issue through %s",
    source => {
      const f = fixture("provider");
      if (source === "native") f.env.FIXTURE_NATIVE_AVAILABLE = "1";
      else f.env.GH_TOKEN = f.secret;
      for (const command of [
        intakeCommands[0]!,
        intakeOwnerCommand(f, "issue"),
      ]) {
        const r = nativeBash(f, command);
        expect(r.guard.status).toBe(0);
        expect(r.tool?.status).toBe(0);
        expect(JSON.parse(String(r.tool?.stdout)).number).toBe(1);
      }
      expect(
        preheaderJournal(f).filter(row => row.tool === "bws")
      ).toHaveLength(0);
    }
  );
  it.each(preheaderFailures)(
    "refuses %s with no complete header or affected mutation",
    mode => {
      const f = fixture("provider"),
        { command, env, category, blocked } = preheaderFailure(f, mode);
      const r = nativeBash({ ...f, env }, command),
        journal = preheaderJournal(f);
      expect(blocked ? r.guard.status : r.tool?.status).toBe(2);
      expect(journal.some(row => row.label === "gh:issue:view")).toBe(
        mode === "read-failure"
      );
      if (mode === WRONG_NATIVE)
        expect(journal.some(row => row.tool === "bws")).toBe(false);
      if (!blocked) expect(String(r.tool?.stderr)).toContain(category);
      expect(
        [
          String(r.guard.stdout),
          String(r.guard.stderr),
          String(r.tool?.stdout),
          String(r.tool?.stderr),
          JSON.stringify(journal),
        ].join()
      ).not.toContain(f.secret);
      expect(existsSync(path.join(f.root, CONTEXT))).toBe(false);
      expect(existsSync(path.join(f.root, "source.ts"))).toBe(false);
      expect(f.run().counters).toEqual({
        claim: 0,
        branch: 0,
        code: 0,
        external: 0,
      });
    }
  );
});
