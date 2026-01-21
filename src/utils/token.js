// utils/token.js
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { successResponse } = require("./response");

/**
 * Generate access token (short-lived)
 * @param {Object} entity - User entity (driver/admin)
 * @returns {String} JWT access token
 */
exports.signAccessToken = (entity) => {
  const id = entity._id || entity.id;
  const role = entity.role;
  const name = entity.firstName || entity.name;
  const tokenVersion = entity.tokenVersion || 0;

  return jwt.sign(
    { id, role, name, tokenVersion, type: "access" },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
};

/**
 * Generate refresh token (long-lived)
 * @param {Object} entity - User entity (driver/admin)
 * @returns {String} JWT refresh token
 */
exports.signRefreshToken = (entity) => {
  const id = entity._id || entity.id;
  const role = entity.role;
  const tokenVersion = entity.tokenVersion || 0;

  return jwt.sign(
    { id, role, tokenVersion, type: "refresh" },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d" }
  );
};

/**
 * Hash refresh token before storing in database
 * @param {String} token - Plain refresh token
 * @returns {String} Hashed refresh token
 */
exports.hashRefreshToken = async (token) => {
  return await bcrypt.hash(token, 12);
};

/**
 * Compare plain refresh token with hashed token from database
 * @param {String} plainToken - Plain refresh token
 * @param {String} hashedToken - Hashed refresh token from DB
 * @returns {Boolean} True if tokens match
 */
exports.compareRefreshToken = async (plainToken, hashedToken) => {
  return await bcrypt.compare(plainToken, hashedToken);
};

/**
 * Generate a new refresh token (for rotation)
 * @returns {String} Random token string
 */
exports.generateRefreshTokenString = () => {
  return crypto.randomBytes(32).toString("hex");
};

/**
 * Send both access and refresh tokens as httpOnly cookies
 * @param {Object} entity - User entity (driver/admin)
 * @param {Number} statusCode - HTTP status code
 * @param {Object} res - Express response object
 * @param {String} message - Success message
 * @param {String} responseKey - Key for response data (default: "user")
 * @param {String} refreshToken - Refresh token string (optional, will generate if not provided)
 * @param {String} hashedRefreshToken - Hashed refresh token to store in DB
 * @returns {Object} Success response
 */
exports.sendTokens = async (
  entity,
  statusCode,
  res,
  message = "Success",
  responseKey = "user",
  refreshToken = null,
  hashedRefreshToken = null
) => {
  // Generate access token
  const accessToken = this.signAccessToken(entity);

  // Generate refresh token if not provided
  if (!refreshToken) {
    refreshToken = this.signRefreshToken(entity);
  }

  // Hash refresh token if not provided
  if (!hashedRefreshToken) {
    hashedRefreshToken = await this.hashRefreshToken(refreshToken);
  }

  // Determine refresh token path based on role
  const role = entity.role || "driver";
  const refreshTokenPath = role === "admin" ? "/admin/refresh-token" : "/driver/refresh-token";

  // Parse JWT_EXPIRES_IN (e.g., "7d" -> 7 days, "15m" -> 15 minutes)
  const accessTokenExpiresIn = process.env.JWT_EXPIRES_IN || "7d";
  const accessTokenValue = parseInt(accessTokenExpiresIn.replace(/[^0-9]/g, "") || "7");
  const accessTokenUnit = accessTokenExpiresIn.replace(/[^a-z]/gi, "").toLowerCase() || "d";
  let accessTokenMs;
  if (accessTokenUnit === "d") {
    accessTokenMs = accessTokenValue * 24 * 60 * 60 * 1000; // days to milliseconds
  } else if (accessTokenUnit === "h") {
    accessTokenMs = accessTokenValue * 60 * 60 * 1000; // hours to milliseconds
  } else if (accessTokenUnit === "m") {
    accessTokenMs = accessTokenValue * 60 * 1000; // minutes to milliseconds
  } else {
    accessTokenMs = accessTokenValue * 24 * 60 * 60 * 1000; // default to days
  }

  // Parse JWT_REFRESH_EXPIRES_IN (e.g., "7d" -> 7 days)
  const refreshTokenExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN || "7d";
  const refreshTokenDays = parseInt(refreshTokenExpiresIn.replace(/[^0-9]/g, "") || "7");

  // Access token cookie options
  const accessTokenCookieOptions = {
    expires: new Date(Date.now() + accessTokenMs),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
    path: "/",
  };

  // Refresh token cookie options
  const refreshTokenCookieOptions = {
    expires: new Date(Date.now() + refreshTokenDays * 24 * 60 * 60 * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
    path: refreshTokenPath,
  };

  // Set cookies
  res.cookie("access_token", accessToken, accessTokenCookieOptions);
  res.cookie("refresh_token", refreshToken, refreshTokenCookieOptions);

  // Remove sensitive data
  entity.password = undefined;
  if (entity.refreshToken) entity.refreshToken = undefined;

  // Prepare response payload with tokens for mobile apps
  // Tokens are also set in cookies for web apps
  const payload = {
    [responseKey]: entity,
    // Include tokens in response body for mobile apps (to store in local storage)
    tokens: {
      accessToken,
      refreshToken,
    },
  };

  // Return response with hashed refresh token for database storage
  return {
    accessToken,
    refreshToken,
    hashedRefreshToken,
    payload,
    statusCode,
    message,
  };
};

/**
 * Clear both access and refresh token cookies
 * @param {Object} res - Express response object
 * @param {String} role - User role (driver/admin) to determine refresh token path
 */
exports.clearTokens = (res, role = "driver") => {
  // Clear access token cookie
  res.cookie("access_token", "loggedout", {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
    path: "/",
  });

  // Clear refresh token cookie (both paths to ensure cleanup)
  const refreshTokenPath = role === "admin" ? "/admin/refresh-token" : "/driver/refresh-token";
  res.cookie("refresh_token", "loggedout", {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
    path: refreshTokenPath,
  });
};

// Legacy function for backward compatibility (deprecated)
exports.signToken = (entity) => {
  return this.signAccessToken(entity);
};

// Legacy function for backward compatibility (deprecated)
exports.createSendToken = async (
  entity,
  statusCode,
  res,
  message = "Success",
  responseKey = "user"
) => {
  const result = await this.sendTokens(entity, statusCode, res, message, responseKey);
  return successResponse(res, result.payload, message, statusCode);
};
