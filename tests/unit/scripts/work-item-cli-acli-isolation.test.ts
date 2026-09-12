/** The in-process Jira fixture must never resolve an ambient tracker CLI. */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  cleanupFixtures,
  cleanupTemplates,
  cli,
  createFixture,
} from "../../support/work-item-cli.js";

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

describe("Jira CLI fixture isolation", () => {
  it.each([false, true])(
    "ignores an ambient acli (installed: %s)",
    installed => {
      const fixture = createFixture({
        tracker: "jira",
        jira: { project: "LAS" },
        atlassian: { site: "acme.atlassian.net" },
        workItem: { verify: "full" },
      });
      const ambient = path.join(fixture.root, "ambient-bin");
      const marker = path.join(fixture.root, "ambient-called");
      mkdirSync(ambient);
      if (installed) {
        writeFileSync(
          path.join(ambient, "acli"),
          '#!/bin/sh\nprintf called > "$ACLI_MARKER"\nexit 1\n',
          { mode: 0o755 }
        );
      }
      const bin = path.join(fixture.root, "fake-bin");
      const env = {
        ...fixture.env,
        ACLI_MARKER: marker,
        ATLASSIAN_API_TOKEN: "",
        JIRA_API_TOKEN: "",
        JIRA_LOGIN: "",
        PATH: `${bin}:${ambient}:/usr/bin:/bin`,
      };
      const resolved = boundedSpawnSync({
        label: "resolve fixture acli",
        command: "/bin/sh",
        args: ["-c", "command -v acli"],
        cwd: fixture.root,
        env,
      });
      expect(resolved.status).toBe(0);
      expect(resolved.stdout.trim()).toBe(path.join(bin, "acli"));

      const message = path.join(fixture.root, "MSG");
      writeFileSync(message, "fix: example\n\nWork-Item: LAS-12\n");
      const result = cli(fixture, ["validate-commit", message], env);
      expect(result.exitCode).toBeUndefined();
      expect(result.stderr).toContain("acli is not authenticated");
      expect(existsSync(marker)).toBe(false);
    }
  );
});
