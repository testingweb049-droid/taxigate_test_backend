// utils/multerFileFilter.js
const multer = require("multer");

const allowedMimes = ["image/jpeg", "image/png", "image/jpg", "image/webp"];

const imageFileFilter = (req, file, cb) => {
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    const err = new multer.MulterError(
      "LIMIT_UNEXPECTED_FILE",
      "Only JPG, PNG, and WebP images are allowed."
    );
    cb(err, false);
  }
};

module.exports = imageFileFilter;
