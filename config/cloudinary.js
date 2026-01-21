const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const getCloudinaryStorage = (defaultFolder = "ecommerce/others") => {
  return new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => {
      const folder = req.folder || defaultFolder;

      return {
        folder,
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
        public_id: `${Date.now()}-${file.originalname
          .split(".")[0]
          .replace(/[^a-zA-Z0-9-_]/g, "")}`,
      };
    },
  });
};

module.exports = { cloudinary, getCloudinaryStorage };
