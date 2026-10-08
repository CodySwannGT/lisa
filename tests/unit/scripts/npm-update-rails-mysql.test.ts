/** Synthetic protocol and real private-file controls; these do not prove a MySQL service. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const NAMESPACE_PREFIX = "namespace-";

const fixture = vi.hoisted(() => ({
  calls: [] as { command: string; args: string[]; input?: string }[],
  present: false,
  running: false,
  mounts: [] as unknown[],
  name: "",
  nonce: "",
  fail: "",
  qualified: 0,
  schemas: [] as string[],
  fileFailure: "",
  foreignSentinel: "foreign-fixed-sentinel",
  absenceStdout: "",
}));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      if (
        fixture.fileFailure === "foreign-insertion" &&
        args[1] === "wx" &&
        String(args[0]).endsWith("admin.cnf")
      ) {
        actual.writeFileSync(
          join(String(args[0]), "..", "foreign"),
          fixture.foreignSentinel,
          { flag: "wx", mode: 0o600 }
        );
        throw new Error("synthetic private-file foreign insertion");
      }
      if (
        fixture.fileFailure &&
        args[1] === "wx" &&
        String(args[0]).endsWith(fixture.fileFailure)
      )
        throw Object.assign(new Error("synthetic private-file open refusal"), {
          code: "EACCES",
        });
      return actual.openSync(...args);
    },
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      if (
        fixture.fileFailure === "partial-write" &&
        String(args[1]).startsWith("[client]\nuser=root\n")
      ) {
        actual.writeFileSync(args[0], "partial-fixed-sentinel");
        throw new Error("synthetic partial private-file write refusal");
      }
      if (fixture.fileFailure && String(args[0]).endsWith(fixture.fileFailure))
        throw Object.assign(new Error("synthetic private-file write refusal"), {
          code: "EACCES",
        });
      return actual.writeFileSync(...args);
    },
  };
});
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/npm-update-rails-tool-identity.mjs",
  () => ({
    assertDockerQualified: async () => {
      fixture.qualified++;
    },
    runtimeTime: (deadline: number, maximum = 10000) => {
      if (deadline <= Date.now())
        throw new Error("original runtime deadline expired");
      return Math.min(maximum, deadline - Date.now());
    },
  })
);
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/npm-update-native-process.mjs",
  () => ({
    runProcess: async (
      _command: string,
      args: string[],
      options: { input?: string }
    ) => {
      fixture.calls.push({
        command: _command,
        args,
        ...(options.input === undefined ? {} : { input: options.input }),
      });
      const output = (stdout: string, code = 0, stderr = "") => ({
        code,
        stdout: Buffer.from(stdout),
        stderr: Buffer.from(stderr),
      });
      if (_command === "bundle" && args.join(" ") === "exec rails db:prepare") {
        if (fixture.fail === "prepare")
          throw Object.assign(new Error("sensitive native details"), {
            stdout: Buffer.from("synthetic-sensitive"),
            code: 7,
          });
        return output("");
      }
      if (args[0] === "info") return output('"linux"\t"engine-fixture"\n');
      if (args[0] === "ps") return output(`${"f".repeat(64)}\n`);
      if (args[0] === "pull") return output("");
      if (args[0] === "image")
        return output(
          `"sha256:${"1".repeat(64)}"\t"linux"\t"amd64"\t["mysql@sha256:80f4933e3835f9dc4d35a28ec500d7986cb4414e6c6821c5461239cb7beb8995"]\n`
        );
      if (args[0] === "create") {
        fixture.name = args[args.indexOf("--name") + 1]!;
        fixture.nonce = args[args.indexOf("--label") + 1]!.split("=")[1]!;
        fixture.mounts = args
          .flatMap((arg, index) =>
            arg === "--mount" ? [args[index + 1]!] : []
          )
          .map(value => {
            const fields = Object.fromEntries(
              value.split(",").map(part => part.split("="))
            );
            return {
              Type: fields.type,
              Source: fields.src ?? "",
              Destination: fields.dst,
              RW: !value.includes("readonly"),
            };
          });
        fixture.present = true;
        if (fixture.fail === "pending")
          throw new Error("native create response lost");
        return output(`${"c".repeat(64)}\n`);
      }
      if (args[0] === "start") {
        fixture.running = true;
        return output("");
      }
      if (args[0] === "stop") {
        fixture.running = false;
        return output("");
      }
      if (args[0] === "container" && args[1] === "rm") {
        fixture.present = false;
        return output("");
      }
      if (args[0] === "container" && args[1] === "inspect") {
        if (!fixture.present)
          return output(
            fixture.absenceStdout,
            1,
            `Error response from daemon: No such container: ${args[2]}\n`
          );
        const values = [
          "c".repeat(64),
          `/${fixture.name}`,
          {
            "lisa.npm.mysql":
              fixture.fail === "foreign" ? "foreign" : fixture.nonce,
          },
          `sha256:${"1".repeat(64)}`,
          fixture.running,
          fixture.mounts,
          { "3306/tcp": [{ HostIp: "127.0.0.1", HostPort: "38127" }] },
        ];
        return output(
          `${values.map(value => JSON.stringify(value)).join("\t")}\n`
        );
      }
      if (args[0] === "exec") {
        const sql = options.input ?? "";
        if (fixture.fail === "unready")
          throw new Error("synthetic native unready");
        if (sql.includes("@@partial_revokes")) return output("1\t1\n");
        if (sql.includes("CREATE USER")) return output("");
        if (sql.includes("SCHEMA_NAME"))
          return output(
            `${fixture.schemas
              .map(name => `${name}\tutf8mb4\tutf8mb4_0900_ai_ci`)
              .join("\n")}\n`
          );
        if (sql.includes("TABLE_NAME"))
          return output(
            fixture.fail === "empty"
              ? ""
              : `${fixture.schemas
                  .flatMap(name =>
                    ["ar_internal_metadata", "schema_migrations"].map(
                      table => `${name}\t${table}`
                    )
                  )
                  .join("\n")}\n`
          );
        if (sql.includes("SHOW GRANTS")) {
          const mount = fixture.mounts.find(
            value =>
              (value as { Destination: string }).Destination ===
              "/run/lisa-app.cnf"
          ) as { Source: string };
          const user = /user=([a-z0-9_]+)/.exec(
            readFileSync(mount.Source, "utf8")
          )![1];
          return output(
            `${[
              `GRANT USAGE ON *.* TO \`${user}\`@\`%\``,
              ...fixture.schemas.map(
                name =>
                  `GRANT ALL PRIVILEGES ON \`${name}\`.* TO \`${user}\`@\`%\``
              ),
            ].join("\n")}\n`
          );
        }
        return output("1\n");
      }
      throw new Error("Unexpected synthetic protocol operation");
    },
  })
);

const profile = {
  profile: "rails-mysql",
  database: "lisa_runtime",
  browser: false,
  dockerFixtures: false,
};
const docker = {
  path: "/fixture/docker",
  sha256: "a".repeat(64),
  version: "29.8.2",
  engineId: "engine-fixture",
  env: {
    HOME: "/fixture",
    PATH: process.env.PATH!,
    DOCKER_CONFIG: "/fixture/docker-config",
  },
};
let root: string;
async function open(
  changes: Record<string, unknown> = {},
  envChanges: Record<string, string> = {}
) {
  const { openRailsMysqlRuntime } =
    await import("../../../all/copy-overwrite/scripts/lib/npm-update-rails-mysql.mjs");
  return openRailsMysqlRuntime(
    {
      cwd: root,
      root,
      profile,
      deadline: Date.now() + 120_000,
      docker,
      ...changes,
    },
    {
      PATH: process.env.PATH,
      HOME: root,
      BUNDLE_FROZEN: "true",
      BUNDLER_VERSION: "2.4.10",
      ...envChanges,
    }
  );
}
beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lisa-runtime-test-")));
  Object.assign(fixture, {
    calls: [],
    present: false,
    running: false,
    mounts: [],
    name: "",
    nonce: "",
    fail: "",
    qualified: 0,
    schemas: [
      "lisa_runtime_test",
      "lisa_runtime_queue_test",
      "lisa_runtime_cache_test",
      "lisa_runtime_cable_test",
    ],
    fileFailure: "",
    absenceStdout: "",
  });
  await import("../../../all/copy-overwrite/scripts/lib/npm-update-rails-mysql.mjs");
});
afterEach(() => {
  rmSync(root, { recursive: true });
});

describe("fixed MySQL runtime ownership (synthetic native protocol)", () => {
  it("pins administrator readiness to final-server TCP rather than the temporary init socket", async () => {
    const runtime = await open();
    try {
      const mount = fixture.mounts.find(
        value =>
          (value as { Destination: string }).Destination ===
          "/run/lisa-admin.cnf"
      ) as { Source: string };
      const fields = Object.fromEntries(
        readFileSync(mount.Source, "utf8")
          .split("\n")
          .filter(line => line.includes("="))
          .map(line => line.split("="))
      );
      // Never print the generated credential when the transport assertion fails.
      expect({
        host: fields.host,
        protocol: fields.protocol,
        publicKey: fields["get-server-public-key"],
      }).toEqual({ host: "127.0.0.1", protocol: "TCP", publicKey: "1" });
    } finally {
      await runtime.close();
    }
  });
  it("exports only closed observed Rails headers and fixed fixture source locations", async () => {
    const { observeMysqlFailure } =
      await import("../../fixtures/npm-update-rails-mysql-observation.mjs");
    const error = Object.assign(
      new Error("synthetic-sensitive-native-message"),
      {
        code: 7,
        stdout: Buffer.from("synthetic-sensitive-native-out"),
        stderr: Buffer.from(
          "rake aborted!\nLoadError: synthetic-sensitive-native-error\n/proof/case/config/boot.rb:2:in 'require'\n"
        ),
      }
    );
    const observed = observeMysqlFailure(error);
    expect(observed.emittedRailsHeaders).toEqual(["LoadError"]);
    expect(observed.emittedFixtureFrames).toEqual([
      { file: "config/boot.rb", line: 2 },
    ]);
    expect(JSON.stringify(observed)).not.toContain(
      "synthetic-sensitive-native"
    );
  });
  it("keeps unknown native failure detail fingerprint-only and does not invoke error getters", async () => {
    const { observeMysqlFailure } =
      await import("../../fixtures/npm-update-rails-mysql-observation.mjs");
    const reads = vi.fn(() => "synthetic-sensitive-getter");
    const error = Object.assign(new Error("unknown-sensitive-native-message"), {
      stderr: Buffer.from("UnknownSensitiveClass: synthetic-sensitive-value\n"),
    });
    Object.defineProperty(error, "stdout", { get: reads });
    const observed = observeMysqlFailure(error);
    expect(observed.emittedRailsHeaders).toEqual([]);
    expect(observed.emittedFixtureFrames).toEqual([]);
    expect(observed.stdout).toBeNull();
    if (observed.stderr === null)
      throw new Error("expected native stderr fingerprint");
    expect(observed.stderr.bytes).toBeGreaterThan(0);
    expect(JSON.stringify(observed)).not.toContain("synthetic-sensitive");
    expect(reads).not.toHaveBeenCalled();
  });
  it("labels fixed source assertions independently from native emitted headers", async () => {
    const { observeMysqlFailure } =
      await import("../../fixtures/npm-update-rails-mysql-observation.mjs");
    const observed = observeMysqlFailure(
      new Error("MySQL container absence is unproved")
    );
    expect(observed.fixedSourceAssertion).toBe("container-absence-unproved");
    expect(observed.status).toBeNull();
    expect(observed.stderr).toBeNull();
  });
  it("accepts exactly the genuinely observed single LF native Docker absence response", async () => {
    const runtime = await open();
    fixture.absenceStdout = "\n";
    await runtime.close();
    expect(runtime.receipt.closed).toBe(true);
    expect(readdirSync(root)).toEqual([]);
  });
  it.each([" ", "\n\n", "untrusted-output"])(
    "refuses nonempty unqualified absence output %j",
    async output => {
      const runtime = await open();
      fixture.absenceStdout = output;
      await expect(runtime.close()).rejects.toThrow(/absence/);
      expect(runtime.receipt.closed).toBe(false);
      expect(
        readdirSync(root).some(name => name.startsWith(NAMESPACE_PREFIX))
      ).toBe(true);
    }
  );
  it("preserves genuine native failure identity and bounded metadata without serializing output", () => {
    const module = JSON.stringify(
      join(
        process.cwd(),
        "all/copy-overwrite/scripts/lib/npm-update-rails-mysql-daemon.mjs"
      )
    );
    const nativeModule = JSON.stringify(
      join(
        process.cwd(),
        "all/copy-overwrite/scripts/lib/npm-update-process-core.mjs"
      )
    );
    const code = `import {mysqlFailure} from ${module}; import {runProcess} from ${nativeModule};
      const original = await runProcess(process.execPath, ["-e", 'process.stdout.write("synthetic-sensitive-native-out"); process.stderr.write("synthetic-sensitive-native-error"); process.exit(7)'], {cwd:process.cwd(),env:{PATH:process.env.PATH,HOME:process.env.HOME},timeout:5000,maximum:4096}).catch(error=>error);
      const failure = mysqlFailure(original,"Rails prepare");
      console.log(JSON.stringify({sameCause:failure.cause===original,causeEnumerable:Object.getOwnPropertyDescriptor(failure,"cause")?.enumerable,outerKeys:Object.keys(failure),status:failure.code,metadata:failure.observation,serialized:JSON.stringify(failure)}));`;
    const observed = JSON.parse(
      execFileSync(process.execPath, ["--input-type=module", "-e", code], {
        cwd: root,
        env: { PATH: process.env.PATH, HOME: root },
        timeout: 10000,
      }).toString()
    );
    expect(observed.sameCause).toBe(true);
    expect(observed.causeEnumerable).toBe(false);
    expect(observed.outerKeys).toEqual(["code", "observation"]);
    expect(observed.status).toBe(7);
    expect(observed.metadata).toMatchObject({
      phase: "Rails prepare",
      status: 7,
      signal: null,
    });
    expect(observed.metadata.stdout).toMatchObject({
      bytes: 30,
      sha256: createHash("sha256")
        .update("synthetic-sensitive-native-out")
        .digest("hex"),
    });
    expect(observed.metadata.stderr.sha256).toBe(
      createHash("sha256")
        .update("synthetic-sensitive-native-error")
        .digest("hex")
    );
    expect(observed.serialized).not.toContain("synthetic-sensitive-native");
  });
  it("refuses an unqualified Bundler version before allocation", async () => {
    await expect(open({}, { BUNDLER_VERSION: "2.4.11" })).rejects.toThrow(
      /Bundler/
    );
    expect(fixture.calls).toHaveLength(0);
    expect(readdirSync(root)).toEqual([]);
  });
  it("removes an owned first credential file after synthetic second-file open refusal", async () => {
    fixture.fileFailure = "admin.cnf";
    await expect(open()).rejects.toThrow(/private-file/);
    expect(fixture.calls.some(call => call.args[0] === "create")).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });
  it("removes owned credentials after genuine registration collision while preserving the foreign file", async () => {
    const { createMysqlStorage } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-rails-mysql-storage.mjs");
    const nonce = "b".repeat(64);
    const registration = join(root, `namespace-${nonce.slice(0, 16)}.json`);
    writeFileSync(registration, fixture.foreignSentinel, {
      mode: 0o600,
      flag: "wx",
    });
    const identity = {
      nonce,
      name: `lisa-mysql-${nonce}`,
      image: "fixed-fixture",
    };
    expect(() =>
      createMysqlStorage(root, identity, "lisa_fixture", "synthetic-fixture")
    ).toThrow(/EEXIST/);
    expect(readdirSync(root)).toEqual([`namespace-${nonce.slice(0, 16)}.json`]);
    expect(readFileSync(registration, "utf8")).toBe(fixture.foreignSentinel);
  });
  it("removes its partial descriptor-created file after synthetic native write failure", async () => {
    fixture.fileFailure = "partial-write";
    await expect(open()).rejects.toThrow(/private-file/);
    expect(fixture.calls.some(call => call.args[0] === "create")).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });
  it("refuses partial cleanup when foreign data appears and retains the outstanding namespace", async () => {
    fixture.fileFailure = "foreign-insertion";
    await expect(open()).rejects.toThrow(/cleanup refused/);
    expect(fixture.calls.some(call => call.args[0] === "create")).toBe(false);
    expect(
      readdirSync(root).some(name => name.startsWith(NAMESPACE_PREFIX))
    ).toBe(true);
    const directory = join(
      root,
      readdirSync(root).find(name => name.startsWith("rails-mysql-"))!
    );
    expect(readFileSync(join(directory, "foreign"), "utf8")).toBe(
      fixture.foreignSentinel
    );
    expect(
      readdirSync(directory).sort((left, right) => left.localeCompare(right))
    ).toEqual(["foreign", "root-password"]);
  });
  it("returns only finite test DB fields and pins the actual image/platform/loopback endpoint", async () => {
    const runtime = await open();
    expect(runtime.env.DATABASE_NAME).toBe("lisa_runtime");
    expect(runtime.env.DATABASE_PORT).toBe("38127");
    expect(runtime.env.PRIMARY_DB_HOST).toBe("127.0.0.1");
    expect(runtime.env.DATABASE_REPLICA_HOST).toBe("127.0.0.1");
    expect(runtime.env.RAILS_ENV).toBe("test");
    expect(runtime.env.RACK_ENV).toBe("test");
    expect(runtime.env.DATABASE_SSL).toBe("false");
    expect(runtime.env.DATABASE_IAM_AUTH).toBe("false");
    const creation = fixture.calls.find(call => call.args[0] === "create")!;
    expect(creation.args).toContain("linux/amd64");
    expect(creation.args).toContain("127.0.0.1::3306");
    expect(creation.args).toContain("--partial-revokes=ON");
    expect(
      creation.args.some(value =>
        value.includes(runtime.env.DATABASE_PASSWORD!)
      )
    ).toBe(false);
    expect(fixture.nonce).toMatch(/^[a-f0-9]{64}$/);
    await runtime.close();
    expect(runtime.receipt.closed).toBe(true);
    expect(readdirSync(root)).toEqual([]);
  });
  it("runs literal frozen Rails prepare before all-four actual-schema readback", async () => {
    const runtime = await open();
    await runtime.prepareSchemas();
    expect(
      fixture.calls.some(
        call =>
          call.command === "bundle" &&
          call.args.join(" ") === "exec rails db:prepare"
      )
    ).toBe(true);
    expect(runtime.receipt.prepared).toBe(true);
    await runtime.close();
  });
  it("recovers pending create by exact label/name/image identity", async () => {
    fixture.fail = "pending";
    await expect(open()).rejects.toThrow(/native/);
    expect(fixture.present).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });
  it("keeps a changed foreign-labelled resource and refuses cleanup success", async () => {
    const runtime = await open();
    fixture.fail = "foreign";
    await expect(runtime.close()).rejects.toThrow(/ownership/);
    expect(fixture.present).toBe(true);
    expect(fixture.calls.some(call => call.args[0] === "stop")).toBe(false);
    expect(readdirSync(root).some(name => name.startsWith("namespace-"))).toBe(
      true
    );
  });
  it("does not renew an expired phase or declare owned absence", async () => {
    await expect(open({ deadline: Date.now() - 1 })).rejects.toThrow(
      /deadline/
    );
    expect(fixture.calls).toHaveLength(0);
    expect(readdirSync(root)).toEqual([]);
  });
  it("never returns prepared after a missing role readback", async () => {
    const runtime = await open();
    fixture.schemas.pop();
    await expect(runtime.prepareSchemas()).rejects.toThrow(/schema/);
    expect(runtime.receipt.prepared).toBe(false);
    await runtime.close();
  });
  it("does not mistake administrator-created empty databases for actual Rails preparation", async () => {
    const runtime = await open();
    fixture.fail = "empty";
    await expect(runtime.prepareSchemas()).rejects.toThrow(/schema/);
    expect(runtime.receipt.prepared).toBe(false);
    await runtime.close();
  });
  it("retains native failure code without exposing captured output or command data", async () => {
    const runtime = await open();
    fixture.fail = "prepare";
    const failure = await runtime.prepareSchemas().catch(error => error);
    expect(failure.code).toBe(7);
    expect(failure).not.toHaveProperty("stdout");
    expect(failure).not.toHaveProperty("stderr");
    expect(failure).not.toHaveProperty("command");
    await runtime.close();
  });
  it("refuses aliased roots before any daemon mutation", async () => {
    const alias = join(root, "alias");
    symlinkSync(root, alias);
    await expect(open({ root: alias })).rejects.toThrow(/aliased/);
    expect(fixture.calls).toHaveLength(0);
  });
  it.each(["bad;DROP", "a/b", "é", "a".repeat(42)])(
    "refuses SQL namespace input %s before allocation",
    async database => {
      await expect(open({ profile: { ...profile, database } })).rejects.toThrow(
        /profile/
      );
      expect(fixture.calls).toHaveLength(0);
    }
  );
  it("preserves owned secret-file privacy while allocated", async () => {
    const runtime = await open();
    const directory = join(
      root,
      readdirSync(root).find(name => name.startsWith("rails-mysql-"))!
    );
    expect(lstatSync(directory).mode & 0o777).toBe(0o700);
    for (const name of readdirSync(directory))
      expect(lstatSync(join(directory, name)).mode & 0o777).toBe(0o600);
    await runtime.close();
  });
});
