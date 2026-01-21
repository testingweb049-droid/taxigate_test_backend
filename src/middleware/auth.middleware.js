// src/middleware/auth.middleware.js
const jwt = require("jsonwebtoken");
const { promisify } = require("util");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const Admin = require("../models/admin.model");
const Driver = require("../models/driver.model");

exports.protect = catchAsync(async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies.access_token) {
    token = req.cookies.access_token;
  }
  if (!token) {
    return next(new AppError("Authentication required. Please login to access this resource.", 401));
  }

  // Verify token
  let decoded;
  try {
    decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return next(new AppError("Invalid authentication token.", 401));
    }
    if (error.name === "TokenExpiredError") {
      return next(new AppError("Your session has expired. Please login again to continue.", 401));
    }
    return next(new AppError("Authentication failed. Please try logging in again.", 401));
  }

  // Ensure this is an access token, not a refresh token
  if (decoded.type && decoded.type !== "access") {
    return next(new AppError("Invalid token type. Access token required.", 401));
  }

  let currentUser;
  if (decoded.role === "admin") {
    currentUser = await Admin.findById(decoded.id)
      .select("_id name email role tokenVersion active")
      .lean();
  } else if (decoded.role === "driver") {
    currentUser = await Driver.findOne({ _id: decoded.id, deletedAt: null })
      .select("_id email phone firstName lastName role tokenVersion isVerified status")
      .lean();
  } else {
    return next(new AppError("Invalid user role in token. Please login again.", 401));
  }

  if (!currentUser) {
    return next(new AppError("User account not found. This token is no longer valid. Please login again.", 401));
  }
  if (decoded.tokenVersion !== (currentUser.tokenVersion || 0)) {
    return next(new AppError("Your session has been terminated. You have been logged out. Please login again.", 401));
  }

  // Additional checks for admin
  if (decoded.role === "admin" && !currentUser.active) {
    return next(new AppError("Your account has been deactivated. Please contact support.", 403));
  }

  req.user = {
    ...currentUser,
    id: currentUser._id?.toString(),
  };
  req.role = decoded.role;
  next();
});
exports.restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.role)) {
    return next(
      new AppError("You do not have permission to perform this action.", 403)
    );
  }
  next();
};
