const connectDB = require("../../config/database");

const dbConnectMiddleware = async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(503).json({
      status: "error",
      message: "Database connection unavailable. Please try again.",
      timestamp: new Date().toISOString(),
    });
  }
};

module.exports = dbConnectMiddleware;
