/** Independent expected content for skills whose routing metadata is compacted. */
import { load as parseYaml } from "js-yaml";

/**
 * Preserve the complete authored description and every original body byte.
 * @param source - Authored skill with YAML frontmatter.
 * @returns Expected lazy content after compacting its long routing metadata.
 */
export function routingPrefacedBody(source: string): string {
  const [, frontmatter, body] =
    /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source) ?? [];
  if (frontmatter === undefined || body === undefined) {
    throw new Error("Authored skill frontmatter is missing");
  }
  const metadata = parseYaml(frontmatter) as Record<string, unknown>;
  if (typeof metadata.description !== "string") {
    throw new Error("Authored skill description is missing");
  }
  return `${metadata.description}\n\n${body}`;
}
