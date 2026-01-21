const crypto = require("crypto");
const Admin = require("../models/admin.model");
const Driver = require("../models/driver.model");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");
const { sendTokens, clearTokens, compareRefreshToken, hashRefreshToken, signRefreshToken } = require("../utils/token");
const { successResponse, errorResponse } = require("../utils/response");
const sendEmail = require("../utils/email");
const jwt = require("jsonwebtoken");
const { promisify } = require("util");

// ===== ADMIN SIGNUP =====
exports.signupAdmin = catchAsync(async (req, res, next) => {
    const { name, email, password, passwordConfirm } = req.body;

    if (!name) return next(new AppError("Name is required", 400));
    if (!email) return next(new AppError("Email is required", 400));
    if (!password) return next(new AppError("Password is required", 400));
    if (!passwordConfirm) return next(new AppError("Password confirmation is required", 400));

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return next(new AppError("Please provide a valid email address", 400));
    if (password.length < 8) return next(new AppError("Password must be at least 8 characters long", 400));
    if (password !== passwordConfirm) return next(new AppError("Passwords do not match", 400));

    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) return next(new AppError("Email already registered", 400));

    const admin = await Admin.create({ name, email, password, passwordConfirm });
    
    const safeAdmin = {
      id: admin._id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      tokenVersion: admin.tokenVersion || 0,
    };

    // Generate access and refresh tokens
    const tokenResult = await sendTokens(safeAdmin, 201, res, "Admin registered successfully", "admin");

    // Store hashed refresh token in database
    admin.refreshToken = tokenResult.hashedRefreshToken;
    await admin.save({ validateBeforeSave: false });

    // Return response with tokens in body (for mobile) and cookies (for web)
    return successResponse(res, tokenResult.payload, "Admin registered successfully", 201);
});

// ===== ADMIN LOGIN =====
exports.loginAdmin = catchAsync(async (req, res, next) => {
    const { email, password } = req.body;

    if (!email) return next(new AppError("Email is required", 400));
    if (!password) return next(new AppError("Password is required", 400));

    const admin = await Admin.findOne({ email }).select("+password");
    if (!admin || !(await admin.correctPassword(password)))
        return next(new AppError("Incorrect email or password", 401));

    // Check if admin is active
    // if (!admin.active) {
    //     return next(new AppError("Your account has been deactivated. Please contact support.", 403));
    // }

    const safeAdmin = {
      id: admin._id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      tokenVersion: admin.tokenVersion || 0,
    };

    // Generate access and refresh tokens
    const tokenResult = await sendTokens(safeAdmin, 200, res, "Admin logged in successfully", "admin");

    // Store hashed refresh token in database (rotate old token)
    admin.refreshToken = tokenResult.hashedRefreshToken;
    await admin.save({ validateBeforeSave: false });

    // Return response with tokens in body (for mobile) and cookies (for web)
    return successResponse(res, tokenResult.payload, "Admin logged in successfully", 200);
});

// ===== LOGOUT =====
exports.logoutAdmin = catchAsync(async (req, res, next) => {
    const adminId = req.user.id;

    const admin = await Admin.findById(adminId);
    if (!admin) return next(new AppError("Admin account not found. Unable to logout.", 404));

    // Increment token version to invalidate all existing tokens (access and refresh)
    await Admin.findByIdAndUpdate(adminId, { 
        $inc: { tokenVersion: 1 },
        $unset: { refreshToken: "" } // Clear refresh token from database
    });

    // Clear both access and refresh token cookies
    clearTokens(res, "admin");

    return successResponse(res, {}, "Logged out successfully. Your session has been terminated.", 200);
});

// ===== REFRESH ACCESS TOKEN =====
exports.refreshToken = catchAsync(async (req, res) => {
    // Extract refresh token from cookie
    const refreshToken = req.cookies.refresh_token;

    if (!refreshToken) {
        return errorResponse(res, "Refresh token not provided. Please login again.", 401);
    }

    // Verify refresh token
    let decoded;
    try {
        decoded = await promisify(jwt.verify)(
            refreshToken,
            process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
        );
    } catch (error) {
        if (error.name === "JsonWebTokenError") {
            return errorResponse(res, "Invalid refresh token.", 401);
        }
        if (error.name === "TokenExpiredError") {
            return errorResponse(res, "Refresh token expired. Please login again.", 401);
        }
        return errorResponse(res, "Token verification failed. Please login again.", 401);
    }

    // Ensure this is a refresh token
    if (decoded.type && decoded.type !== "refresh") {
        return errorResponse(res, "Invalid token type. Refresh token required.", 401);
    }

    // Find admin and verify refresh token exists in database
    const admin = await Admin.findById(decoded.id).select("+refreshToken");
    if (!admin) {
        return errorResponse(res, "Admin account not found. Please login again.", 404);
    }

    // Check if admin is active
    if (!admin.active) {
        return errorResponse(res, "Your account has been deactivated. Please contact support.", 403);
    }

    // Check if token version matches
    if (decoded.tokenVersion !== (admin.tokenVersion || 0)) {
        return errorResponse(res, "Your session has been terminated. Please login again.", 401);
    }

    // Verify refresh token matches stored hashed token
    if (!admin.refreshToken) {
        return errorResponse(res, "Refresh token not found. Please login again.", 401);
    }

    const isTokenValid = await compareRefreshToken(refreshToken, admin.refreshToken);
    if (!isTokenValid) {
        return errorResponse(res, "Invalid refresh token. Please login again.", 401);
    }

    // Prepare safe admin info
    const safeAdmin = {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        tokenVersion: admin.tokenVersion || 0,
    };

    // Generate new access and refresh tokens (rotation)
    const newRefreshToken = signRefreshToken(safeAdmin);
    const newHashedRefreshToken = await hashRefreshToken(newRefreshToken);

    // Update refresh token in database (rotation)
    admin.refreshToken = newHashedRefreshToken;
    await admin.save({ validateBeforeSave: false });

    // Send new tokens
    const tokenResult = await sendTokens(
        safeAdmin,
        200,
        res,
        "Tokens refreshed successfully.",
        "admin",
        newRefreshToken,
        newHashedRefreshToken
    );

    // Return response with tokens in body (for mobile) and cookies (for web)
    return successResponse(res, tokenResult.payload, "Tokens refreshed successfully.", 200);
});

// ===== GET CURRENT ADMIN (ME) =====
exports.getMe = catchAsync(async (req, res) => {
    const admin = await Admin.findById(req.user.id)
        .select("name email role active")
        .lean();

    if (!admin) {
        return errorResponse(res, "Admin account not found.", 404);
    }

    const safeAdmin = {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        active: admin.active,
    };

    return successResponse(
        res,
        { admin: safeAdmin },
        "Admin profile fetched successfully.",
        200
    );
});

// ===== GET TOTAL WALLET BALANCE (All Drivers) =====
exports.getTotalWalletBalance = catchAsync(async (req, res) => {
    // Aggregate total wallet balance from all drivers
    const result = await Driver.aggregate([
        {
            $match: {
                deletedAt: null, // Exclude soft-deleted drivers
            },
        },
        {
            $group: {
                _id: null,
                totalBalance: { $sum: { $ifNull: ["$walletBalance", 0] } },
                driverCount: { $sum: 1 },
            },
        },
    ]);

    // Get individual driver wallet balances for detailed view
    const drivers = await Driver.find({ deletedAt: null })
        .select("firstName lastName email walletBalance")
        .sort({ walletBalance: -1 })
        .lean();

    const totalBalance = result.length > 0 ? result[0].totalBalance : 0;
    const driverCount = result.length > 0 ? result[0].driverCount : 0;

    const driverBalances = drivers.map((driver) => ({
        id: driver._id,
        firstName: driver.firstName,
        lastName: driver.lastName,
        email: driver.email,
        walletBalance: driver.walletBalance || 0,
    }));

    return successResponse(
        res,
        {
            totalWallet: {
                totalBalance: totalBalance,
                currency: "EUR",
                driverCount: driverCount,
            },
            drivers: driverBalances,
        },
        "Total wallet balance fetched successfully.",
        200
    );
});

