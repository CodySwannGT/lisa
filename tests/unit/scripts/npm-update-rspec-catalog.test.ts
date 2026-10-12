/** Committed Git inventory, never child text or mutable paths, selects diagnostic pointers. */
import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
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
import * as gate from "../../../all/copy-overwrite/scripts/lib/npm-update-gate.mjs";
import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";
import { GIT_BIN } from "../../support/git-executable.js";

const CANARY = "PRIVATE_DESCRIPTION_CANARY";
const SPEC = "spec/example_spec.rb";
const LOCATION_ONE = `${SPEC}:1`;
const LOCATION_TWO = `${SPEC}:2`;
const LOCATION_PREFIX = "rspec-locations=";
/** The regular base spec and symlink bring this fixture to exactly 2,000 tree records. */
const MAXIMUM_INVENTORY_EXTRA_SPECS = 2000 - 2;

/** The committed blob remains the authority after checkout files change. */
async function withCatalog(
  action: (
    catalog: object,
    root: string,
    env: NodeJS.ProcessEnv,
    calls: { args: string[]; input?: string | Buffer }[]
  ) => Promise<void>,
  extraFiles = 0
) {
  await withPrivateRoot(async (root, env) => {
    const calls: { args: string[]; input?: string | Buffer }[] = [];
    const command = (args: string[], input?: string | Buffer) => {
      const stdin = input === undefined ? {} : { input };
      calls.push({ args, ...stdin });
      return runProcess("git", args, { cwd: root, env, ...stdin });
    };
    await command(["init", "--object-format=sha1"]);
    mkdirSync(join(root, "spec"));
    writeFileSync(join(root, SPEC), "first\nsecond\nthird\n");
    symlinkSync("example_spec.rb", join(root, "spec/alias_spec.rb"));
    for (let index = 0; index < extraFiles; index++)
      writeFileSync(join(root, `spec/cap${index}_spec.rb`), `line ${index}\n`);
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
    calls.length = 0;
    const catalog = await captureCommittedSpecInventory(command, parent);
    await action(catalog, root, env, calls);
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

/** Malformed native replies must never grant a catalog from partial or substituted bytes. */
function corruptBatch(bytes: Buffer, mode: string): Buffer {
  const text = bytes.toString();
  if (mode === "wrong object")
    return Buffer.from(`${"f".repeat(40)}${text.slice(40)}`);
  if (mode === "wrong type")
    return Buffer.from(text.replace(" blob ", " tree "));
  if (mode === "noncanonical size")
    return Buffer.from(text.replace(/ blob (\d+)/, " blob 0$1"));
  if (mode === "truncated header") return bytes.subarray(0, 20);
  if (mode === "missing trailer") return bytes.subarray(0, bytes.length - 1);
  if (mode === "extra output")
    return Buffer.concat([bytes, Buffer.from("foreign\n")]);
  if (mode === "oversized blob")
    return Buffer.from(text.replace(/ blob \d+/, " blob 1048577"));
  throw new Error("unknown batch fixture");
}

describe("trusted committed RSpec location diagnostics", () => {
  it.each([
    "wrong object",
    "wrong type",
    "noncanonical size",
    "truncated header",
    "missing trailer",
    "extra output",
    "oversized blob",
  ])("omits hints after a native %s batch frame", async mode => {
    await withCatalog(async (_catalog, root, env) => {
      const parent = (
        await runProcess("git", ["rev-parse", "HEAD"], { cwd: root, env })
      ).stdout
        .toString()
        .trim();
      const command = async (args: string[], input?: string | Buffer) => {
        const actual = await runProcess("git", args, {
          cwd: root,
          env,
          ...(input === undefined ? {} : { input }),
        });
        if (args[0] !== "cat-file") return actual;
        const output = corruptBatch(actual.stdout, mode);
        return runProcess(
          process.execPath,
          [
            "-e",
            `process.stdout.write(Buffer.from(${JSON.stringify(output.toString("base64"))},"base64"));`,
          ],
          { cwd: root, env }
        );
      };
      const catalog = await captureCommittedSpecInventory(command, parent);
      const error = await failedChild(
        root,
        env,
        catalog,
        footer([LOCATION_TWO])
      );
      expect(error.code).toBe(1);
      expect(publicFailure(error)).not.toContain(LOCATION_PREFIX);
      expect(publicFailure(error)).not.toContain(CANARY);
    });
  });
  it(
    "bounds a maximum committed inventory with the actual production adapter",
    async () => {
      await withCatalog(async (_catalog, root, env) => {
        const parent = (
          await runProcess("git", ["rev-parse", "HEAD"], { cwd: root, env })
        ).stdout
          .toString()
          .trim();
        const started = Date.now();
        const catalog = await gate.captureGateSpecInventory(
          { cwd: root, proposal: { parent }, deadline: started + 1_800_000 },
          env
        );
        expect(Date.now() - started).toBeLessThan(2000);
        expect(
          publicFailure(
            await failedChild(root, env, catalog, footer([LOCATION_TWO]))
          )
        ).toContain(`${LOCATION_PREFIX}${LOCATION_TWO}`);
      }, MAXIMUM_INVENTORY_EXTRA_SPECS);
    },
    ioLatencyBudgetMs(10_000)
  );

  it(
    "bounds a genuinely stalled optional batch, reaps its native process and continues the original failed audit",
    async () => {
      await withCatalog(async (_catalog, root, env) => {
        const parent = (
          await runProcess("git", ["rev-parse", "HEAD"], { cwd: root, env })
        ).stdout
          .toString()
          .trim();
        const bin = join(root, "bin");
        const marker = join(root, "stalled-pid");
        const program = join(root, "stalled-git.cjs");
        mkdirSync(bin);
        writeFileSync(
          program,
          `const{spawn}=require("node:child_process");const args=process.argv.slice(2);if(args[0]==="cat-file"){require("node:fs").writeFileSync(${JSON.stringify(marker)},String(process.pid));process.stdin.resume();setInterval(()=>{},1000);}else{const child=spawn(${JSON.stringify(GIT_BIN)},args,{stdio:"inherit"});child.on("exit",code=>process.exitCode=code);}`
        );
        writeFileSync(
          join(bin, "git"),
          `#!/bin/sh\nexec '${process.execPath}' '${program}' "$@"\n`,
          { mode: 0o700 }
        );
        const started = Date.now();
        const deadline = started + 200_000;
        const catalog = await gate.captureGateSpecInventory(
          { cwd: root, proposal: { parent }, deadline },
          { ...env, PATH: `${bin}:${env.PATH}` }
        );
        expect(Date.now() - started).toBeLessThan(ioLatencyBudgetMs(4000));
        expect(deadline - Date.now()).toBeGreaterThan(190_000);
        const pid = Number(readFileSync(marker, "utf8"));
        expect(Number.isInteger(pid) && pid > 0).toBe(true);
        expect(() => process.kill(pid, 0)).toThrow(
          expect.objectContaining({ code: "ESRCH" })
        );
        const error = await failedChild(
          root,
          env,
          catalog,
          footer([LOCATION_TWO])
        );
        expect(error.code).toBe(1);
        expect(error.nativeCompleted).toBe(true);
        expect(publicFailure(error)).not.toContain(LOCATION_PREFIX);
        expect(publicFailure(error)).toContain("role=audit");
      });
    },
    ioLatencyBudgetMs(10_000)
  );

  it("skips unusably small optional budgets while the original audit still executes", async () => {
    await withCatalog(async (_catalog, root, env) => {
      const started = Date.now();
      const catalog = await gate.captureGateSpecInventory(
        {
          cwd: root,
          proposal: { parent: "a".repeat(40) },
          deadline: started + 15_000,
        },
        { ...env, PATH: "/no-diagnostic-executable" }
      );
      expect(Date.now() - started).toBeLessThan(200);
      const error = await failedChild(
        root,
        env,
        catalog,
        footer([LOCATION_TWO])
      );
      expect(error.code).toBe(1);
      expect(publicFailure(error)).not.toContain(LOCATION_PREFIX);
    });
  });

  it("reads distinct committed blobs through one literal native Git batch with fixed object stdin", async () => {
    await withCatalog(async (catalog, root, env, calls) => {
      const batch = calls.filter(call => call.args[0] === "cat-file");
      expect(batch).toHaveLength(1);
      expect(batch[0]!.args).toEqual(["cat-file", "--batch"]);
      const objects = batch[0]!.input!.toString().trim().split("\n");
      expect(objects).toHaveLength(31);
      expect(new Set(objects).size).toBe(31);
      expect(objects.every(object => /^[a-f0-9]{40}$/.test(object))).toBe(true);
      expect(
        publicFailure(
          await failedChild(root, env, catalog, footer([LOCATION_TWO]))
        )
      ).toContain(`${LOCATION_PREFIX}${LOCATION_TWO}`);
    }, 30);
  });
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
