// src/middleware/validateRequestSize.js
// Middleware to validate request size before processing
// This helps catch payload too large errors early
// Accounts for multiple files in one request
// Limits are configured via environment variables (see config/uploadLimits.js)

const { MAX_TOTAL_SIZE_BYTES, MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB, MAX_TOTAL_SIZE_MB } = require("../../config/uploadLimits");

const validateRequestSize = (req, res, next) => {
  // Get content-length header
  const contentLength = req.get('content-length');
  
  // Limits are loaded from config/uploadLimits.js (configurable via env vars)
  
  if (contentLength && parseInt(contentLength) > MAX_TOTAL_SIZE_BYTES) {
    return res.status(413).json({
      status: 'error',
      message: `Request too large. Maximum total size is ${MAX_TOTAL_SIZE_MB}MB (approximately ${MAX_FILE_SIZE_MB}MB per file when uploading all documents). Please reduce file sizes or upload fewer files at once.`,
      maxTotalSize: `${MAX_TOTAL_SIZE_MB}MB`,
      maxPerFile: `${MAX_FILE_SIZE_MB}MB`,
      receivedSize: `${(parseInt(contentLength) / 1024 / 1024).toFixed(2)}MB`,
      tip: 'Try compressing images before uploading or upload documents in smaller batches'
    });
  }
  
  next();
};

module.exports = validateRequestSize;

