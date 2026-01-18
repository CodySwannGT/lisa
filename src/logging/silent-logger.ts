import type { ILogger } from './logger.interface.js';

/**
 * Silent logger that produces no output (for testing)
 */
export class SilentLogger implements ILogger {
  info(_message: string): void {
    // Silent
  }

  success(_message: string): void {
    // Silent
  }

  warn(_message: string): void {
    // Silent
  }

  error(_message: string): void {
    // Silent
  }

  dry(_message: string): void {
    // Silent
  }
}
