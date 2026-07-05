import * as fs from "fs-extra";
import * as path from "node:path";

const repoRoot = process.cwd();

describe("gitleaks allowlist templates", () => {
  it("keeps host-owned .gitleaksignore under create-only", async () => {
    await expect(
      fs.pathExists(
        path.join(repoRoot, "typescript", "copy-overwrite", ".gitleaksignore")
      )
    ).resolves.toBe(false);
    await expect(
      fs.pathExists(
        path.join(repoRoot, "typescript", "create-only", ".gitleaksignore")
      )
    ).resolves.toBe(true);
  });

  it("ships shared Lisa gitleaks entries in a local companion file", async () => {
    const localIgnore = await fs.readFile(
      path.join(repoRoot, "typescript", "create-only", ".gitleaksignore.local"),
      "utf8"
    );

    expect(localIgnore).toContain(
      ".github/workflows/quality.yml:curl-auth-user:1093"
    );
  });

  it("combines host and Lisa gitleaks ignore files in the pre-commit hook", async () => {
    const hook = await fs.readFile(
      path.join(
        repoRoot,
        "typescript",
        "copy-contents",
        ".husky",
        "pre-commit"
      ),
      "utf8"
    );

    expect(hook).toContain(".gitleaksignore.local");
    expect(hook).toContain("--gitleaks-ignore-path=$GITLEAKS_COMBINED_IGNORE");
  });
});
