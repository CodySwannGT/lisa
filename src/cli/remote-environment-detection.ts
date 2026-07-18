import { readFile } from "node:fs/promises";
import * as path from "node:path";
import type { ProjectType } from "../core/config.js";
import { readJsonOrNull } from "../utils/index.js";
import { requirementsForFlags } from "./remote-environment-catalog.js";
import type {
  IntegrationFlags,
  VariableRequirement,
} from "./remote-environment-contract.js";

/** Selected host-project surfaces used by integration detectors. */
interface ProjectSignals {
  readonly dependencies: ReadonlySet<string>;
  readonly envExample: string;
  readonly remoteSetup: string;
  readonly workflows: string;
}

/**
 * Read a UTF-8 file, returning an empty string when it is absent.
 * @param filePath - Absolute path
 * @returns File contents or an empty string
 */
export async function readTextOrEmpty(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (code === "ENOENT") return "";
    throw error;
  }
}

/**
 * Return whether a project-relative file exists.
 * @param destDir - Project root
 * @param relativePath - Project-relative path
 * @returns True when the file can be read and is non-empty
 */
export async function projectFileExists(
  destDir: string,
  relativePath: string
): Promise<boolean> {
  return (await readTextOrEmpty(path.join(destDir, relativePath))) !== "";
}

/**
 * Read dependency names and selected project-owned integration surfaces.
 * @param destDir - Project root
 * @returns Signals used by the requirement detectors
 */
async function readProjectSignals(destDir: string): Promise<ProjectSignals> {
  const packageJson = await readJsonOrNull<{
    readonly dependencies?: Readonly<Record<string, unknown>>;
    readonly devDependencies?: Readonly<Record<string, unknown>>;
  }>(path.join(destDir, "package.json"));
  const dependencies = new Set([
    ...Object.keys(packageJson?.dependencies ?? {}),
    ...Object.keys(packageJson?.devDependencies ?? {}),
  ]);
  const workflows = ["ci", "deploy", "quality"].flatMap(name => [
    `.github/workflows/${name}.yml`,
    `.github/workflows/${name}.yaml`,
  ]);
  const [envExample, remoteSetup, ...workflowContents] = await Promise.all([
    readTextOrEmpty(path.join(destDir, ".env.example")),
    readTextOrEmpty(path.join(destDir, "scripts/claude-remote-setup.sh")),
    ...workflows.map(relativePath =>
      readTextOrEmpty(path.join(destDir, relativePath))
    ),
  ]);
  return {
    dependencies,
    envExample,
    remoteSetup,
    workflows: workflowContents.join("\n"),
  };
}

/**
 * Test dependency presence by exact name or namespace prefix.
 * @param dependencies - Project dependency names
 * @param names - Exact names or prefixes ending in `/`
 * @returns Whether any dependency matches
 */
function hasDependency(
  dependencies: ReadonlySet<string>,
  names: readonly string[]
): boolean {
  return Array.from(dependencies).some(dependency =>
    names.some(name =>
      name.endsWith("/") ? dependency.startsWith(name) : dependency === name
    )
  );
}

/**
 * Detect active project integrations from dependencies and committed surfaces.
 * @param destDir - Project root
 * @param projectTypes - Detected Lisa project types
 * @param signals - Project signals
 * @returns Boolean integration flags
 */
async function detectIntegrationFlags(
  destDir: string,
  projectTypes: readonly ProjectType[],
  signals: ProjectSignals
): Promise<IntegrationFlags> {
  const { dependencies, envExample, remoteSetup, workflows } = signals;
  const [serverlessYml, serverlessYaml, sstTs, sstJs, sonar, eas, maestro] =
    await Promise.all(
      [
        "serverless.yml",
        "serverless.yaml",
        "sst.config.ts",
        "sst.config.js",
        "sonar-project.properties",
        "eas.json",
        ".maestro/config.yaml",
      ].map(relativePath => projectFileExists(destDir, relativePath))
    );
  return {
    aws:
      projectTypes.includes("cdk") ||
      hasDependency(dependencies, [
        "@aws-sdk/",
        "aws-cdk-lib",
        "serverless",
        "sst",
      ]) ||
      /^(AWS_PROFILE|CDK_CONTEXT_ACCOUNT|CDK_CONTEXT_ENV)=/mu.test(
        envExample
      ) ||
      [serverlessYml, serverlessYaml, sstTs, sstJs].some(Boolean),
    eas:
      projectTypes.includes("expo") &&
      (eas || workflows.includes("EXPO_TOKEN")),
    figma: remoteSetup.includes("FIGMA_ACCESS_TOKEN"),
    jam: hasDependency(dependencies, ["@jam.dev/"]),
    maestro: maestro === true && workflows.includes("MAESTRO_API_KEY"),
    sentry:
      hasDependency(dependencies, ["@sentry/"]) &&
      (remoteSetup.includes("SENTRY_AUTH_TOKEN") ||
        workflows.includes("SENTRY_AUTH_TOKEN")),
    sonar:
      sonar === true &&
      (remoteSetup.includes("SONAR_TOKEN") ||
        workflows.includes("SONAR_TOKEN")),
  };
}

/**
 * Build requirements activated by detected project type and integrations.
 * @param destDir - Project root
 * @param projectTypes - Detected Lisa project types
 * @returns Project-specific requirements
 */
export async function detectedProjectRequirements(
  destDir: string,
  projectTypes: readonly ProjectType[]
): Promise<readonly VariableRequirement[]> {
  const signals = await readProjectSignals(destDir);
  const flags = await detectIntegrationFlags(destDir, projectTypes, signals);
  return requirementsForFlags(flags, projectTypes);
}
