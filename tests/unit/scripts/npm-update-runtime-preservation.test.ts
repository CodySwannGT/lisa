/** Synthetic component boundaries isolate the actual qualifier's four-kind census; native acceptance is separate. */
import { describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSupervisedUnixFixture } from "../../helpers/supervised-unix-fixture.js";
import { SCRATCH_SUPERVISION_LEASE_ENV } from "../../../src/configs/vitest/scratch-supervision.js";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();

vi.mock(
  "../../../all/copy-overwrite/scripts/lib/npm-update-rails-tools.mjs",
  () => ({
    prepareRailsTools: async () => ({
      docker: {
        env: {},
        path: "synthetic-docker",
        version: "synthetic",
        sha256: "a".repeat(64),
      },
      client: {
        version: "synthetic",
        sha256: "b".repeat(64),
        headerSha256: "c".repeat(64),
      },
    }),
  })
);
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/npm-update-rails-mysql.mjs",
  () => ({
    openRailsMysqlRuntime: async () => ({
      prepareSchemas: async () => {},
      close: async () => {},
      env: {},
      receipt: {
        prepared: true,
        closed: true,
        foreignPreserved: true,
        imageId: "synthetic-image",
      },
    }),
  })
);
vi.mock("../../fixtures/npm-update-hosted-runtime/application.mjs", () => ({
  prepareApplication: async (root: string) => ({
    cwd: root,
    env: {},
    lockSha256: "d".repeat(64),
  }),
}));
vi.mock(
  "../../fixtures/npm-update-hosted-runtime/driver-diagnostic.mjs",
  () => ({
    browserDriverQualification: async () => ({ driverSessionVerified: true }),
    browserDriverControl: async () => ({}),
  })
);

const KINDS = ["containers", "networks", "volumes", "images"] as const;
const BEFORE = "daemon-before";
const AFTER = "daemon-after";
const COMMAND_KIND: Record<string, string> = {
  container: "containers",
  network: "networks",
  volume: "volumes",
  image: "images",
};

async function exercise(missing?: string) {
  const owned = createSupervisedUnixFixture(
    "hook-reader.sock",
    process.env[SCRATCH_SUPERVISION_LEASE_ENV]
  );
  try {
    writeFileSync(
      join(owned.root, "hook-observation.json"),
      JSON.stringify(
        ["test", "queue_test", "cache_test", "cable_test"].map(role => ({
          role,
          physical_schema: true,
          native_rows: 1,
          administrator_read_denied: true,
        }))
      ),
      { mode: 0o600, flag: "wx" }
    );
    const observations =
      await import("../../fixtures/npm-update-hosted-runtime/observations.mjs");
    const { qualifyComponents } =
      await import("../../fixtures/npm-update-hosted-runtime/components.mjs");
    const stages: string[] = [];
    const summary = {
      nativeSuccess: false,
      ownedRootAbsent: true,
      foreignResourcesPreserved: false,
      cleanupFailures: [] as object[],
      native: [] as object[],
    };
    let failure: unknown;
    const native = async (
      stage: string,
      _cwd: string,
      _env: object,
      command: string,
      args: string[]
    ) => {
      stages.push(stage);
      if (stage === BEFORE || stage === AFTER) {
        const kind = COMMAND_KIND[args[0] ?? ""];
        const rows =
          stage === AFTER && kind === missing ? [] : [`foreign-${kind}`];
        return {
          code: 0,
          stdout: Buffer.from(`${rows.join("\n")}\n`),
          stderr: Buffer.alloc(0),
        };
      }
      if (stage === "original-push" && command === "/bin/sh")
        return {
          code: 0,
          stderr: Buffer.alloc(0),
          stdout: Buffer.from(
            JSON.stringify({
              nativeBind: true,
              socketAbsent: true,
              tokenBytes: 32,
              socketBytes: 95,
              root: join(owned.root, "absent-socket-root"),
            })
          ),
        };
      return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    };
    try {
      await qualifyComponents(
        owned.root,
        owned.root,
        {},
        native,
        summary,
        Date.now() + 10000
      );
    } catch (error) {
      failure = error;
    }
    observations.finishQualification(summary, failure as Error | undefined);
    return { summary, failure, stages };
  } finally {
    await owned.close();
  }
}

describe("actual component qualification preservation decision", () => {
  it("observes nonempty inventories for all four kinds before certifying preservation", async () => {
    const { summary, failure, stages } = await exercise();
    expect(failure).toBeUndefined();
    expect(stages.filter(stage => stage === BEFORE)).toHaveLength(4);
    expect(stages.filter(stage => stage === AFTER)).toHaveLength(4);
    expect(summary).toMatchObject({
      foreignResourcesPreserved: true,
      nativeSuccess: true,
    });
  });
  it.each(KINDS)(
    "refuses missing prior %s and keeps overall qualification false",
    async kind => {
      const { summary, failure, stages } = await exercise(kind);
      expect(stages.filter(stage => stage === AFTER)).toHaveLength(4);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(
        "npm updater: foreign daemon resources changed"
      );
      expect(summary).toMatchObject({
        foreignResourcesPreserved: false,
        nativeSuccess: false,
      });
      expect(summary.cleanupFailures).toHaveLength(1);
    }
  );
});
