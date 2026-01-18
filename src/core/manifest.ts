import * as fse from "fs-extra";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { CopyStrategy } from "./config.js";

/**
 * Manifest file name
 */
export const MANIFEST_FILENAME = ".lisa-manifest";

/**
 * Entry in the manifest file
 */
export interface ManifestEntry {
  readonly strategy: CopyStrategy;
  readonly relativePath: string;
}

/**
 * Interface for manifest operations
 */
export interface IManifestService {
  /** Initialize or reset the manifest file */
  init(destDir: string, lisaDir: string): Promise<void>;

  /** Record a file entry in the manifest */
  record(relativePath: string, strategy: CopyStrategy): void;

  /** Finalize and write manifest to disk */
  finalize(): Promise<void>;

  /** Read existing manifest from disk */
  read(destDir: string): Promise<readonly ManifestEntry[]>;

  /** Remove the manifest file */
  remove(destDir: string): Promise<void>;
}

/**
 * Service for managing the .lisa-manifest file
 */
export class ManifestService implements IManifestService {
  private entries: ManifestEntry[] = [];
  private manifestPath: string | null = null;
  private lisaDir: string = "";

  async init(destDir: string, lisaDir: string): Promise<void> {
    this.entries = [];
    this.manifestPath = path.join(destDir, MANIFEST_FILENAME);
    this.lisaDir = lisaDir;
  }

  record(relativePath: string, strategy: CopyStrategy): void {
    this.entries.push({ strategy, relativePath });
  }

  async finalize(): Promise<void> {
    if (!this.manifestPath) {
      throw new Error("Manifest not initialized");
    }

    const lines = [
      "# Lisa manifest - DO NOT EDIT",
      `# Generated: ${new Date().toISOString()}`,
      `# Lisa directory: ${this.lisaDir}`,
      "",
      ...this.entries.map(entry => `${entry.strategy}:${entry.relativePath}`),
    ];

    await writeFile(this.manifestPath, lines.join("\n") + "\n", "utf-8");
  }

  async read(destDir: string): Promise<readonly ManifestEntry[]> {
    const manifestPath = path.join(destDir, MANIFEST_FILENAME);

    if (!(await fse.pathExists(manifestPath))) {
      throw new ManifestNotFoundError(manifestPath);
    }

    const content = await readFile(manifestPath, "utf-8");
    const entries: ManifestEntry[] = [];

    for (const line of content.split("\n")) {
      // Skip comments and empty lines
      if (line.startsWith("#") || line.trim() === "") {
        continue;
      }

      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) {
        continue;
      }

      const strategy = line.substring(0, colonIndex) as CopyStrategy;
      const relativePath = line.substring(colonIndex + 1);

      if (isValidStrategy(strategy)) {
        entries.push({ strategy, relativePath });
      }
    }

    return entries;
  }

  async remove(destDir: string): Promise<void> {
    const manifestPath = path.join(destDir, MANIFEST_FILENAME);
    await fse.remove(manifestPath);
  }
}

/**
 * Error thrown when manifest file is not found
 */
export class ManifestNotFoundError extends Error {
  constructor(public readonly manifestPath: string) {
    super(`No Lisa manifest found at: ${manifestPath}`);
    this.name = "ManifestNotFoundError";
  }
}

/**
 * Check if a string is a valid copy strategy
 */
function isValidStrategy(value: string): value is CopyStrategy {
  return ["copy-overwrite", "copy-contents", "create-only", "merge"].includes(
    value
  );
}

/**
 * Create a no-op manifest service for dry-run mode
 */
export class DryRunManifestService implements IManifestService {
  async init(_destDir: string, _lisaDir: string): Promise<void> {
    // No-op
  }

  record(_relativePath: string, _strategy: CopyStrategy): void {
    // No-op
  }

  async finalize(): Promise<void> {
    // No-op
  }

  async read(destDir: string): Promise<readonly ManifestEntry[]> {
    // Delegate to real service for reading
    const realService = new ManifestService();
    return realService.read(destDir);
  }

  async remove(_destDir: string): Promise<void> {
    // No-op
  }
}
