import * as path from 'node:path';
import type { IProjectTypeDetector } from '../detector.interface.js';
import { pathExists, readJsonOrNull } from '../../utils/index.js';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Detector for TypeScript projects
 * Detects by presence of tsconfig.json or typescript dependency
 */
export class TypeScriptDetector implements IProjectTypeDetector {
  readonly type = 'typescript' as const;

  async detect(destDir: string): Promise<boolean> {
    // Check for tsconfig.json
    const tsconfigPath = path.join(destDir, 'tsconfig.json');
    if (await pathExists(tsconfigPath)) {
      return true;
    }

    // Check for typescript in package.json
    const packageJsonPath = path.join(destDir, 'package.json');
    const packageJson = await readJsonOrNull<PackageJson>(packageJsonPath);

    if (!packageJson) {
      return false;
    }

    return (
      packageJson.dependencies?.['typescript'] !== undefined ||
      packageJson.devDependencies?.['typescript'] !== undefined
    );
  }
}
