/** Companion to the unchanged native JSON reporter: refuses unresolved tasks. */
import { writeFileSync } from "node:fs";
import { terminalTask } from "./shell-guard-shards.mjs";

export default class TerminalReporter {
  queuedFiles = [];
  collectedFiles = [];
  onTestModuleQueued(module) {
    this.queuedFiles.push(module.moduleId);
  }
  onTestModuleCollected(module) {
    this.collectedFiles.push(module.moduleId);
  }
  onTestRunStart(specifications) {
    this.startedFiles = specifications.map(
      specification => specification.moduleId
    );
    writeFileSync(
      `${process.env.LISA_GUARD_TERMINAL_REPORT}.started.json`,
      JSON.stringify({
        schema: 1,
        startedFiles: this.startedFiles,
        startedAt: new Date().toISOString(),
      })
    );
  }
  onTestRunEnd(modules, unhandledErrors, reason) {
    const files = modules.map(module => {
      let tests = 0;
      const tasks = [];
      const inspect = task => {
        if (task.type === "test") tests += 1;
        tasks.push({
          type: task.type,
          mode: task.mode,
          state: task.result?.state ?? null,
        });
        for (const child of task.tasks ?? []) inspect(child);
      };
      inspect(module.task);
      const moduleState = module.state();
      const cases = [...module.children.allTests()].map(test => ({
        name: test.fullName,
        mode: test.options.mode,
        state: test.result().state,
      }));
      const complete =
        ["passed", "skipped"].includes(moduleState) &&
        cases.every(test => ["passed", "skipped"].includes(test.state)) &&
        tasks.every(terminalTask);
      return {
        name: module.moduleId,
        moduleState,
        tests,
        complete,
        tasks,
        cases,
      };
    });
    const complete =
      reason === "passed" &&
      files.length > 0 &&
      files.every(file => file.complete) &&
      Array.isArray(unhandledErrors) &&
      unhandledErrors.length === 0 &&
      Array.isArray(this.startedFiles) &&
      JSON.stringify(this.queuedFiles.slice().sort()) ===
        JSON.stringify(files.map(file => file.name).sort()) &&
      JSON.stringify(this.collectedFiles.slice().sort()) ===
        JSON.stringify(files.map(file => file.name).sort());
    // Collector precreates an owned directory; the reporter path is explicit.
    writeFileSync(
      process.env.LISA_GUARD_TERMINAL_REPORT,
      JSON.stringify({
        schema: 1,
        complete,
        reason,
        unhandledErrorCount: Array.isArray(unhandledErrors)
          ? unhandledErrors.length
          : null,
        startedFiles: this.startedFiles,
        queuedFiles: this.queuedFiles,
        collectedFiles: this.collectedFiles,
        files,
        endedAt: new Date().toISOString(),
      })
    );
  }
}
