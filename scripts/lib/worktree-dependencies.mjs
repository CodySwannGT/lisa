// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { invokedAsScript } from "./invoked-as-script.mjs";

/**
 * Identify upward dependency resolution outside a nested linked worktree.
 * Reads Git's worktree metadata without installing, moving or modifying anything.
 * Local node_modules, including an explicit symlink, are an intentional install.
 * @param {string} [cwd] Directory from which the tool will resolve dependencies.
 * @returns {string|null} Setup diagnosis, or null when this condition is absent.
 */
export function worktreeDependencyProblem(cwd = process.cwd()) {
  try {
    let root = realpathSync(cwd);
    let localModules = false;
    while (!existsSync(join(root, ".git"))) {
      localModules ||= existsSync(join(root, "node_modules"));
      const parent = dirname(root);
      if (parent === root) return null;
      root = parent;
    }
    if (localModules || existsSync(join(root, "node_modules"))) return null;
    const marker = join(root, ".git");
    if (!statSync(marker).isFile()) return null;
    const gitdir = readFileSync(marker, "utf8")
      .split("\n")
      .find(line => line.startsWith("gitdir:"))
      ?.slice("gitdir:".length)
      .trim();
    if (!gitdir) return null;
    const control = resolve(root, gitdir.trim());
    // commondir distinguishes a linked worktree from a submodule's .git file.
    realpathSync(
      resolve(control, readFileSync(join(control, "commondir"), "utf8").trim())
    );
    let modules = "";
    let enclosingCheckout = false;
    for (let parent = dirname(root); ; parent = dirname(parent)) {
      if (!modules && existsSync(join(parent, "node_modules")))
        modules = join(parent, "node_modules");
      // The enclosing checkout may itself be a linked worktree. Its physical
      // location, not the common Git directory, controls Node's upward search.
      // Node continues past an enclosing checkout that has no dependencies.
      enclosingCheckout ||= existsSync(join(parent, ".git"));
      if (enclosingCheckout && modules)
        return `This nested worktree has no dependencies of its own: ${root}. Node can resolve packages from the parent checkout at ${modules}. This is a worktree setup problem, not evidence of a defect in this branch. Install dependencies in this worktree with CI=1 using the project's package manager, or use an isolated checkout. No tool was run.`;
      if (parent === dirname(parent)) break;
    }
  } catch {
    // Not every caller is a normal linked Git worktree; do not invent a diagnosis.
  }
  return null;
}

if (invokedAsScript(import.meta.url)) {
  const problem = worktreeDependencyProblem();
  if (problem) {
    console.error(problem);
    process.exitCode = 1;
  }
}
