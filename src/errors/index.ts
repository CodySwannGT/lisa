/**
 * Base error class for all Lisa errors
 */
export class LisaError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'LisaError';
  }
}

/**
 * Error thrown when destination directory is not found
 */
export class DestinationNotFoundError extends LisaError {
  constructor(public readonly path: string) {
    super(`Destination path does not exist: ${path}`, 'DEST_NOT_FOUND');
    this.name = 'DestinationNotFoundError';
  }
}

/**
 * Error thrown when destination is not a directory
 */
export class DestinationNotDirectoryError extends LisaError {
  constructor(public readonly path: string) {
    super(`Destination is not a directory: ${path}`, 'DEST_NOT_DIR');
    this.name = 'DestinationNotDirectoryError';
  }
}

/**
 * Error thrown when JSON parsing fails
 */
export class JsonParseError extends LisaError {
  constructor(
    public readonly filePath: string,
    public readonly originalError: Error,
  ) {
    super(`Failed to parse JSON file: ${filePath}`, 'JSON_PARSE_ERROR');
    this.name = 'JsonParseError';
  }
}

/**
 * Error thrown when JSON merge fails
 */
export class JsonMergeError extends LisaError {
  constructor(
    public readonly filePath: string,
    public readonly reason: string,
  ) {
    super(`Failed to merge JSON: ${filePath} - ${reason}`, 'JSON_MERGE_ERROR');
    this.name = 'JsonMergeError';
  }
}

/**
 * Error thrown when file operation fails
 */
export class FileOperationError extends LisaError {
  constructor(
    public readonly operation: string,
    public readonly filePath: string,
    public readonly originalError: Error,
  ) {
    super(`File operation '${operation}' failed for: ${filePath}`, 'FILE_OP_ERROR');
    this.name = 'FileOperationError';
  }
}

/**
 * Error thrown when backup/restore fails
 */
export class BackupError extends LisaError {
  constructor(
    public readonly operation: 'backup' | 'restore' | 'cleanup',
    public readonly reason: string,
  ) {
    super(`Backup ${operation} failed: ${reason}`, 'BACKUP_ERROR');
    this.name = 'BackupError';
  }
}

/**
 * Error thrown when rollback fails
 */
export class RollbackError extends LisaError {
  constructor(public readonly reason: string) {
    super(`Rollback failed: ${reason}`, 'ROLLBACK_ERROR');
    this.name = 'RollbackError';
  }
}

/**
 * Error thrown when a required dependency is missing
 */
export class DependencyMissingError extends LisaError {
  constructor(public readonly dependencies: readonly string[]) {
    super(`Missing required dependencies: ${dependencies.join(', ')}`, 'DEP_MISSING');
    this.name = 'DependencyMissingError';
  }
}
