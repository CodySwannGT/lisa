import * as fs from 'fs-extra';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Create a temporary directory for testing
 */
export async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'lisa-test-'));
}

/**
 * Clean up a temporary directory
 */
export async function cleanupTempDir(dir: string): Promise<void> {
  if (dir && (await fs.pathExists(dir))) {
    await fs.remove(dir);
  }
}

/**
 * Create a minimal project structure
 */
export async function createMinimalProject(dir: string): Promise<void> {
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, 'package.json'), {});
}

/**
 * Create a TypeScript project structure
 */
export async function createTypeScriptProject(dir: string): Promise<void> {
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, 'package.json'), {
    dependencies: { typescript: '^5.0.0' },
  });
  await fs.writeJson(path.join(dir, 'tsconfig.json'), {});
}

/**
 * Create an Expo project structure
 */
export async function createExpoProject(dir: string): Promise<void> {
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, 'package.json'), {
    dependencies: { expo: '^50.0.0' },
  });
  await fs.writeJson(path.join(dir, 'app.json'), { expo: { name: 'test-app' } });
}

/**
 * Create a NestJS project structure
 */
export async function createNestJSProject(dir: string): Promise<void> {
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, 'package.json'), {
    dependencies: { '@nestjs/core': '^10.0.0' },
  });
  await fs.writeJson(path.join(dir, 'nest-cli.json'), {});
}

/**
 * Create a CDK project structure
 */
export async function createCDKProject(dir: string): Promise<void> {
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, 'package.json'), {
    dependencies: { 'aws-cdk-lib': '^2.0.0' },
  });
  await fs.writeJson(path.join(dir, 'cdk.json'), {});
}

/**
 * Create a mock Lisa config directory structure
 */
export async function createMockLisaDir(dir: string): Promise<void> {
  // Create all/ directory with test files
  const allCopyOverwrite = path.join(dir, 'all', 'copy-overwrite');
  const allCopyContents = path.join(dir, 'all', 'copy-contents');
  const allCreateOnly = path.join(dir, 'all', 'create-only');
  const allMerge = path.join(dir, 'all', 'merge');

  await fs.ensureDir(allCopyOverwrite);
  await fs.ensureDir(allCopyContents);
  await fs.ensureDir(allCreateOnly);
  await fs.ensureDir(allMerge);

  await fs.writeFile(path.join(allCopyOverwrite, 'test.txt'), 'test content\n');
  await fs.writeFile(path.join(allCopyContents, '.gitignore'), 'node_modules\n.env\n');
  await fs.writeFile(path.join(allCreateOnly, 'README.md'), '# Test\n');
  await fs.writeJson(path.join(allMerge, 'package.json'), { scripts: { test: 'echo test' } });

  // Create typescript/ directory
  const tsCopyOverwrite = path.join(dir, 'typescript', 'copy-overwrite');
  await fs.ensureDir(tsCopyOverwrite);
  await fs.writeFile(path.join(tsCopyOverwrite, 'tsconfig.base.json'), '{}');
}

/**
 * Count files in a directory recursively
 */
export async function countFiles(dir: string): Promise<number> {
  let count = 0;

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        count++;
      }
    }
  }

  if (await fs.pathExists(dir)) {
    await walk(dir);
  }

  return count;
}
