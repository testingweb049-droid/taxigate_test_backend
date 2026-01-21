const multer = require("multer");
const imageFileFilter = require("./multerFileFilter");
const { MAX_DOCUMENTS_COUNT, MAX_FILE_SIZE_BYTES } = require("../../config/uploadLimits");

// Configuration for multiple files in one request
// Limits are configured via environment variables (see config/uploadLimits.js)

const uploadDriverDocuments = multer({
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: MAX_FILE_SIZE_BYTES,
    // Limit total files to prevent exceeding payload limit
    files: MAX_DOCUMENTS_COUNT,
  },
  fileFilter: imageFileFilter,
});

module.exports = uploadDriverDocuments;
