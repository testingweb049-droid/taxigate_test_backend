// config/uploadLimits.js
// Centralized configuration for file upload limits
// All limits can be configured via environment variables with sensible defaults

// Maximum number of document fields that can be uploaded
const MAX_DOCUMENTS_COUNT = 10;

// Maximum file size per document (in MB)
// Default: 5MB per file
const DEFAULT_MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE_MB = Number(process.env.DRIVER_DOCUMENT_MAX_SIZE_MB) || DEFAULT_MAX_FILE_SIZE_MB;

// Maximum total request size (in MB)
// Default: 50MB total
const DEFAULT_MAX_TOTAL_SIZE_MB = 50;
const MAX_TOTAL_SIZE_MB = Number(process.env.DRIVER_DOCUMENT_MAX_TOTAL_SIZE_MB) || DEFAULT_MAX_TOTAL_SIZE_MB;

// Convert to bytes for easier use
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_TOTAL_SIZE_BYTES = MAX_TOTAL_SIZE_MB * 1024 * 1024;

module.exports = {
  MAX_DOCUMENTS_COUNT,
  MAX_FILE_SIZE_MB,
  MAX_TOTAL_SIZE_MB,
  MAX_FILE_SIZE_BYTES,
  MAX_TOTAL_SIZE_BYTES,
  // Export defaults for reference
  DEFAULT_MAX_FILE_SIZE_MB,
  DEFAULT_MAX_TOTAL_SIZE_MB,
};

