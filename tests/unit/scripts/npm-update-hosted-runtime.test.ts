/** Synthetic lifecycle collaborators exercise canonical ordering/env/error transport, not provider or Linux authority. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  events: [] as string[],
  auth: 0,
  failed: false,
  closed: 0,
  closeFailure: false,
  qualifiedPath: "/qualified/bin:/usr/bin",
  schemaFailure: "synthetic schema failure",
  env: {} as Record<string, string>,
}));
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/npm-update-hosted-scope.mjs",
  () => ({
    openHostedReadScope: vi.fn(),
    authenticateHostedRuntime: async () => {
      state.events.push("authenticate");
      if (state.auth !== 0) throw new Error("synthetic canonical refusal");
    },
  })
);
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/npm-update-rails-tools.mjs",
  () => ({
    prepareRailsTools: async (
      _context: unknown,
      _root: string,
      env: Record<string, string>
    ) => {
      state.events.push("tools");
      return {
        docker: {},
        env: {
          ...env,
          PATH: state.qualifiedPath,
          BUNDLER_VERSION: "2.4.10",
          DOCKER_CONFIG: "/private/docker",
          CHROMEDRIVER: "/qualified/driver",
          BUNDLE_BUILD__MYSQL2: "qualified-client",
        },
      };
    },
  })
);
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/npm-update-rails-mysql.mjs",
  () => ({
    openRailsMysqlRuntime: async (
      _context: unknown,
      env: Record<string, string>
    ) => {
      state.events.push("runtime");
      state.env = env;
      return {
        env: {
          ...env,
          DATABASE_NAME: "fixture",
          DATABASE_USER: "owned",
          DATABASE_PASSWORD: "synthetic",
          DATABASE_PORT: "1234",
          PRIMARY_DB_HOST: "127.0.0.1",
          DATABASE_REPLICA_HOST: "127.0.0.1",
          DATABASE_SSL: "false",
          DATABASE_IAM_AUTH: "false",
          RAILS_ENV: "test",
          RACK_ENV: "test",
        },
        prepareSchemas: async () => {
          state.events.push("schemas");
          if (state.failed) throw new Error(state.schemaFailure);
        },
        close: async () => {
          state.closed++;
          if (state.closeFailure)
            throw new Error("synthetic runtime close failure");
        },
      };
    },
  })
);
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs",
  async original => ({
    ...(await original<object>()),
    runProcess: async (
      _command: string,
      _args: string[],
      options: { env: Record<string, string> }
    ) => {
      state.events.push("install");
      expect(options.env.PATH).toBe(state.qualifiedPath);
      return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    },
  })
);

import { prepareRailsApplication } from "../../../all/copy-overwrite/scripts/lib/npm-update-hosted-gate.mjs";
import { createSupervisedUnixFixture } from "../../helpers/supervised-unix-fixture.js";
import { SCRATCH_SUPERVISION_LEASE_ENV } from "../../../src/configs/vitest/scratch-supervision.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

async function fixture(
  operation: (root: string, context: any) => Promise<void>
) {
  const scratch = createSupervisedUnixFixture(
    "hook-reader.sock",
    process.env[SCRATCH_SUPERVISION_LEASE_ENV]
  );
  try {
    for (const name of [
      "package.json",
      "package-lock.json",
      "Gemfile",
      "Gemfile.lock",
    ])
      writeFileSync(join(scratch.root, name), "synthetic frozen input", {
        flag: "wx",
        mode: 0o600,
      });
    await operation(scratch.root, {
      cwd: scratch.root,
      deadline: Date.now() + 10000,
      proposal: {},
    });
  } finally {
    scratch.close();
  }
}

beforeEach(() => {
  state.events = [];
  state.auth = 0;
  state.failed = false;
  state.closed = 0;
  state.closeFailure = false;
  state.env = {};
});
describe("authenticated hosted Rails orchestration", () => {
  it("authenticates before tools and prepares schemas only after frozen installation while preserving qualified hook env", async () => {
    await fixture(async (root, context) => {
      const result = await prepareRailsApplication(
        context,
        root,
        { HOME: root, PATH: "/usr/bin" },
        {},
        { database: "fixture" }
      );
      expect(state.events).toEqual([
        "authenticate",
        "tools",
        "install",
        "install",
        "runtime",
        "schemas",
      ]);
      expect(state.env.BUNDLE_FROZEN).toBe("true");
      expect(state.env.BUNDLER_VERSION).toBe("2.4.10");
      expect(state.env.CHROMEDRIVER).toBeUndefined();
      expect(result.env).toMatchObject({
        PATH: state.qualifiedPath,
        CHROMEDRIVER: "/qualified/driver",
        DOCKER_CONFIG: "/private/docker",
        BUNDLER_VERSION: "2.4.10",
        DATABASE_NAME: "fixture",
        RAILS_ENV: "test",
      });
      await result.close();
      expect(state.closed).toBe(1);
    });
  });
  it("refuses failed canonical authentication before any installation or allocation", async () => {
    await fixture(async (root, context) => {
      state.auth = 10;
      await expect(
        prepareRailsApplication(
          context,
          root,
          { HOME: root, PATH: "/usr/bin" },
          {},
          {}
        )
      ).rejects.toThrow("synthetic canonical refusal");
      expect(state.events).toEqual(["authenticate"]);
      expect(state.closed).toBe(0);
    });
  });
  it("retains schema failure and closes the allocated runtime", async () => {
    await fixture(async (root, context) => {
      state.failed = true;
      await expect(
        prepareRailsApplication(
          context,
          root,
          { HOME: root, PATH: "/usr/bin" },
          {},
          {}
        )
      ).rejects.toThrow(state.schemaFailure);
      expect(state.closed).toBe(1);
    });
  });
  it("preserves the original schema error when owned runtime cleanup also fails", async () => {
    await fixture(async (root, context) => {
      state.failed = true;
      state.closeFailure = true;
      await expect(
        prepareRailsApplication(
          context,
          root,
          { HOME: root, PATH: "/usr/bin" },
          {},
          {}
        )
      ).rejects.toMatchObject({
        name: "AggregateError",
        cause: { message: state.schemaFailure },
        errors: [
          expect.objectContaining({ message: state.schemaFailure }),
          expect.objectContaining({
            message: "synthetic runtime close failure",
          }),
        ],
      });
      expect(state.closed).toBe(1);
    });
  });
});
