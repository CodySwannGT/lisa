/**
 * @file tagged-merge.ts
 * @description Copy strategy for JSON files using comment-based tags for section-level control
 * @module strategies
 * @remarks
 * This strategy solves a limitation of the regular merge strategy: the inability to
 * force certain values while allowing project overrides in other sections of the same file.
 * By using comment tags as section markers, Lisa can govern critical configs (CI/CD scripts,
 * required dependencies) while projects retain freedom to customize other areas.
 */
import * as fse from "fs-extra";
import { copyFile } from "node:fs/promises";
import type { FileOperationResult } from "../core/config.js";
import type { ICopyStrategy, StrategyContext } from "./strategy.interface.js";
import { ensureParentDir } from "../utils/file-operations.js";
import { readJson, writeJson } from "../utils/json-utils.js";
import { JsonMergeError } from "../errors/index.js";
import { deduplicateArrays } from "./deduplicate-arrays.js";
import {
  findAndExtractDestinationSection,
  getDestinationObject,
  hasNestedTags,
  isOpeningTag,
  isPlainObject,
  isTagKey,
  parseOpeningTag,
  parseTaggedSections,
} from "./tagged-merge-sections.js";
import type { TagSection } from "./tagged-merge-types.js";

/**
 * Implements tagged merge strategy for JSON files with comment-based section control
 * @remarks
 * Supports three tag behaviors:
 * - `//lisa-force-*`: Lisa replaces entire section, project changes ignored (for governance)
 * - `//lisa-defaults-*`: Lisa provides values, project can override (for sensible defaults)
 * - `//lisa-merge-*`: For arrays - combine Lisa's + project's items deduplicated (for shared lists)
 *
 * Tag format: `//lisa-<behavior>-<category>` with matching `//end-lisa-<behavior>-<category>`
 *
 * Order preservation: JSON key ordering is maintained throughout the merge process,
 * ensuring deterministic output and minimal diff noise when configs change.
 */
export class TaggedMergeStrategy implements ICopyStrategy {
  readonly name = "tagged-merge" as const;

  /**
   * Produce the exact tagged-merge result without filesystem access.
   * @param source - Lisa tagged template object
   * @param destination - Existing host object
   * @returns Merged object preserving host-owned sections
   */
  mergeJson(
    source: Record<string, unknown>,
    destination: Record<string, unknown>
  ): Record<string, unknown> {
    return this.mergeWithTags(source, destination);
  }

  /**
   * Apply tagged merge strategy to a JSON file
   * @param sourcePath - Absolute path to Lisa template JSON file with tags
   * @param destPath - Absolute path to project JSON file to merge into
   * @param relativePath - Project-relative path for logging
   * @param context - Strategy context with config and backup functions
   * @returns Operation result indicating copied, skipped, or merged action
   * @throws {JsonMergeError} if source or destination JSON cannot be parsed
   * @remarks
   * When destination doesn't exist, copies source directly. When destination exists,
   * performs tagged merge preserving project customizations outside tagged sections.
   */
  async apply(
    sourcePath: string,
    destPath: string,
    relativePath: string,
    context: StrategyContext
  ): Promise<FileOperationResult> {
    const { config, backupFile } = context;
    const destExists = await fse.pathExists(destPath);

    if (!destExists) {
      if (!config.dryRun) {
        // Records the new file and its missing parents for rollback (#4459).
        await backupFile(destPath);
        await ensureParentDir(destPath);
        await copyFile(sourcePath, destPath);
      }
      return { relativePath, strategy: this.name, action: "copied" };
    }

    const sourceJson = await readJson<Record<string, unknown>>(
      sourcePath
    ).catch(() => {
      throw new JsonMergeError(
        relativePath,
        `Failed to parse source: ${sourcePath}`
      );
    });

    const destJson = await readJson<Record<string, unknown>>(destPath).catch(
      () => {
        throw new JsonMergeError(
          relativePath,
          `Failed to parse destination: ${destPath}`
        );
      }
    );

    const merged = this.mergeJson(sourceJson, destJson);
    const normalizedDest = JSON.stringify(destJson, null, 2);
    const normalizedMerged = JSON.stringify(merged, null, 2);

    if (normalizedDest === normalizedMerged) {
      return { relativePath, strategy: this.name, action: "skipped" };
    }

    if (!config.dryRun) {
      await backupFile(destPath);
      await writeJson(destPath, merged);
    }

    return { relativePath, strategy: this.name, action: "merged" };
  }

  /**
   * Merge source and destination JSON using tagged sections
   * @param source - Lisa template JSON containing tag markers and governed content
   * @param dest - Project JSON with potential customizations to preserve
   * @returns Merged JSON with tagged sections applied according to their behavior types
   * @remarks
   * Processing supports tags at any nesting level. For each tagged section (whether at
   * top level or nested in an object), applies its behavior rules. Order of processing:
   * 1) Process all tagged sections from source recursively, applying their behaviors
   * 2) Add unprocessed content from destination (preserves project customizations)
   * 3) Add any remaining unprocessed tags from source
   * This ensures governance while preserving project-specific additions outside tagged regions.
   */
  private mergeWithTags(
    source: Record<string, unknown>,
    dest: Record<string, unknown>
  ): Record<string, unknown> {
    const sourceTags = parseTaggedSections(source);
    const result: Record<string, unknown> = {};
    const processed = new Set<string>();
    const processedTags = new Set<string>();

    // First, process top-level tags
    for (const key in source) {
      if (isOpeningTag(key)) {
        this.processTaggedSection(
          key,
          source,
          dest,
          sourceTags,
          result,
          processed,
          processedTags
        );
      }
    }

    // Second, process unprocessed objects that might have nested tags
    for (const key in source) {
      if (!processed.has(key) && !isTagKey(key)) {
        this.processNestedTaggedObject(key, source, dest, result, processed);
      }
    }

    this.addUnprocessedContent(result, dest, processed, processedTags);
    this.addUnprocessedTags(result, source, processedTags, processed);
    return result;
  }

  /**
   * Process an object that might contain nested tags
   * @param key - The key of the object to process
   * @param source - Source object containing the nested object
   * @param dest - Destination object containing potential counterpart
   * @param result - Result object being built
   * @param processed - Set of processed keys
   */
  private processNestedTaggedObject(
    key: string,
    source: Record<string, unknown>,
    dest: Record<string, unknown>,
    result: Record<string, unknown>,
    processed: Set<string>
  ): void {
    const sourceValue = source[key];

    if (!isPlainObject(sourceValue)) {
      return;
    }

    const sourceObj = sourceValue;

    if (!hasNestedTags(sourceObj)) {
      return;
    }

    const destObj = getDestinationObject(dest, key);
    const mergedObj = this.mergeObjectWithNestedTags(sourceObj, destObj);
    result[key] = mergedObj;
    processed.add(key);
  }

  /**
   * Merge an object that may contain nested tags
   * @param source - Source object potentially containing tags
   * @param dest - Destination object to merge with
   * @returns Merged object with tags applied appropriately
   */
  private mergeObjectWithNestedTags(
    source: Record<string, unknown>,
    dest: Record<string, unknown>
  ): Record<string, unknown> {
    const sourceTags = parseTaggedSections(source);
    const result: Record<string, unknown> = {};
    const processed = new Set<string>();
    const processedTags = new Set<string>();

    // Process tagged sections within this object
    for (const key in source) {
      if (isOpeningTag(key)) {
        this.processTaggedSection(
          key,
          source,
          dest,
          sourceTags,
          result,
          processed,
          processedTags
        );
      }
    }

    this.addUnprocessedContent(result, dest, processed, processedTags);

    // Add remaining tags from source
    for (const key in source) {
      if (isTagKey(key) && !processedTags.has(key) && !processed.has(key)) {
        result[key] = source[key];
      }
    }

    return result;
  }

  /**
   * Preserve project customizations by adding untagged destination content to result
   * @param result - Result object being built
   * @param dest - Project JSON containing potential customizations
   * @param processed - Keys already processed via tagged sections (to avoid duplicates)
   * @param processedTags - Tag keys already processed (to avoid duplicates)
   * @remarks
   * This is the key step that preserves project freedom: any content outside tagged
   * regions is copied from the project's file unchanged, allowing custom scripts,
   * dependencies, or configs that Lisa doesn't govern.
   */
  private addUnprocessedContent(
    result: Record<string, unknown>,
    dest: Record<string, unknown>,
    processed: Set<string>,
    processedTags: Set<string>
  ): void {
    for (const key in dest) {
      if (!processed.has(key) && !processedTags.has(key) && !isTagKey(key)) {
        result[key] = dest[key];
      }
    }
  }

  /**
   * Add any remaining tag keys from source that weren't part of complete tag pairs
   * @param result - Result object being built
   * @param source - Lisa template JSON
   * @param processedTags - Tag keys already processed as part of complete sections
   * @param processed - Content keys already processed
   * @remarks
   * Handles edge case of orphaned tags (e.g., opening tag without closing tag)
   * by preserving them in output rather than silently dropping them.
   */
  private addUnprocessedTags(
    result: Record<string, unknown>,
    source: Record<string, unknown>,
    processedTags: Set<string>,
    processed: Set<string>
  ): void {
    for (const key in source) {
      if (isTagKey(key) && !processedTags.has(key) && !processed.has(key)) {
        result[key] = source[key];
      }
    }
  }

  /**
   * Process a single tagged section, routing to appropriate behavior handler
   * @param key - Opening tag key (e.g., `//lisa-force-scripts`)
   * @param source - Lisa template JSON
   * @param dest - Project JSON
   * @param sourceTags - Map of all parsed tag sections from source
   * @param result - Result object being built
   * @param processed - Set tracking processed content keys
   * @param processedTags - Set tracking processed tag keys
   * @remarks
   * Routes to applyForceSection, applyDefaultsSection, or applyMergeSection
   * based on the behavior extracted from the tag. All keys within the section
   * (including opening/closing tags) are marked as processed to prevent
   * duplicate handling in subsequent steps.
   */
  private processTaggedSection(
    key: string,
    source: Record<string, unknown>,
    dest: Record<string, unknown>,
    sourceTags: Map<string, TagSection>,
    result: Record<string, unknown>,
    processed: Set<string>,
    processedTags: Set<string>
  ): void {
    const tag = parseOpeningTag(key);
    if (tag === undefined) return;

    const { behavior, category } = tag;
    const section = sourceTags.get(key);
    if (!section) return;

    processedTags.add(key);
    processedTags.add(section.closeKey);
    for (const contentKey of section.contentKeys) {
      processedTags.add(contentKey);
    }

    if (behavior === "force") {
      this.applyForceSection(result, source, section);
    } else if (behavior === "defaults") {
      this.applyDefaultsSection(result, source, dest, section, category);
    } else if (behavior === "merge") {
      this.applyMergeSection(result, source, dest, section, category);
    }

    for (const contentKey of section.contentKeys) {
      processed.add(contentKey);
    }
    processed.add(key);
    processed.add(section.closeKey);
  }

  /**
   * Apply force behavior: Lisa's section replaces project's entirely
   * @param result - Result object being built
   * @param source - Lisa template containing the authoritative values
   * @param section - Section info with content keys to copy
   * @remarks
   * Use force for governance-critical configs that projects must not override,
   * such as CI/CD scripts, required linting commands, or mandatory dev dependencies.
   * Project changes within force-tagged sections are discarded during merge.
   */
  private applyForceSection(
    result: Record<string, unknown>,
    source: Record<string, unknown>,
    section: TagSection
  ): void {
    const openKey = `//lisa-${section.behavior}-${section.category}`;
    result[openKey] = source[openKey];
    for (const key of section.contentKeys) {
      result[key] = source[key];
    }
    result[section.closeKey] = source[section.closeKey];
  }

  /**
   * Apply defaults behavior: project's values take precedence if they exist
   * @param result - Result object being built
   * @param source - Lisa template with default values
   * @param dest - Project JSON with potential overrides
   * @param section - Section info from source
   * @param category - Tag category name for looking up destination section
   * @remarks
   * Use defaults for sensible starting values that projects may legitimately need
   * to customize, such as engine versions or optional configurations. If project
   * has the same tagged section, its content is used; otherwise Lisa's defaults apply.
   */
  private applyDefaultsSection(
    result: Record<string, unknown>,
    source: Record<string, unknown>,
    dest: Record<string, unknown>,
    section: TagSection,
    category: string
  ): void {
    const openKey = `//lisa-${section.behavior}-${category}`;
    result[openKey] = source[openKey];
    this.addDefaultsContent(result, source, dest, section, category);
    result[section.closeKey] = source[section.closeKey];
  }

  /**
   * Add defaults section content, preferring project's version if it has content
   * @param result - Result object being built
   * @param source - Lisa template with fallback values
   * @param dest - Project JSON with potential overrides
   * @param section - Section info from source
   * @param category - Tag category name
   */
  private addDefaultsContent(
    result: Record<string, unknown>,
    source: Record<string, unknown>,
    dest: Record<string, unknown>,
    section: TagSection,
    category: string
  ): void {
    const destSection = findAndExtractDestinationSection(
      dest,
      section,
      category
    );

    if (destSection && destSection.contentKeys.length > 0) {
      for (const key of destSection.contentKeys) {
        if (key in dest) {
          result[key] = dest[key];
        }
      }
    } else {
      this.addSourceContent(result, source, section.contentKeys);
    }
  }

  /**
   * Copy content keys from source template to result
   * @param result - Result object being built
   * @param source - Lisa template containing values to copy
   * @param contentKeys - Keys to copy from source
   */
  private addSourceContent(
    result: Record<string, unknown>,
    source: Record<string, unknown>,
    contentKeys: string[]
  ): void {
    for (const key of contentKeys) {
      result[key] = source[key];
    }
  }

  /**
   * Apply merge behavior: combine arrays from source and dest without duplicates
   * @param result - Result object being built
   * @param source - Lisa template with base array items
   * @param dest - Project JSON with additional array items
   * @param section - Section info with content keys
   * @param category - Tag category name
   * @remarks
   * Use merge for shared lists where both Lisa and projects contribute items,
   * such as trustedDependencies. Lisa's items come first, then project's unique
   * additions. Deduplication uses JSON.stringify for value equality comparison.
   */
  private applyMergeSection(
    result: Record<string, unknown>,
    source: Record<string, unknown>,
    dest: Record<string, unknown>,
    section: TagSection,
    category: string
  ): void {
    const openKey = `//lisa-${section.behavior}-${category}`;
    result[openKey] = source[openKey];

    for (const key of section.contentKeys) {
      const sourceValue = source[key];
      const destValue = dest[key];

      if (Array.isArray(sourceValue) && Array.isArray(destValue)) {
        result[key] = deduplicateArrays(sourceValue, destValue);
      } else if (sourceValue !== undefined) {
        result[key] = sourceValue;
      } else if (destValue !== undefined) {
        result[key] = destValue;
      }
    }

    result[section.closeKey] = source[section.closeKey];
  }
}
