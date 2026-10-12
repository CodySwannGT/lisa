/** Committed Git inventory, never child text or mutable paths, selects diagnostic pointers. */
import { describe, expect, it } from "vitest";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  captureCommittedSpecInventory,
  hookReports,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-rspec-reports.mjs";
import {
  runProcess,
  withPrivateRoot,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import { publicFailure } from "../../../all/copy-overwrite/scripts/lib/npm-update-invariants.mjs";

const CANARY = "PRIVATE_DESCRIPTION_CANARY";
const SPEC = "spec/example_spec.rb";
const LOCATION_ONE = `${SPEC}:1`;
const LOCATION_TWO = `${SPEC}:2`;
const LOCATION_PREFIX = "rspec-locations=";

/** The committed blob remains the authority after checkout files change. */
async function withCatalog(
  action: (
    catalog: object,
    root: string,
    env: NodeJS.ProcessEnv
  ) => Promise<void>,
  extraFiles = 0
) {
  await withPrivateRoot(async (root, env) => {
    const command = (args: string[]) =>
      runProcess("git", args, { cwd: root, env });
    await command(["init", "--object-format=sha1"]);
    mkdirSync(join(root, "spec"));
    writeFileSync(join(root, SPEC), "first\nsecond\nthird\n");
    symlinkSync("example_spec.rb", join(root, "spec/alias_spec.rb"));
    for (let index = 0; index < extraFiles; index++)
      writeFileSync(join(root, `spec/cap${index}_spec.rb`), "line\n");
    await command(["add", "spec"]);
    await command([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "Committed catalog",
    ]);
    const parent = (await command(["rev-parse", "HEAD"])).stdout
      .toString()
      .trim();
    writeFileSync(join(root, SPEC), "mutable\n".repeat(100));
    writeFileSync(join(root, "spec/mutable_only_spec.rb"), "uncommitted\n");
    const catalog = await captureCommittedSpecInventory(command, parent);
    await action(catalog, root, env);
  });
}

/** Actual child buffers flow through the original supervisor and WeakMap registration. */
async function failedChild(
  root: string,
  env: NodeJS.ProcessEnv,
  catalog: object,
  output: string,
  role: "audit" | "destination" = "audit"
) {
  return runProcess(
    process.execPath,
    [
      "-e",
      `process.stdout.write(${JSON.stringify(output)});process.exitCode=1;`,
    ],
    { cwd: root, env, failureRole: role, diagnosticSpecInventory: catalog }
  ).catch(error => error);
}

const footer = (locations: string[], tally = "716 examples, 14 failures") => {
  const lines = locations
    .map(location => `rspec ./${location} # ${CANARY}`)
    .join("\n");
  return `${tally}\n\nFailed examples:\n\n${lines}\n`;
};

describe("trusted committed RSpec location diagnostics", () => {
  it("keeps literal argv, stdin, environment and native failed status through the diagnostic-only option", async () => {
    await withCatalog(async (catalog, root, env) => {
      const output = footer([LOCATION_TWO]);
      const program = `let input="";process.stdin.on("data",chunk=>input+=chunk);process.stdin.on("end",()=>{process.stdout.write(${JSON.stringify(output)});process.exitCode=process.argv[1]==="literal-argument"&&input==="original-input"&&process.env.DIAGNOSTIC_CONTROL==="original-env"?1:23;});`;
      const error = await runProcess(
        process.execPath,
        ["-e", program, "literal-argument"],
        {
          cwd: root,
          env: { ...env, DIAGNOSTIC_CONTROL: "original-env" },
          input: "original-input",
          timeout: 10_000,
          maximum: 8_388_608,
          failureRole: "audit",
          diagnosticSpecInventory: catalog,
        }
      ).catch(value => value);
      expect(error.code).toBe(1);
      expect(error.nativeCompleted).toBe(true);
      expect(error.stdout.toString()).toBe(output);
      expect(publicFailure(error)).toContain(
        `${LOCATION_PREFIX}${LOCATION_TWO}`
      );
    });
  });
  it.each(["audit", "destination"] as const)(
    "retains selected committed locations from a real failed %s child",
    async role => {
      await withCatalog(async (catalog, root, env) => {
        const output = footer([
          LOCATION_TWO,
          LOCATION_TWO,
          "spec/example_spec.rb:3",
        ]);
        const error = await failedChild(root, env, catalog, output, role);
        expect(error.stdout.toString()).toBe(output);
        expect(error.code).toBe(1);
        expect(error.nativeCompleted).toBe(true);
        for (const property of ["message", "stack", "stdout", "stderr"])
          Object.defineProperty(error, property, {
            get() {
              throw new Error(CANARY);
            },
          });
        Object.freeze(error);
        const diagnostic = publicFailure(error);
        expect(diagnostic).toContain(
          "rspec-locations=spec/example_spec.rb:2,spec/example_spec.rb:3"
        );
        expect(diagnostic).toContain("reports=child-reported-nonauthoritative");
        expect(diagnostic).toContain(`native=exit status=1 role=${role}`);
        expect(diagnostic).not.toContain(CANARY);
        expect(diagnostic).not.toContain(root);
      });
    }
  );

  it("discards unknown, mutable-only, malformed and unrelated locations", async () => {
    await withCatalog(async (catalog, root, env) => {
      const report = footer([
        "spec/example_spec.rb:4",
        "spec/unknown_spec.rb:1",
        "spec/mutable_only_spec.rb:1",
        "spec/alias_spec.rb:1",
        "spec/../example_spec.rb:1",
        "/spec/example_spec.rb:1",
        "spec/example_spec.rb:01",
        "spec/example_spec.rb:0",
        "spec/example_spec.rb:2\t",
        "spec/exam\u001b[31mple_spec.rb:2",
        LOCATION_ONE,
      ]);
      const output = `${report}Randomized with seed 42\nrspec ./spec/example_spec.rb:2 # outside footer\n`;
      const error = await failedChild(root, env, catalog, output);
      expect(publicFailure(error)).toContain(
        "rspec-locations=spec/example_spec.rb:1"
      );
      expect(publicFailure(error)).not.toContain("unknown_spec");
      expect(publicFailure(error)).not.toContain(CANARY);
    });
  });

  it.each([
    "716 examples, 0 failures",
    "716 examples, 14 failures\n717 examples, 15 failures",
  ])("requires positive unambiguous tallies: %s", async tally => {
    await withCatalog(async (catalog, root, env) => {
      const error = await failedChild(
        root,
        env,
        catalog,
        footer([LOCATION_TWO], tally)
      );
      expect(publicFailure(error)).not.toContain(LOCATION_PREFIX);
    });
  });

  it("requires a footer and the privately registered catalog, never a forged error property", async () => {
    await withCatalog(async (catalog, root, env) => {
      const output =
        "716 examples, 14 failures\nrspec ./spec/example_spec.rb:2 # unrelated\n";
      expect(
        publicFailure(await failedChild(root, env, catalog, output))
      ).not.toContain(LOCATION_PREFIX);
      expect(
        hookReports(
          Buffer.from(footer([LOCATION_TWO])),
          Buffer.alloc(0),
          new Map([[SPEC, 3]])
        ).locations
      ).toEqual([]);
      const forged = Object.freeze(new Error(CANARY));
      expect(publicFailure(forged)).not.toContain(LOCATION_PREFIX);
    });
  });

  it("keeps catalog failures diagnostic-only", async () => {
    const catalog = await captureCommittedSpecInventory(async () => {
      throw new Error(CANARY);
    }, "b".repeat(40));
    expect(
      hookReports(Buffer.from(footer([LOCATION_ONE])), Buffer.alloc(0), catalog)
        .locations
    ).toEqual([]);
  });

  it("deduplicates and caps native failure pointers at twenty with a closed truncation marker", async () => {
    await withCatalog(async (catalog, root, env) => {
      const locations = Array.from(
        { length: 25 },
        (_, index) => `spec/cap${index}_spec.rb:1`
      );
      const error = await failedChild(
        root,
        env,
        catalog,
        footer([...locations, ...locations], "716 examples, 25 failures")
      );
      const diagnostic = publicFailure(error);
      expect(diagnostic).toContain(
        `rspec-locations=${locations.slice(0, 20).join(",")}`
      );
      expect(diagnostic).toContain("rspec-locations-truncated=true");
      expect(diagnostic).not.toContain("cap20_spec");
      expect(diagnostic).not.toContain(CANARY);
    }, 25);
  });

  it("keeps footer boundaries within one captured stream and retains the original aggregate bound", async () => {
    await withCatalog(async catalog => {
      const counts = Buffer.from(
        "716 examples, 14 failures\nFailed examples:\n"
      );
      const line = Buffer.from(
        "rspec ./spec/example_spec.rb:2 # description\n"
      );
      expect(hookReports(counts, line, catalog).locations).toEqual([]);
      expect(
        hookReports(Buffer.alloc(8_388_609), line, catalog).locations
      ).toEqual([]);
    });
  });

  it("never attaches pointers to zero-exit or unscoped failures", async () => {
    await withCatalog(async (catalog, root, env) => {
      const output = footer([LOCATION_TWO]);
      const success = await runProcess(
        process.execPath,
        ["-e", `process.stdout.write(${JSON.stringify(output)});`],
        { cwd: root, env, diagnosticSpecInventory: catalog }
      );
      expect(success.code).toBe(0);
      const unscoped = await runProcess(
        process.execPath,
        [
          "-e",
          `process.stdout.write(${JSON.stringify(output)});process.exitCode=1;`,
        ],
        { cwd: root, env, diagnosticSpecInventory: catalog }
      ).catch(error => error);
      expect(publicFailure(unscoped)).not.toContain(LOCATION_PREFIX);
    });
  });

  it("refuses invalid or over-bounded committed inventories without consulting child paths", async () => {
    const calls: string[][] = [];
    const command = async (args: string[]) => {
      calls.push(args);
      return {
        stdout: Buffer.from(
          `100644 blob ${"b".repeat(40)}\tspec/example_spec.rb\0`.repeat(2001)
        ),
      };
    };
    const invalid = await captureCommittedSpecInventory(command, "../HEAD");
    expect(calls).toEqual([]);
    const bounded = await captureCommittedSpecInventory(
      command,
      "a".repeat(40)
    );
    expect(calls).toEqual([
      ["ls-tree", "-r", "-z", "a".repeat(40), "--", "spec"],
    ]);
    for (const catalog of [invalid, bounded])
      expect(
        hookReports(
          Buffer.from(footer([LOCATION_ONE])),
          Buffer.alloc(0),
          catalog
        ).locations
      ).toEqual([]);
  });
});
