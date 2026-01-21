
// Helper to delete cloudinary images (safe)
async function safeDestroy(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    // Cloudinary destroy error
  }
}

module.exports = safeDestroy;