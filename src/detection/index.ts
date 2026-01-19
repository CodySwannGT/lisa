import type { ProjectType } from "../core/config.js";
import { PROJECT_TYPE_HIERARCHY, PROJECT_TYPE_ORDER } from "../core/config.js";
import type { IProjectTypeDetector } from "./detector.interface.js";
import { TypeScriptDetector } from "./detectors/typescript.js";
import { ExpoDetector } from "./detectors/expo.js";
import { NestJSDetector } from "./detectors/nestjs.js";
import { CDKDetector } from "./detectors/cdk.js";
import { NpmPackageDetector } from "./detectors/npm-package.js";

export type { IProjectTypeDetector } from "./detector.interface.js";

/**
 * Registry for project type detectors
 */
export class DetectorRegistry {
  private readonly detectors: readonly IProjectTypeDetector[];

  /**
   * Initialize detector registry with provided or default detectors
   * @param detectors - Optional array of detectors (uses defaults if omitted)
   */
  constructor(detectors?: readonly IProjectTypeDetector[]) {
    this.detectors = detectors ?? [
      new TypeScriptDetector(),
      new NpmPackageDetector(),
      new ExpoDetector(),
      new NestJSDetector(),
      new CDKDetector(),
    ];
  }

  /**
   * Detect all project types in the given directory
   * @param destDir - Project directory to scan
   * @returns Array of detected project types
   */
  async detectAll(destDir: string): Promise<ProjectType[]> {
    const detectedTypes: ProjectType[] = [];

    for (const detector of this.detectors) {
      if (await detector.detect(destDir)) {
        detectedTypes.push(detector.type);
      }
    }

    return detectedTypes;
  }

  /**
   * Expand detected types to include parent types and order correctly
   *
   * Child types (expo, nestjs, cdk) automatically include their parent (typescript)
   * @param detectedTypes - Project types to expand
   * @returns Ordered array with parent types included
   */
  expandAndOrderTypes(detectedTypes: readonly ProjectType[]): ProjectType[] {
    const allTypes = new Set<ProjectType>();

    // Add all detected types and their parents
    for (const type of detectedTypes) {
      allTypes.add(type);

      const parent = PROJECT_TYPE_HIERARCHY[type];
      if (parent !== undefined) {
        allTypes.add(parent);
      }
    }

    // Return in canonical order (typescript first, then others)
    return PROJECT_TYPE_ORDER.filter(type => allTypes.has(type));
  }
}

/**
 * Create default detector registry
 * @returns New DetectorRegistry instance with all default detectors
 */
export function createDetectorRegistry(): DetectorRegistry {
  return new DetectorRegistry();
}
