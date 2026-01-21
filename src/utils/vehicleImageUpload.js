const multer = require("multer");
const { getCloudinaryStorage } = require("../../config/cloudinary");
const imageFileFilter = require("./multerFileFilter");

// Vehicle images upload configuration
const uploadVehicleImage = multer({
    storage: getCloudinaryStorage("Taxigate/vehicle-images"),
    limits: { fileSize: 5 * 1024 * 1024 }, // max 5MB
    fileFilter: imageFileFilter,
});

module.exports = uploadVehicleImage;
