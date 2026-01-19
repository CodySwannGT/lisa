import pc from "picocolors";
import type { ILogger } from "./logger.interface.js";

/**
 * Console logger with colored output
 */
export class ConsoleLogger implements ILogger {
  /**
   * Log an info-level message with blue color
   * @param message - Message to log
   */
  info(message: string): void {
    console.log(`${pc.blue("[INFO]")} ${message}`);
  }

  /**
   * Log a success-level message with green color
   * @param message - Message to log
   */
  success(message: string): void {
    console.log(`${pc.green("[OK]")} ${message}`);
  }

  /**
   * Log a warning-level message with yellow color
   * @param message - Message to log
   */
  warn(message: string): void {
    console.log(`${pc.yellow("[WARN]")} ${message}`);
  }

  /**
   * Log an error-level message with red color
   * @param message - Message to log
   */
  error(message: string): void {
    console.log(`${pc.red("[ERROR]")} ${message}`);
  }

  /**
   * Log a dry-run-level message with blue color
   * @param message - Message to log
   */
  dry(message: string): void {
    console.log(`${pc.blue("[DRY-RUN]")} ${message}`);
  }
}
