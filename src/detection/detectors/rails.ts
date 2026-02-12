/**
 * Rails project type detector
 *
 * Identifies Ruby on Rails projects by checking for definitive Rails signals:
 * `bin/rails` (primary) or `config/application.rb` (secondary). These markers
 * avoid false positives from other Ruby frameworks like Hanami.
 *
 * @module detection/detectors/rails
 */
import * as path from "node:path";
import type { IProjectTypeDetector } from "../detector.interface.js";
import { pathExists } from "../../utils/index.js";

/**
 * Detector for Ruby on Rails projects
 * Detects by presence of bin/rails or config/application.rb
 */
export class RailsDetector implements IProjectTypeDetector {
  readonly type = "rails" as const;

  /**
   * Detect if the project uses Ruby on Rails
   * @param destDir - Project directory to check
   * @returns True if Rails is detected
   */
  async detect(destDir: string): Promise<boolean> {
    // Check for bin/rails (primary indicator)
    const binRailsPath = path.join(destDir, "bin", "rails");
    if (await pathExists(binRailsPath)) {
      return true;
    }

    // Check for config/application.rb (secondary indicator)
    const configAppPath = path.join(destDir, "config", "application.rb");
    return pathExists(configAppPath);
  }
}
