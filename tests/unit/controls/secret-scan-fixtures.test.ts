/**
 * A credential scan over everything the control commands write, on every
 * fixture repository, finds nothing.
 *
 * Each fixture is taken through the commands an operator runs: the audit
 * report is checked and rendered, the paired proofs are run and written
 * down (evidence, register, verdict), the merge-protection handover is
 * written, and the carriers are installed. Every one of the seven committed
 * or shared files that results is then scanned. The files are full of long
 * random-looking text that is not secret: commit hashes, digests, record
 * ids, file paths. A scan that took any of it for a credential would stop
 * the operator, so zero findings here is the proof that it does not.
 *
 * The last block seeds a made-up credential into each kind of document, to
 * show the scan that found nothing was able to find something
 * (CodySwannGT/lisa#4999).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AUDIT_REPORT_JSON_PATH,
  AUDIT_REPORT_MARKDOWN_PATH,
} from "../../../src/controls/audit-report.js";
import { CARRIER_RECORD_PATH } from "../../../src/controls/carrier-types.js";
import { installCarriers } from "../../../src/controls/carriers.js";
import { EVIDENCE_PATH } from "../../../src/controls/evidence.js";
import { protectRepository } from "../../../src/controls/protect.js";
import { MERGE_PROTECTION_CHANGE_PATH } from "../../../src/controls/protect-types.js";
import { CONTROL_REGISTER_PATH } from "../../../src/controls/register-types.js";
import {
  credentialProblemIn,
  scanJsonForCredentials,
} from "../../../src/controls/secret-scan-json.js";
import { credentialKinds } from "../../../src/controls/secret-scan.js";
import { VERDICT_PATH } from "../../../src/controls/verdict-types.js";
import {
  completeAuditReport,
  writeAuditReport,
} from "../../helpers/control-audit-report.js";
import {
  API_SOURCE,
  checks,
  F_NONE_SOURCE,
  proofFiles,
  proofPatches,
  provedGates,
  WEB_SOURCE,
} from "../../helpers/control-proofs.js";
import { F_PAVED_GATES } from "../../helpers/control-register.js";
import { fakeGithubToken } from "../../helpers/fake-credentials.js";
import { record } from "./support/attest-record-run.js";
import { conformingRepository } from "./support/conforming-repository.js";
import { fakeGithub } from "./support/fake-github.js";
import {
  removeCopies,
  setting,
  type ProofSetting,
} from "./support/proof-run.js";
import { GITHUB_REMOTE, REPO } from "./support/protect-fixture.js";
import { check, removeFixtures } from "./support/report-check-run.js";

/** The moments a fixture's control is required at. */
const MOMENTS = ["commit", "pull-request"];

/** The files every fixture ends up with, whatever it declares. */
const ALWAYS = [
  AUDIT_REPORT_JSON_PATH,
  AUDIT_REPORT_MARKDOWN_PATH,
  CONTROL_REGISTER_PATH,
  EVIDENCE_PATH,
  VERDICT_PATH,
  CARRIER_RECORD_PATH,
];

/** Every committed or shared file the control commands write. */
const IN_SCOPE = [...ALWAYS, MERGE_PROTECTION_CHANGE_PATH];

/** One fixture: how it is built, what its audit covers, what it ends up with. */
interface FixtureCase {
  readonly build: () => ProofSetting | Promise<ProofSetting>;
  readonly scopes: readonly string[];
  /** Whether a pull-request check is left for an administrator to require. */
  readonly handover: boolean;
  /** Whether the fixture arrives with its audit report already checked. */
  readonly audited?: true;
}

const FIXTURES: Readonly<Record<string, FixtureCase>> = {
  "F-none": {
    build: () =>
      setting(
        provedGates([{ command: checks(F_NONE_SOURCE) }], "code-style", MOMENTS)
      ),
    scopes: ["."],
    handover: true,
  },
  "F-mixed": {
    build: () =>
      setting(
        provedGates(
          [
            { scope: "web", command: checks("src/index.ts"), name: "web" },
            {
              scope: "api",
              command: checks("src/api/greeting.py"),
              name: "api",
            },
          ],
          "code-style",
          MOMENTS
        ),
        {
          files: {
            ...proofFiles(proofPatches("F-mixed", API_SOURCE), "api"),
            ...proofFiles(proofPatches("F-mixed", WEB_SOURCE), "web"),
          },
          fixture: "F-mixed",
        }
      ),
    scopes: [".", "api", "web"],
    handover: true,
  },
  "F-paved": {
    build: () => setting(F_PAVED_GATES, { files: {}, fixture: "F-paved" }),
    scopes: ["."],
    handover: true,
  },
  "F-empty": {
    build: () => setting({}, { files: {}, fixture: "F-empty" }),
    scopes: ["."],
    handover: false,
  },
  "a repository where every requirement is met": {
    build: conformingRepository,
    scopes: ["."],
    handover: false,
    audited: true,
  },
};

/**
 * Take a fixture through every command that writes a committed or shared
 * file.
 * @param fixture - The fixture
 * @returns The repository root
 * @throws {Error} When a command does not finish, so a case never scans a
 *   repository that is missing a file
 */
async function produced(fixture: FixtureCase): Promise<string> {
  const where = await fixture.build();
  const { repoPath } = where;
  if (fixture.audited !== true) {
    writeAuditReport(repoPath, completeAuditReport(fixture.scopes));
    const checked = await check(repoPath);
    if (checked.code !== 0) throw new Error(checked.stderr.join("\n"));
  }
  const recorded = await record(where);
  if (recorded.problems !== null) throw new Error(recorded.problems.join("\n"));
  const protectedRun = await protectRepository(
    repoPath,
    {},
    {
      gh: fakeGithub({ repo: REPO, admin: false }).gh,
      readRemoteUrl: () => Promise.resolve(GITHUB_REMOTE),
    }
  );
  if (protectedRun.problems !== null) {
    throw new Error(protectedRun.problems.join("\n"));
  }
  const carriers = await installCarriers(repoPath);
  if (carriers.problems !== null) throw new Error(carriers.problems.join("\n"));
  return repoPath;
}

/**
 * Scan one file the way the last check before a write does.
 * @param repoPath - The repository
 * @param file - The file, from the repository root
 * @returns What the scan found, as `<file>: <place> (<shape>)`
 */
function findingsIn(repoPath: string, file: string): readonly string[] {
  const text = readFileSync(path.join(repoPath, file), "utf8");
  if (!file.endsWith(".json")) {
    return credentialKinds(text).map(kind => `${file}: ${kind}`);
  }
  return scanJsonForCredentials(JSON.parse(text) as unknown).map(
    finding => `${file}: ${finding.path} (${finding.kind})`
  );
}

afterEach(() => {
  removeCopies();
  removeFixtures();
});

describe.each(Object.entries(FIXTURES))(
  "the files the control commands write on %s",
  (_name, fixture) => {
    it("are all there, and a credential scan over them reports zero findings", async () => {
      const repoPath = await produced(fixture);
      const written = IN_SCOPE.filter(file =>
        existsSync(path.join(repoPath, file))
      );

      expect(written).toEqual(fixture.handover ? IN_SCOPE : ALWAYS);
      expect(written.flatMap(file => findingsIn(repoPath, file))).toEqual([]);
      expect(
        written
          .map(file =>
            credentialProblemIn(
              file,
              readFileSync(path.join(repoPath, file), "utf8")
            )
          )
          .filter(problem => problem !== null)
      ).toEqual([]);
    });
  }
);

describe("the same scan, over a document a made-up credential was seeded into", () => {
  const TOKEN = fakeGithubToken();

  it("finds it in every kind of document, and names the place and never the value", async () => {
    const repoPath = await produced(FIXTURES["F-none"] as FixtureCase);

    const problems = IN_SCOPE.map(file => {
      const text = readFileSync(path.join(repoPath, file), "utf8");
      const seeded = file.endsWith(".json")
        ? JSON.stringify({ ...(JSON.parse(text) as object), seeded: TOKEN })
        : `${text}\nSigned in with ${TOKEN}.\n`;
      return credentialProblemIn(file, seeded) ?? "";
    });

    expect(problems.map(problem => problem.split(":")[0])).toEqual(
      IN_SCOPE.map(file =>
        file.endsWith(".json")
          ? `${file} was not written, because it would hold something shaped like a credential at seeded`
          : expect.stringMatching(
              new RegExp(
                `^${file.replaceAll(".", "\\.")} was not written, because it would hold something shaped like a credential at line \\d+$`,
                "u"
              )
            )
      )
    );
    expect(problems.join("\n")).not.toContain(TOKEN);
  });
});
