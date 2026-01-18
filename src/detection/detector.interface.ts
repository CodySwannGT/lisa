import type { ProjectType } from '../core/config.js';

/**
 * Interface for project type detectors
 */
export interface IProjectTypeDetector {
  /** The project type this detector identifies */
  readonly type: ProjectType;

  /**
   * Detect if the given directory contains this project type
   * @param destDir Absolute path to the project directory
   * @returns Promise resolving to true if this project type is detected
   */
  detect(destDir: string): Promise<boolean>;
}
