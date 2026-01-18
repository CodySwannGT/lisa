import type { ILogger } from "./logger.interface.js";

/**
 * Silent logger that produces no output (for testing)
 */
export class SilentLogger implements ILogger {
  /**
   * Silently ignore info-level messages
   *
   * @param _message - Message to ignore
   */
  info(_message: string): void {
    // Silent
  }

  /**
   * Silently ignore success-level messages
   *
   * @param _message - Message to ignore
   */
  success(_message: string): void {
    // Silent
  }

  /**
   * Silently ignore warning-level messages
   *
   * @param _message - Message to ignore
   */
  warn(_message: string): void {
    // Silent
  }

  /**
   * Silently ignore error-level messages
   *
   * @param _message - Message to ignore
   */
  error(_message: string): void {
    // Silent
  }

  /**
   * Silently ignore dry-run-level messages
   *
   * @param _message - Message to ignore
   */
  dry(_message: string): void {
    // Silent
  }
}
