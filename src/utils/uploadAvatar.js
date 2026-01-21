const multer = require("multer");
const { getCloudinaryStorage } = require("../../config/cloudinary");
const imageFileFilter = require("./multerFileFilter");

const uploadProfilePicture = multer({
  storage: getCloudinaryStorage("Taxigate/profilePicture"),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: imageFileFilter,
});

module.exports = uploadProfilePicture;
