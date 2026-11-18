/**
 * `lisa controls enforce-report` refuses to say anything when one of the
 * things it is handed cannot be relied on (CodySwannGT/lisa#4994).
 */
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runEnforceReport } from "../../../src/controls/commands/enforce-report.js";
import { controlGapKey } from "../../../src/controls/control-gap-marker.js";
import { CONTROL_REGISTER_PATH } from "../../../src/controls/register-types.js";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import { lintGates } from "./support/enforce-repository.js";
import {
  NOT_MEASURED,
  carriersResult,
  filedTickets,
  prepareEnforce,
  protectResult,
  reportRun,
  saveResult,
  useEnforceCases,
  type EnforceCase,
} from "./support/enforce-run.js";

useIoLatencyBudget();
useEnforceCases();

/**
 * Build the report of a case and return what it was refused for.
 * @param prepared - The case
 * @returns Every problem, joined; empty when a report was built
 */
async function refusal(prepared: EnforceCase): Promise<string> {
  return ((await reportRun(prepared)).problems ?? []).join("\n");
}

describe("a result file that cannot be used", () => {
  it.each(["carriers", "tickets", "protect"] as const)(
    "is refused when --%s names no file",
    async option => {
      const prepared = await prepareEnforce();

      const run = await reportRun(prepared, {
        ...prepared.paths,
        [option]: undefined,
      });

      expect(run.problems?.join("\n")).toContain(`--${option}`);
    }
  );

  it("is refused when the file is not there", async () => {
    const prepared = await prepareEnforce();
    rmSync(prepared.paths.protect);

    expect(await refusal(prepared)).toContain(
      "The merge-protection result could not be read"
    );
  });

  it("is refused when the command behind it printed nothing", async () => {
    const prepared = await prepareEnforce();
    saveResult(prepared, "carriers", "");

    expect(await refusal(prepared)).toContain("is empty");
  });

  it("is refused when it is not JSON", async () => {
    const prepared = await prepareEnforce();
    saveResult(prepared, "carriers", "install-carriers: PASS.");

    expect(await refusal(prepared)).toContain("is not valid JSON");
  });

  it.each([
    [
      "a carriers result with an outcome that is no outcome",
      "carriers",
      {
        ...carriersResult(),
        enforcement_points: [
          {
            kind: "git-hook",
            location: "local-checkout",
            moment: "commit",
            outcome: "done",
            reason: null,
          },
        ],
      },
      '"outcome" must be one of',
    ],
    [
      "a carriers result with no list of changes",
      "carriers",
      { ...carriersResult(), changes: undefined },
      '"changes" must be a list',
    ],
    [
      "a carriers result that names a coding agent Lisa does not know",
      "carriers",
      {
        ...carriersResult(),
        enforcement_points: [
          {
            kind: "agent-hook",
            location: "coding-agent",
            moment: "post-tool",
            outcome: "installed",
            reason: null,
            agent: "some-other-agent",
          },
        ],
      },
      '"agent" must be one of',
    ],
    [
      "a merge-protection result with no entries",
      "protect",
      { schema_version: 1, mode: "read-only", branch: null },
      '"entries" must be a list',
    ],
    [
      "ticket results that are a bare list",
      "tickets",
      [],
      "does not hold a JSON object",
    ],
    [
      "a ticket said to exist with no reference",
      "tickets",
      {
        schema_version: 1,
        results: [
          {
            criterion: "SI8",
            scope: ".",
            key: controlGapKey("SI8", "."),
            outcome: "ticketed",
            ticket: null,
            ticket_state: "created",
            reason: null,
            question: null,
          },
        ],
      },
      '"ticket" must be its reference',
    ],
  ] as const)("is refused: %s", async (_name, result, document, said) => {
    const prepared = await prepareEnforce();
    saveResult(prepared, result, document);

    expect(await refusal(prepared)).toContain(said);
  });

  it("names every result that is wrong, not only the first", async () => {
    const prepared = await prepareEnforce();
    saveResult(prepared, "carriers", "");
    saveResult(prepared, "protect", "{");

    const problems = (await reportRun(prepared)).problems ?? [];

    expect(problems).toHaveLength(2);
  });
});

describe("results that do not belong to this repository as it stands", () => {
  it("refuses a merge-protection result saved for a different declaration", async () => {
    const prepared = await prepareEnforce({
      gates: lintGates({ "pull-request": "required" }),
    });
    saveResult(prepared, "protect", {
      ...(await protectResult(prepared.repoPath)),
      entries: [],
    });

    expect(await refusal(prepared)).toContain(
      "says nothing about code-style@."
    );
  });

  it("refuses a register that is not what the declaration generates", async () => {
    const prepared = await prepareEnforce();
    writeFileSync(
      path.join(prepared.repoPath, CONTROL_REGISTER_PATH),
      '{"entries":[],"schema_version":1}\n'
    );

    expect(await refusal(prepared)).toContain('Run "lisa controls register"');
  });

  it("refuses when there is no audit report", async () => {
    const prepared = await prepareEnforce();
    rmSync(path.join(prepared.repoPath, ".lisa", "audit"), { recursive: true });

    expect(await refusal(prepared)).toContain("No audit report was found");
  });

  it("refuses ticket results that leave a missing requirement out", async () => {
    const prepared = await prepareEnforce({ tracker: "github" });
    saveResult(prepared, "tickets", {
      schema_version: 1,
      results: (await filedTickets(prepared.repoPath)).slice(1),
    });

    expect(await refusal(prepared)).toContain("say nothing about");
  });
});

describe("the command", () => {
  /**
   * Run the command on a case, catching what it prints.
   * @param prepared - The case
   * @param targetPath - The path argument
   * @returns The exit code and what went to each stream
   */
  async function command(
    prepared: EnforceCase,
    targetPath: string | undefined = prepared.repoPath
  ): Promise<{
    readonly code: number;
    readonly stdout: readonly string[];
    readonly stderr: readonly string[];
  }> {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runEnforceReport(targetPath, prepared.paths, {
      cwd: prepared.results,
      stdout: text => stdout.push(text),
      stderr: line => stderr.push(line),
      build: (root, paths) =>
        import("../../../src/controls/enforce-report.js").then(module =>
          module.buildEnforceReport(root, paths, {
            measure: () => Promise.resolve(NOT_MEASURED),
          })
        ),
    });
    return { code, stdout, stderr };
  }

  it("exits 0 and prints one JSON document, with the summary on stderr", async () => {
    const { code, stdout, stderr } = await command(await prepareEnforce());

    expect(code).toBe(0);
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0] ?? "")).toMatchObject({
      schema_version: 1,
      requirements: 77,
    });
    expect(stderr[0]).toMatch(/^enforce-report: PASS\. 77 requirements: /u);
  });

  it("resolves result paths given from the working directory", async () => {
    const prepared = await prepareEnforce();
    const relative: EnforceCase = {
      ...prepared,
      paths: {
        carriers: "carriers.json",
        tickets: "tickets.json",
        protect: "protect.json",
      },
    };

    expect((await command(relative)).code).toBe(0);
  });

  it("exits 1 with nothing on stdout when a result cannot be used", async () => {
    const prepared = await prepareEnforce();
    saveResult(prepared, "tickets", "");

    const { code, stdout, stderr } = await command(prepared);

    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.at(-1)).toMatch(/^enforce-report: FAIL\./u);
  });

  it("exits 1 when the path is not a folder", async () => {
    const prepared = await prepareEnforce();

    const { code, stdout } = await command(
      prepared,
      path.join(prepared.repoPath, "no-such-folder")
    );

    expect(code).toBe(1);
    expect(stdout).toEqual([]);
  });
});
