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
/* eslint-disable max-lines -- Large complex strategy with many helper methods */
import * as fse from "fs-extra";
import { copyFile } from "node:fs/promises";
import type { FileOperationResult } from "../core/config.js";
import type { ICopyStrategy, StrategyContext } from "./strategy.interface.js";
import { ensureParentDir } from "../utils/file-operations.js";
import { readJson, writeJson } from "../utils/json-utils.js";
import { JsonMergeError } from "../errors/index.js";
import type { BehaviorType, TagSection } from "./tagged-merge-types.js";

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
   * Regex pattern for parsing opening tags
   * @remarks Captures behavior (force|defaults|merge) and category name for routing to appropriate merge logic
   */
  private readonly tagPattern = /^\/\/lisa-(force|defaults|merge)-(.+)$/;

  /**
   * Apply tagged merge strategy to a JSON file
   * @param sourcePath - Absolute path to Lisa template JSON file with tags
   * @param destPath - Absolute path to project JSON file to merge into
   * @param relativePath - Project-relative path for manifest recording and logging
   * @param context - Strategy context with config, manifest recording, and backup functions
   * @returns Operation result indicating copied, skipped, or merged action
   * @throws JsonMergeError if source or destination JSON cannot be parsed
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
    const { config, recordFile, backupFile } = context;
    const destExists = await fse.pathExists(destPath);

    if (!destExists) {
      if (!config.dryRun) {
        await ensureParentDir(destPath);
        await copyFile(sourcePath, destPath);
        recordFile(relativePath, this.name);
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

    const merged = this.mergeWithTags(sourceJson, destJson);
    const normalizedDest = JSON.stringify(destJson, null, 2);
    const normalizedMerged = JSON.stringify(merged, null, 2);

    if (normalizedDest === normalizedMerged) {
      if (!config.dryRun) {
        recordFile(relativePath, this.name);
      }
      return { relativePath, strategy: this.name, action: "skipped" };
    }

    if (!config.dryRun) {
      await backupFile(destPath);
      await writeJson(destPath, merged);
      recordFile(relativePath, this.name);
    }

    return { relativePath, strategy: this.name, action: "merged" };
  }

  /**
   * Merge source and destination JSON using tagged sections
   * @param source - Lisa template JSON containing tag markers and governed content
   * @param dest - Project JSON with potential customizations to preserve
   * @returns Merged JSON with tagged sections applied according to their behavior types
   * @remarks
   * Processing order: 1) Process all tagged sections from source applying their behaviors,
   * 2) Add unprocessed content from destination (preserves project customizations),
   * 3) Add any remaining unprocessed tags from source. This ensures governance while
   * preserving project-specific additions outside tagged regions.
   */
  private mergeWithTags(
    source: Record<string, unknown>,
    dest: Record<string, unknown>
  ): Record<string, unknown> {
    const sourceTags = this.parseTaggedSections(source);
    const result: Record<string, unknown> = {};
    const processed = new Set<string>();
    const processedTags = new Set<string>();

    for (const key in source) {
      if (this.isOpeningTag(key)) {
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
    this.addUnprocessedTags(result, source, processedTags, processed);
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
      if (
        !processed.has(key) &&
        !processedTags.has(key) &&
        !this.isTagKey(key)
      ) {
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
      if (
        this.isTagKey(key) &&
        !processedTags.has(key) &&
        !processed.has(key)
      ) {
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
    const tagMatch = this.tagPattern.exec(key);
    if (!tagMatch || !tagMatch[2]) return;

    const behavior = tagMatch[1] as BehaviorType;
    const category = tagMatch[2] as string;
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
   * Parse JSON object to extract all tagged sections with their boundaries
   * @param obj - JSON object to parse for tag markers
   * @returns Map of opening tag keys to section info (behavior, category, content keys, close key)
   * @remarks
   * Relies on JSON key ordering being preserved (standard in modern JS engines).
   * Skips sections without matching closing tags to handle malformed input gracefully.
   */
  private parseTaggedSections(
    obj: Record<string, unknown>
  ): Map<string, TagSection> {
    const sections = new Map<string, TagSection>();
    const keys: string[] = Object.keys(obj);

    keys.forEach((key: string, i: number) => {
      if (!this.isOpeningTag(key)) return;
      const match = this.tagPattern.exec(key);
      if (!match || !match[2]) return;

      const behavior = match[1] as BehaviorType;
      const category = match[2] as string;
      const closeKey = `//end-lisa-${behavior}-${category}`;
      const closeIndex = keys.indexOf(closeKey);
      if (closeIndex === -1) return;

      const contentKeys = keys.slice(i + 1, closeIndex) as string[];
      sections.set(key, { behavior, category, contentKeys, closeKey });
    });

    return sections;
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
    const destSection = this.findAndExtractDestinationSection(
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
   * Locate and extract the matching tagged section from destination JSON
   * @param dest - Project JSON to search for matching tags
   * @param section - Source section info containing behavior type
   * @param category - Tag category name to match
   * @returns Extracted section info if found, undefined if project lacks the section
   */
  private findAndExtractDestinationSection(
    dest: Record<string, unknown>,
    section: TagSection,
    category: string
  ): TagSection | undefined {
    const destSectionStart = this.findSectionStart(
      dest,
      section.behavior,
      category
    );

    return destSectionStart
      ? this.extractSectionContent(
          dest,
          destSectionStart as string,
          section.behavior,
          category
        )
      : undefined;
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
        result[key] = this.deduplicateArrays(sourceValue, destValue);
      } else if (sourceValue !== undefined) {
        result[key] = sourceValue;
      } else if (destValue !== undefined) {
        result[key] = destValue;
      }
    }

    result[section.closeKey] = source[section.closeKey];
  }

  /**
   * Combine two arrays, removing duplicates while preserving order
   * @param sourceArray - Lisa template array (items added first)
   * @param destArray - Project array (unique items added after)
   * @returns Combined array with source items first, then project's unique additions
   * @remarks
   * Uses JSON.stringify for value equality, so objects/arrays with same content
   * are considered duplicates. This allows deduplicating complex items like
   * package names with version specifiers.
   */
  private deduplicateArrays(
    sourceArray: unknown[],
    destArray: unknown[]
  ): unknown[] {
    const seen = new Set<string>();
    const result: unknown[] = [];

    for (const item of sourceArray) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }

    for (const item of destArray) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }

    return result;
  }

  /**
   * Test if a key is an opening tag (matches `//lisa-<behavior>-<category>` format)
   * @param key - JSON key to test
   * @returns True if key matches the opening tag pattern
   */
  private isOpeningTag(key: string): boolean {
    return this.tagPattern.test(key);
  }

  /**
   * Test if a key is any tag-like comment key (starts with `//`)
   * @param key - JSON key to test
   * @returns True if key is a JSON comment (convention used for documentation/tags)
   */
  private isTagKey(key: string): boolean {
    return key.startsWith("//");
  }

  /**
   * Find opening tag key for a given behavior and category in an object
   * @param obj - Object to search for the tag
   * @param behavior - Tag behavior type (force, defaults, merge)
   * @param category - Tag category name
   * @returns Tag key string if found, undefined if object lacks this tag
   */
  private findSectionStart(
    obj: Record<string, unknown>,
    behavior: BehaviorType,
    category: string
  ): string | undefined {
    const tagKey = `//lisa-${behavior}-${category}`;
    return tagKey in obj ? tagKey : undefined;
  }

  /**
   * Extract section boundaries and content keys between opening and closing tags
   * @param obj - Object containing the tagged section
   * @param startKey - Opening tag key that marks section start
   * @param behavior - Tag behavior type (for constructing close key)
   * @param category - Tag category name (for constructing close key)
   * @returns Complete section info including content keys between tags
   */
  private extractSectionContent(
    obj: Record<string, unknown>,
    startKey: string,
    behavior: BehaviorType,
    category: string
  ): TagSection {
    const closeKey = `//end-lisa-${behavior}-${category}`;
    const keys: string[] = Object.keys(obj);
    const startIndex = keys.indexOf(startKey);
    const closeIndex = keys.indexOf(closeKey);
    const contentKeys = this.extractContentKeysFromRange(
      startIndex,
      closeIndex,
      keys
    );

    return {
      behavior,
      category,
      contentKeys,
      closeKey,
    };
  }

  /**
   * Extract keys between opening and closing tag indices
   * @param startIndex - Index of opening tag in keys array
   * @param closeIndex - Index of closing tag in keys array
   * @param keys - Ordered array of all keys in the object
   * @returns Array of content keys between the tags, empty if indices invalid
   */
  private extractContentKeysFromRange(
    startIndex: number,
    closeIndex: number,
    keys: string[]
  ): string[] {
    if (startIndex === -1 || closeIndex === -1 || startIndex >= closeIndex) {
      return [];
    }
    return keys.slice(startIndex + 1, closeIndex) as string[];
  }
}
/* eslint-enable max-lines -- End of TaggedMergeStrategy */
