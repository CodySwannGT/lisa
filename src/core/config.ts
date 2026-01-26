/**
 * Copy strategy types for handling file operations
 */
export type CopyStrategy =
  | "copy-overwrite"
  | "copy-contents"
  | "create-only"
  | "merge";

/**
 * Available project types that Lisa can detect and configure
 */
export type ProjectType =
  | "typescript"
  | "expo"
  | "nestjs"
  | "cdk"
  | "npm-package";

/**
 * Project type hierarchy - child types include their parent types
 */
export const PROJECT_TYPE_HIERARCHY: Readonly<
  Record<string, ProjectType | undefined>
> = {
  expo: "typescript",
  nestjs: "typescript",
  cdk: "typescript",
  "npm-package": "typescript",
  typescript: undefined,
} as const;

/**
 * Canonical order for processing project types (parents before children)
 */
export const PROJECT_TYPE_ORDER: readonly ProjectType[] = [
  "typescript",
  "npm-package",
  "expo",
  "nestjs",
  "cdk",
] as const;

/**
 * All available copy strategies in processing order
 */
export const COPY_STRATEGIES: readonly CopyStrategy[] = [
  "copy-overwrite",
  "copy-contents",
  "create-only",
  "merge",
] as const;

/**
 * Runtime configuration for Lisa operations
 */
export interface LisaConfig {
  /** Path to Lisa installation directory (containing configs) */
  readonly lisaDir: string;

  /** Path to destination project directory */
  readonly destDir: string;

  /** If true, show what would be done without making changes */
  readonly dryRun: boolean;

  /** If true, auto-accept all prompts (non-interactive mode) */
  readonly yesMode: boolean;

  /** If true, only validate compatibility without applying */
  readonly validateOnly: boolean;
}

/**
 * Operation mode for Lisa execution
 */
export type OperationMode = "apply" | "validate" | "uninstall";

/**
 * Result of a single file operation
 */
export interface FileOperationResult {
  readonly relativePath: string;
  readonly strategy: CopyStrategy;
  readonly action:
    | "copied"
    | "skipped"
    | "overwritten"
    | "appended"
    | "merged"
    | "created";
  readonly linesAdded?: number;
}

/**
 * Counters for operation summary
 */
export interface OperationCounters {
  copied: number;
  skipped: number;
  overwritten: number;
  appended: number;
  merged: number;
  deleted: number;
  ignored: number;
}

/**
 * Structure of deletions.json file
 */
export interface DeletionsConfig {
  /** Paths to delete (files or directories) */
  readonly paths: readonly string[];
}

/**
 * Result of a Lisa operation
 */
export interface LisaResult {
  readonly success: boolean;
  readonly counters: OperationCounters;
  readonly detectedTypes: readonly ProjectType[];
  readonly mode: OperationMode;
  readonly errors: readonly string[];
}

/**
 * Create initial operation counters with all values at zero
 * @returns Operation counters initialized to zero
 */
export function createInitialCounters(): OperationCounters {
  return {
    copied: 0,
    skipped: 0,
    overwritten: 0,
    appended: 0,
    merged: 0,
    deleted: 0,
    ignored: 0,
  };
}
