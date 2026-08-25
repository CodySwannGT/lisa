import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import * as path from "node:path";

const require = createRequire(import.meta.url);

describe("the Expo Lighthouse collect template", () => {
  it("forwards project-specific static discovery options", () => {
    const destination = mkdtempSync(
      path.join(tmpdir(), "lisa-lighthouse-collect-")
    );
    const previousChromePath = process.env.CHROME_PATH;

    try {
      process.env.CHROME_PATH = "/environment/chrome";
      const template = path.join(
        process.cwd(),
        "expo/create-only/lighthouserc.js"
      );
      const installedTemplate = path.join(destination, "lighthouserc.js");
      copyFileSync(template, installedTemplate);
      writeFileSync(
        path.join(destination, "lighthouserc-config.json"),
        JSON.stringify({
          collect: {
            staticDistDir: "./public",
            numberOfRuns: 2,
            autodiscoverUrlBlocklist: ["/generated-placeholder.html"],
            maxAutodiscoverUrls: 8,
            chromePath: "/configured/chrome",
          },
        })
      );

      const config = require(installedTemplate) as {
        ci: { collect: Record<string, unknown> };
      };

      expect(config.ci.collect).toMatchObject({
        staticDistDir: "./public",
        numberOfRuns: 2,
        autodiscoverUrlBlocklist: ["/generated-placeholder.html"],
        maxAutodiscoverUrls: 8,
        chromePath: "/configured/chrome",
      });
    } finally {
      if (previousChromePath === undefined) {
        delete process.env.CHROME_PATH;
      } else {
        process.env.CHROME_PATH = previousChromePath;
      }
      rmSync(destination, { recursive: true, force: true });
    }
  });
});
