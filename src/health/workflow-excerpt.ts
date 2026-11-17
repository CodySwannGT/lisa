/**
 * Reduces a workflow file to the lines an agentic Health evaluator needs:
 * gate-control keys, the job each one sits in, and the comments around them.
 * @module health/workflow-excerpt
 */

const WORKFLOW_CONTROL =
  /^\s*(?:skip_jobs|verify_enforced|mutation(?:_gate)?(?:_enabled)?)\s*:/u;
const YAML_COMMENT = /^\s*#/u;
const JOB_IDENTIFIER = /^ {2}[a-zA-Z0-9_-]+:\s*(?:#.*)?$/u;

/** One source line remembered with its zero-based position. */
interface IndexedLine {
  readonly index: number;
  readonly line: string;
}

/**
 * Single-pass line scanner. The scan is inherently stateful — which job a
 * control belongs to, which comments precede it, whether comments after it
 * still describe it — so that state lives in one object whose lifetime is a
 * single call to {@link workflowExcerpt}.
 */
class WorkflowExcerptScanner {
  private readonly selected = new Map<number, string>();
  private currentJob: IndexedLine | undefined;
  private pendingComments: IndexedLine[] = [];
  private captureFollowingComments = false;

  /**
   * Classify one line and update what the excerpt keeps.
   * @param line - Raw workflow line
   * @param index - Zero-based line position
   */
  scan(line: string, index: number): void {
    if (JOB_IDENTIFIER.test(line)) {
      this.currentJob = Object.freeze({ index, line });
      this.reset();
      return;
    }
    if (YAML_COMMENT.test(line)) {
      this.pendingComments.push(Object.freeze({ index, line }));
      if (this.captureFollowingComments) this.selected.set(index, line);
      return;
    }
    if (WORKFLOW_CONTROL.test(line)) {
      this.keepControl(line, index);
      return;
    }
    this.reset();
  }

  /**
   * Render the kept lines, one-based and in source order.
   * @returns The excerpt text, empty when the workflow holds no controls
   */
  render(): string {
    return [...this.selected.entries()]
      .map(([index, line]) => `${index + 1}: ${line}`)
      .join("\n");
  }

  /**
   * Keep a control line with its job and the comments directly above it.
   * @param line - The control line
   * @param index - Zero-based line position
   */
  private keepControl(line: string, index: number): void {
    if (this.currentJob !== undefined) {
      this.selected.set(this.currentJob.index, this.currentJob.line);
    }
    this.pendingComments.forEach(comment =>
      this.selected.set(comment.index, comment.line)
    );
    this.selected.set(index, line);
    this.pendingComments = [];
    this.captureFollowingComments = true;
  }

  /** Forget comments that no longer sit directly against a control. */
  private reset(): void {
    this.pendingComments = [];
    this.captureFollowingComments = false;
  }
}

/**
 * Reduce workflow YAML in one pass to controls, job ids, and comment blocks.
 * @param source - Workflow file contents
 * @returns Numbered excerpt lines, empty when the workflow has no controls
 */
export function workflowExcerpt(source: string): string {
  const scanner = new WorkflowExcerptScanner();
  source.split(/\r?\n/u).forEach((line, index) => scanner.scan(line, index));
  return scanner.render();
}
