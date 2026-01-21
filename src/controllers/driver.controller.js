const mongoose = require("mongoose");
const Driver = require("../models/driver.model");
const WalletTransaction = require("../models/walletTransaction.model");
const Booking = require("../models/booking.model");
const { generateOtp } = require("../utils/generateOtp");
const { compareRefreshToken, hashRefreshToken, signAccessToken, signRefreshToken } = require("../utils/token");
const { errorResponse, successResponse } = require("../utils/response");
const sendEmail = require("../utils/email");
const sharp = require("sharp");
const Vehicle = require("../models/vehicle.model");
const cloudinary = require("cloudinary").v2;
const catchAsync = require("../utils/catchAsync");
const { goOnline, goOffline } = require("../services/driverPresence");
const jwt = require("jsonwebtoken");
const { promisify } = require("util");
const AppError = require("../utils/appError");
const APIFeatures = require("../utils/apiFeatures");
const { notifyDriverRegistered, notifyDriverStatusChanged, notifyDriverProfileUpdated, notifyDriverAccountDeleted } = require("../services/driverNotifications");
const { MAX_TOTAL_SIZE_BYTES, MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB, MAX_TOTAL_SIZE_MB } = require("../../config/uploadLimits");

// ===== REGISTER DRIVER =====
exports.registerDriver = catchAsync(async (req, res) => {
  const { email, phone, password, confirmPassword } = req.body;
  // Individual field validation
  if (!email) return errorResponse(res, "Email is required.", 400);
  if (!phone) return errorResponse(res, "Phone number is required.", 400);
  if (!password) return errorResponse(res, "Password is required.", 400);
  if (!confirmPassword) return errorResponse(res, "Confirm password is required.", 400);

  if (password !== confirmPassword)
    return errorResponse(res, "Passwords do not match.", 400);

  const existingDriver = await Driver.findOne({ email });
  if (existingDriver)
    return errorResponse(res, "Driver already exist with this email.", 400);

  const otp = generateOtp();
  const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

  const driver = await Driver.create({
    email,
    phone,
    password,
    passwordConfirm: confirmPassword,
    otp,
    otpExpiresAt,
    status: "Pending",
    otpSendCount: 1,
    otpLastSentAt: new Date(),
  });

  await sendEmail({
    email: driver.email,
    subject: "Taxigate - Verify Your Account",
    message: `Your verification code is: ${otp}. Expires in 10 minutes.`,
  });

  // Notify admin about new driver registration
  try {
    await notifyDriverRegistered(driver);
  } catch (notificationError) {
    // Error sending notification but don't fail registration
  }

  const safeDriver = {
    id: driver._id,
    email: driver.email,
    phone: driver.phone,
    isVerified: driver.isVerified,
    status: driver.status,
    role: driver.role,
  };

  // NO tokens issued on signup - driver must verify OTP first
  return successResponse(
    res,
    { driver: safeDriver },
    "Account created successfully. Please check your email for OTP.",
    201
  );
});

// ===== VERIFY OTP =====
exports.verifyOtp = catchAsync(async (req, res) => {
  const { email, otp } = req.body;
  if (!email) return errorResponse(res, "Email is required.", 400);
  if (!otp) return errorResponse(res, "OTP is required.", 400);

  // Find driver by email (no auth required - this is public route)
  const driver = await Driver.findOne({ email, deletedAt: null }).select("+otp +otpExpiresAt");

  if (!driver) return errorResponse(res, "Driver not found.", 404);
  if (driver.isVerified) return errorResponse(res, "Driver already verified.", 400);
  if (driver.otp !== otp) return errorResponse(res, "Invalid OTP.", 400);
  if (!driver.otpExpiresAt || driver.otpExpiresAt < new Date())
    return errorResponse(res, "OTP expired, please request a new one.", 400);

  // Mark as verified and clear OTP
  driver.isVerified = true;
  driver.otp = undefined;
  driver.otpExpiresAt = undefined;

  // Generate access and refresh tokens
  const safeDriver = {
    id: driver._id,
    email: driver.email,
    phone: driver.phone,
    firstName: driver.firstName,
    lastName: driver.lastName,
    isVerified: true,
    status: driver.status,
    role: driver.role,
    tokenVersion: driver.tokenVersion || 0,
  };

  // Generate tokens manually (no cookies for Flutter apps)

  const accessToken = signAccessToken(safeDriver);
  const refreshToken = signRefreshToken(safeDriver);
  const hashedRefreshToken = await hashRefreshToken(refreshToken);

  // Store hashed refresh token in database
  driver.refreshToken = hashedRefreshToken;
  await driver.save({ validateBeforeSave: false });

  // Return response with tokens in body only (for Flutter/mobile apps)
  return successResponse(
    res,
    {
      driver: safeDriver,
      tokens: {
        accessToken,
        refreshToken,
      },
    },
    "Account verified successfully. Please setup your profile.",
    200
  );
});

// ===== RESEND OTP =====
exports.resendOtp = catchAsync(async (req, res) => {
  const { email } = req.body;
  const driver = await Driver.findOne({ email, deletedAt: null });
  if (!driver) return errorResponse(res, "Driver not found with this email", 404);
  if (driver.isVerified) return errorResponse(res, "Driver already verified with this email", 400);

  const now = new Date();
  if (!driver.otpLastSentAt || now - driver.otpLastSentAt > 24 * 60 * 60 * 1000)
    driver.otpSendCount = 0;
  if (driver.otpSendCount >= 3)
    return errorResponse(res, "Max OTP requests reached for today. Please try again after 24 hours.", 429);

  driver.otp = generateOtp();
  driver.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
  driver.otpSendCount += 1;
  driver.otpLastSentAt = now;
  await driver.save({ validateBeforeSave: false });

  await sendEmail({
    email: driver.email,
    subject: "Taxigate - New Verification Code",
    message: `Your new verification code is: ${driver.otp}. Expires in 10 minutes.`,
  });

  return successResponse(res, {}, "New OTP has been sent to your email.", 200);
});

// ===== SETUP PROFILE =====
exports.setupProfile = catchAsync(async (req, res) => {
  const { firstName, lastName } = req.body;

  // Individual field validation
  if (!firstName) return errorResponse(res, "First name is required.", 400);
  if (!lastName) return errorResponse(res, "Last name is required.", 400);

  // Token se driver ko find karo
  const driver = await Driver.findById(req.user.id);
  if (!driver) return errorResponse(res, "Driver not found.", 404);

  // Verification check
  if (!driver.isVerified) {
    return errorResponse(res, "Please verify your account first to setup profile.", 403);
  }

  const updates = { firstName, lastName };
  if (req.file?.path) updates.profilePicture = req.file.path;

  const updatedDriver = await Driver.findByIdAndUpdate(req.user.id, updates, {
    new: true,
    runValidators: true
  });

  const safeDriver = {
    id: updatedDriver._id,
    firstName: updatedDriver.firstName,
    lastName: updatedDriver.lastName,
    email: updatedDriver.email,
    phone: updatedDriver.phone,
    profilePicture: updatedDriver.profilePicture,
  };

  return successResponse(
    res,
    { driver: safeDriver },
    "Profile setup successfully. please upload your documents.",
    200
  );
});

// ===== DOCUMENT UPLOAD =====
exports.uploadDriverDocuments = catchAsync(async (req, res) => {
  const driver = await Driver.findById(req.user.id);
  if (!driver) return errorResponse(res, "Driver not found.", 404);

  // Verification check
  if (!driver.isVerified) {
    return errorResponse(res, "Please verify your account first to upload documents.", 403);
  }

  const files = req.files || {};

  // Check if files are uploaded
  if (Object.keys(files).length === 0) {
    return errorResponse(res, "No documents uploaded.", 400);
  }

  // Validate total file sizes (accounting for multiple files in one request)
  // Limits are loaded from config/uploadLimits.js (configurable via env vars)
  let totalSize = 0;
  const oversizedFiles = [];

  for (const [field, fileArray] of Object.entries(files)) {
    for (const file of fileArray) {
      totalSize += file.size;
      if (file.size > MAX_FILE_SIZE_BYTES) {
        oversizedFiles.push({
          field,
          size: `${(file.size / 1024 / 1024).toFixed(2)}MB`,
          maxSize: `${MAX_FILE_SIZE_MB}MB`
        });
      }
    }
  }

  // Check if any individual file is too large
  if (oversizedFiles.length > 0) {
    return errorResponse(
      res,
      `Some files are too large. Maximum size per file is ${MAX_FILE_SIZE_MB}MB when uploading multiple documents. Please compress your images.`,
      400
    );
  }

  // Check if total size exceeds limit
  if (totalSize > MAX_TOTAL_SIZE_BYTES) {
    return errorResponse(
      res,
      `Total upload size (${(totalSize / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed (${MAX_TOTAL_SIZE_MB}MB). Please upload documents in smaller batches or reduce file sizes.`,
      413
    );
  }

  // Optimized processing: compress and resize images more aggressively
  const uploadPromises = [];

  for (const [field, fileArray] of Object.entries(files)) {
    for (const file of fileArray) {
      // Process each file with optimized settings
      const processFile = async () => {
        try {
          // Optimized image processing for 5MB per file limit
          // Resize to max 1600px width (high quality for documents)
          // Use quality 85 for excellent quality while optimizing file size
          // Convert to progressive JPEG for better web performance
          // Files will typically be 1MB-4MB after processing (under 5MB limit)
          const optimizedBuffer = await sharp(file.buffer)
            .resize({ 
              width: 1600,  // High quality for document clarity
              height: 1600, 
              fit: 'inside', // Maintain aspect ratio
              withoutEnlargement: true // Don't enlarge small images
            })
            .jpeg({ 
              quality: 85, // Excellent quality (good for documents that need to be readable)
              progressive: true, // Progressive JPEG for faster loading
              mozjpeg: true // Use mozjpeg for better compression
            })
            .toBuffer();

          // Upload to Cloudinary with optimized settings
          return new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              { 
                folder: "Taxigate/driver-documents",
                resource_type: "image",
                // Optimize upload settings
                transformation: [
                  { quality: "auto:good" }, // Cloudinary auto optimization
                  { fetch_format: "auto" } // Auto format selection
                ]
              },
              (err, result) => {
                if (err) {
                  return reject(err);
                }
                file.cloudinaryUrl = result.secure_url;
                resolve({ field, url: result.secure_url });
              }
            );
            stream.end(optimizedBuffer);
          });
        } catch (error) {
          throw error;
        }
      };

      uploadPromises.push(processFile());
    }
  }

  // Process all uploads in parallel with error handling
  const results = await Promise.allSettled(uploadPromises);
  
  // Check if any uploads failed
  const failedUploads = results.filter(r => r.status === 'rejected');
  const successfulUploads = results.filter(r => r.status === 'fulfilled');
  
  if (failedUploads.length > 0) {
    // If all uploads failed, return error
    if (successfulUploads.length === 0) {
      return errorResponse(
        res,
        `Failed to upload documents. Please try again with smaller file sizes (max 3MB per file).`,
        500
      );
    }
  }

  // Build updates object only from successfully uploaded files
  const updates = {};
  for (const [field, fileArray] of Object.entries(files)) {
    if (fileArray[0] && fileArray[0].cloudinaryUrl) {
      updates[field] = fileArray[0].cloudinaryUrl;
    }
  }
  
  // If no files were successfully uploaded, return error
  if (Object.keys(updates).length === 0) {
    return errorResponse(
      res,
      "No documents were successfully uploaded. Please check file sizes and try again.",
      400
    );
  }

  const updatedDriver = await Driver.findByIdAndUpdate(req.user.id, updates, {
    new: true,
    runValidators: true
  });

  const safeDriver = {
    id: updatedDriver._id,
    email: updatedDriver.email,
    profilePicture: updatedDriver.profilePicture,
    documentFrontImage: updatedDriver.documentFrontImage,
    documentBackImage: updatedDriver.documentBackImage,
    driverLicenseFront: updatedDriver.driverLicenseFront,
    driverLicenseBack: updatedDriver.driverLicenseBack,
    driverPassFront: updatedDriver.driverPassFront,
    driverPassBack: updatedDriver.driverPassBack,
    kiwaPermit: updatedDriver.kiwaPermit,
    insurancePolicy: updatedDriver.insurancePolicy,
    bankpass: updatedDriver.bankpass,
    kvkUittreksel: updatedDriver.kvkUittreksel,
  };

  return successResponse(
    res,
    { driver: safeDriver },
    "Documents uploaded successfully.",
    200
  );
});

// ===== SET DRIVER ONLINE/OFFLINE =====
exports.setOnlineStatus = catchAsync(async (req, res) => {
  const { isOnline } = req.body;
  if (typeof isOnline !== "boolean") return errorResponse(res, "isOnline must be boolean", 400);

  const driver = await Driver.findById(req.user.id);
  if (!driver) return errorResponse(res, "Driver not found", 404);
  if (driver.status !== "Approved") return errorResponse(res, "Cannot change status until approved", 403);

  if (isOnline) await goOnline(driver._id.toString());
  else await goOffline(driver._id.toString());

  return successResponse(res, { isOnline }, `Driver is now ${isOnline ? "online" : "offline"}`, 200);
});

exports.getDriverProfile = catchAsync(async (req, res) => {
  const driver = await Driver.findById(req.user.id)
    .select("firstName lastName email phone profilePicture isVerified status isOnline")
    .lean();
  if (!driver) return errorResponse(res, "Profile not found.", 404);

  const safeDriver = {
    id: driver._id,
    firstName: driver.firstName,
    lastName: driver.lastName,
    email: driver.email,
    phone: driver.phone,
    profilePicture: driver.profilePicture,
    isVerified: driver.isVerified,
    status: driver.status,
    isOnline: driver.isOnline,
  };

  return successResponse(res, { driver: safeDriver }, "Profile fetched successfully.", 200);
});

// ===== UPDATE PROFILE =====
exports.updateProfile = catchAsync(async (req, res) => {
  const driverId = req.user.id;
  const { firstName, lastName, name } = req.body;

  // Find the driver
  const driver = await Driver.findById(driverId);
  if (!driver) {
    return errorResponse(res, "Driver not found", 404);
  }

  // Build updates object
  const updates = {};
  
  // Update firstName if provided
  if (firstName !== undefined) {
    updates.firstName = firstName.trim();
  }
  
  // Update lastName if provided
  if (lastName !== undefined) {
    updates.lastName = lastName.trim();
  }
  
  // If name is provided, split it into firstName and lastName
  if (name !== undefined && name.trim()) {
    const nameParts = name.trim().split(/\s+/);
    if (nameParts.length > 0) {
      updates.firstName = nameParts[0];
      if (nameParts.length > 1) {
        updates.lastName = nameParts.slice(1).join(" ");
      }
    }
  }
  
  // Update profile picture if uploaded
  if (req.file?.path) {
    updates.profilePicture = req.file.path;
  }

  // Check if there are any updates
  if (Object.keys(updates).length === 0) {
    return errorResponse(res, "No fields provided to update", 400);
  }

  // Update the driver
  const updatedDriver = await Driver.findByIdAndUpdate(
    driverId,
    updates,
    {
      new: true,
      runValidators: true,
    }
  );

  // Send real-time profile update notification to admin dashboard (fire-and-forget)
  setImmediate(async () => {
    try {
      await notifyDriverProfileUpdated(updatedDriver, updates);
    } catch (error) {
      // Log error but don't block - notifications are non-critical
    }
  });

  // Return safe driver object
  const safeDriver = {
    id: updatedDriver._id,
    firstName: updatedDriver.firstName,
    lastName: updatedDriver.lastName,
    email: updatedDriver.email,
    phone: updatedDriver.phone,
    profilePicture: updatedDriver.profilePicture,
  };

  return successResponse(
    res,
    { driver: safeDriver },
    "Profile updated successfully",
    200
  );
});

exports.getDriverDocuments = catchAsync(async (req, res) => {
  const driver = await Driver.findById(req.user.id)
    .select("documentFrontImage documentBackImage driverLicenseFront driverLicenseBack driverPassFront driverPassBack kiwaPermit insurancePolicy bankpass kvkUittreksel")
    .lean();

  if (!driver) return errorResponse(res, "Documents not found.", 404);

  const { _id, ...documents } = driver;
  const safeDocuments = { id: _id, ...documents };

  return successResponse(res, { documents: safeDocuments }, "Documents fetched successfully.", 200);
});

exports.getDriverVehicles = catchAsync(async (req, res) => {
  const vehicles = await Vehicle.find({ 
    driver: req.user.id,
    deletedAt: null // Exclude soft-deleted vehicles
  })
    .select("type brand model color plateNumber image status createdAt")
    .lean()
    .sort({ createdAt: -1 });

  const safeVehicles = vehicles.map(vehicle => ({
    id: vehicle._id,
    driver: vehicle.driver,
    type: vehicle.type,
    brand: vehicle.brand,
    model: vehicle.model,
    color: vehicle.color,
    plateNumber: vehicle.plateNumber,
    image: vehicle.image,
    status: vehicle.status,
  }));

  return successResponse(res, { vehicles: safeVehicles }, "Vehicles fetched successfully.", 200);
});

exports.getOnlineStatus = catchAsync(async (req, res) => {
  const driver = await Driver.findById(req.user.id);
  if (!driver) return errorResponse(res, "Online status not found.", 404);

  return successResponse(res, { isOnline: driver.isOnline }, "Online status fetched successfully.", 200);
});

exports.getOnboardingStatus = catchAsync(async (req, res) => {
  const driver = await Driver.findById(req.user.id);
  if (!driver) return errorResponse(res, "Driver not found.", 404);

  const requiredDocuments = [
    'documentFrontImage',
    'documentBackImage',
    'driverLicenseFront',
    'driverLicenseBack',
    'driverPassFront',
    'driverPassBack',
    'kiwaPermit',
    'insurancePolicy',
    'bankpass',
    'kvkUittreksel'
  ];

  const documentsIncomplete = requiredDocuments.some(doc => !driver[doc]);
  const profileIncomplete = !driver.firstName || !driver.lastName;
  const vehicleCount = await Vehicle.countDocuments({ driver: driver._id });
  const noVehicle = vehicleCount === 0;

  return successResponse(res, {
    onboardingStatus: {
      profileComplete: !profileIncomplete,
      documentsComplete: !documentsIncomplete,
      vehicleAdded: !noVehicle,
      adminApproved: driver.status === "Approved"
    }
  }, "Onboarding status fetched successfully.", 200);
});


// ===== ADMIN: GET ALL DRIVERS =====
exports.getAllDrivers = catchAsync(async (req, res) => {
  // Build base query - exclude soft-deleted drivers
  const query = Driver.find({ deletedAt: null });

  // Get base count (before additional filters for pagination accuracy)
  // Note: Additional filters from query params will be applied by APIFeatures
  const totalCount = await Driver.countDocuments({ deletedAt: null });

  // Apply APIFeatures for filtering, sorting, pagination
  const features = new APIFeatures(query, req.query)
    .filter()
    .sort()
    .limitFields()
    .paginate(totalCount);

  // Execute query
  let drivers = await features.query.lean();

  // Get vehicle counts and approved vehicles for each driver in parallel
  const driversWithVehicleCounts = await Promise.all(
    drivers.map(async (driver) => {
      const vehicleCount = await Vehicle.countDocuments({ 
      driver: driver._id,
      deletedAt: null 
    });
      
      // Get approved vehicles for this driver
      const approvedVehicles = await Vehicle.find({
        driver: driver._id,
        status: "Approved",
        deletedAt: null
      }).select("type brand model color plateNumber").lean();
      
      // Build safe driver object
      const safeDriver = {
        id: driver._id,
        firstName: driver.firstName,
        lastName: driver.lastName,
        email: driver.email,
        phone: driver.phone,
        profilePicture: driver.profilePicture,
        isVerified: driver.isVerified,
        status: driver.status,
        paidStatus: driver.paidStatus,
        isOnline: driver.isOnline,
        walletBalance: driver.walletBalance || 0,
        vehicleCount,
        vehicles: approvedVehicles.map(v => ({
          id: v._id.toString(),
          type: v.type,
          brand: v.brand,
          model: v.model,
          color: v.color,
          plateNumber: v.plateNumber,
        })),
        createdAt: driver.createdAt,
        updatedAt: driver.updatedAt,
      };

      return safeDriver;
    })
  );

  return successResponse(
    res,
    {
      drivers: driversWithVehicleCounts,
      pagination: features.pagination,
    },
    "Drivers fetched successfully.",
    200
  );
});

// ===== ADMIN: APPROVE OR REJECT DRIVER =====
exports.approveDriver = catchAsync(async (req, res) => {
  const { driverId, status } = req.body;

  // Individual field validation
  if (!driverId) return errorResponse(res, "Driver ID is required.", 400);
  if (!status) return errorResponse(res, "Status is required.", 400);
  if (!["Approved", "Rejected"].includes(status)) {
    return errorResponse(res, "Status must be either 'Approved' or 'Rejected'.", 400);
  }

  const driver = await Driver.findById(driverId);
  if (!driver) return errorResponse(res, "Driver not found.", 404);

  // Verification check
  if (!driver.isVerified) {
    return errorResponse(res, "Driver must verify their account before approval.", 403);
  }

  // Capture old status before updating
  const oldStatus = driver.status;
  driver.status = status;
  await driver.save({ validateBeforeSave: false });

  // If driver is approved, also approve all their vehicles
  if (status === "Approved") {
    await Vehicle.updateMany(
      { driver: driverId, status: { $in: ["Pending", "Rejected"] } },
      { status: "Approved" }
    );
  }

  // Send email notification
  try {
    let subject = "", message = "";
    if (status === "Approved") {
      subject = "Your driver account has been approved!";
      message = `Hi ${driver.firstName || "Driver"}, your driver account is now approved. You can log in and start accepting bookings.`;
    } else {
      subject = "Your driver account has been rejected";
      message = `Hi ${driver.firstName || "Driver"}, unfortunately your driver account has been rejected. Please contact support for more information.`;
    }

    await sendEmail({ email: driver.email, subject, message });
  } catch (err) {
    // Email notification failed
  }

  // Send real-time Ably notifications (fire-and-forget)
  setImmediate(async () => {
    try {
      await notifyDriverStatusChanged(driver, oldStatus, status);
    } catch (error) {
      // Log error but don't block - notifications are non-critical
    }
  });

  return successResponse(res, { driver }, `Driver ${status.toLowerCase()} successfully.`, 200);
});

// ===== DRIVER LOGIN =====
exports.loginDriver = catchAsync(async (req, res) => {
  const { email, phone, password } = req.body;
  if (!email && !phone) {
    return errorResponse(res, "Email or phone number is required.", 400);
  }
  if (!password) {
    return errorResponse(res, "Password is required.", 400);
  }

  // First check if account exists (including deleted accounts)
  const driver = await Driver.findOne({ email }).select("+password");
  if (!driver) {
    return errorResponse(res, "Account not found with this email or phone number.", 404);
  }

  // Check if account is deleted
  if (driver.deletedAt) {
    const daysSinceDeletion = (Date.now() - driver.deletedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceDeletion > 30) {
      return errorResponse(res, "Your account has been deleted and the recovery period (30 days) has expired. Please contact support for assistance.", 403);
    }
    return errorResponse(res, "Your account has been deleted. You can recover it within 30 days by using the account recovery feature. Please use the recover account option instead of login.", 403);
  }

  // Check password
  const isMatch = await driver.correctPassword(password);
  if (!isMatch) return errorResponse(res, "Invalid password.", 401);

  if (!driver.isVerified) {
    return errorResponse(res, "Please verify your account first. Check your email for OTP.", 403);
  }

  // Check admin approval - driver must be approved to login
  if (driver.status !== "Approved") {
    if (driver.status === "Pending") {
      return errorResponse(res, "Your account is pending admin approval. You will receive an email once approved.", 403);
    }
    if (driver.status === "Rejected") {
      return errorResponse(res, "Your account has been rejected by admin. Please contact support.", 403);
    }
  }

  // Set driver online
  await goOnline(driver._id.toString());

  // Prepare safe driver info
  const safeDriver = {
    id: driver._id,
    email: driver.email,
    phone: driver.phone,
    firstName: driver.firstName,
    lastName: driver.lastName,
    profilePicture: driver.profilePicture,
    isVerified: driver.isVerified,
    status: driver.status,
    isOnline: true,
    role: driver.role,
    tokenVersion: driver.tokenVersion || 0,
  };

  // Generate tokens manually (no cookies for Flutter apps)
  const accessToken = signAccessToken(safeDriver);
  const refreshToken = signRefreshToken(safeDriver);
  const hashedRefreshToken = await hashRefreshToken(refreshToken);

  // Store hashed refresh token in database (rotate old token)
  driver.refreshToken = hashedRefreshToken;
  await driver.save({ validateBeforeSave: false });

  // Return response with tokens in body only (for Flutter/mobile apps)
  return successResponse(
    res,
    {
      driver: safeDriver,
      tokens: {
        accessToken,
        refreshToken,
      },
    },
    "Driver logged in successfully!",
    200
  );
});

// ===== DRIVER LOGOUT =====
exports.logoutDriver = catchAsync(async (req, res) => {
  const driverId = req.user.id;
  
  // Verify driver exists
  const driver = await Driver.findById(driverId);
  if (!driver) {
    return errorResponse(res, "Driver account not found. Unable to logout.", 404);
  }
  
  try {
    // Build update object
    const updateData = {
      $inc: { tokenVersion: 1 },
      $unset: { refreshToken: "" }, // Clear refresh token from database
      $set: { fcmTokens: [] } // Automatically clear all FCM tokens
    };

    // Increment token version to invalidate all existing tokens (access and refresh)
    // Also clear all FCM tokens automatically
    await Driver.findByIdAndUpdate(driverId, updateData);
    
    // Set driver offline
    await goOffline(driverId);

    return successResponse(res, {}, "Logged out successfully. Your session has been terminated.", 200);
  } catch (error) {
    return errorResponse(res, "An error occurred during logout. Please try again.", 500);
  }
});

// ===== REFRESH ACCESS TOKEN =====
exports.refreshToken = catchAsync(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return errorResponse(res, "Refresh token not provided. Please login again.", 401);
  }
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

  // Find driver and verify refresh token exists in database (exclude soft-deleted)
  const driver = await Driver.findOne({ _id: decoded.id, deletedAt: null }).select("+refreshToken");
  if (!driver) {
    return errorResponse(res, "Driver account not found. Please login again.", 404);
  }

  // Check if token version matches
  if (decoded.tokenVersion !== (driver.tokenVersion || 0)) {
    return errorResponse(res, "Your session has been terminated. Please login again.", 401);
  }

  // Verify refresh token matches stored hashed token
  if (!driver.refreshToken) {
    return errorResponse(res, "Refresh token not found. Please login again.", 401);
  }

  const isTokenValid = await compareRefreshToken(refreshToken, driver.refreshToken);
  if (!isTokenValid) {
    return errorResponse(res, "Invalid refresh token. Please login again.", 401);
  }

  // Prepare safe driver info
  const safeDriver = {
    id: driver._id,
    email: driver.email,
    phone: driver.phone,
    firstName: driver.firstName,
    lastName: driver.lastName,
    profilePicture: driver.profilePicture,
    isVerified: driver.isVerified,
    status: driver.status,
    isOnline: driver.isOnline,
    role: driver.role,
    tokenVersion: driver.tokenVersion || 0,
  };

  // Generate new access and refresh tokens (rotation)
  const newAccessToken = signAccessToken(safeDriver);
  const newRefreshToken = signRefreshToken(safeDriver);
  const newHashedRefreshToken = await hashRefreshToken(newRefreshToken);

  driver.refreshToken = newHashedRefreshToken;
  await driver.save({ validateBeforeSave: false });
  return successResponse(
    res,
    {
      driver: safeDriver,
      tokens: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      },
    },
    "Tokens refreshed successfully.",
    200
  );
});

// ===== REGISTER FCM TOKEN (For Push Notifications) =====
exports.registerFcmToken = catchAsync(async (req, res) => {
  const driverId = req.user.id;
  const { fcmToken } = req.body;

  if (!fcmToken) {
    return errorResponse(res, "FCM token is required.", 400);
  }

  try {
    const driver = await Driver.findById(driverId);
    if (!driver) {
      return errorResponse(res, "Driver not found.", 404);
    }

    // Add token if it doesn't exist (prevent duplicates)
    if (!driver.fcmTokens || !driver.fcmTokens.includes(fcmToken)) {
      await Driver.findByIdAndUpdate(driverId, {
        $addToSet: { fcmTokens: fcmToken }, // $addToSet prevents duplicates
      });
    }

    return successResponse(
      res,
      { fcmTokenRegistered: true },
      "FCM token registered successfully. You will now receive push notifications.",
      200
    );
  } catch (error) {
    return errorResponse(res, "Failed to register FCM token.", 500);
  }
});

// ===== REMOVE FCM TOKEN (When user logs out or uninstalls app) =====
exports.removeFcmToken = catchAsync(async (req, res) => {
  const driverId = req.user.id;
  const { fcmToken } = req.body;

  if (!fcmToken) {
    return errorResponse(res, "FCM token is required.", 400);
  }

  try {
    await Driver.findByIdAndUpdate(driverId, {
      $pull: { fcmTokens: fcmToken },
    });

    return successResponse(
      res,
      { fcmTokenRemoved: true },
      "FCM token removed successfully.",
      200
    );
  } catch (error) {
    return errorResponse(res, "Failed to remove FCM token.", 500);
  }
});

// ===== UPDATE PASSWORD =====
exports.updatePassword = catchAsync(async (req, res) => {
  const driverId = req.user.id;
  const { currentPassword, newPassword, confirmPassword } = req.body;

  // Validation
  if (!currentPassword) return errorResponse(res, "Current password is required.", 400);
  if (!newPassword) return errorResponse(res, "New password is required.", 400);
  if (!confirmPassword) return errorResponse(res, "Confirm password is required.", 400);
  if (newPassword !== confirmPassword) return errorResponse(res, "New passwords do not match.", 400);
  if (newPassword.length < 8) return errorResponse(res, "Password must be at least 8 characters long.", 400);

  // Find driver with password
  const driver = await Driver.findById(driverId).select("+password");
  if (!driver) return errorResponse(res, "Driver not found.", 404);

  // Check if account is soft deleted
  if (driver.deletedAt) {
    return errorResponse(res, "Account is deleted. Please recover your account first.", 403);
  }

  // Verify current password
  const isCurrentPasswordCorrect = await driver.correctPassword(currentPassword);
  if (!isCurrentPasswordCorrect) {
    return errorResponse(res, "Current password is incorrect.", 401);
  }

  // Check if new password is same as current
  const isSamePassword = await driver.correctPassword(newPassword);
  if (isSamePassword) {
    return errorResponse(res, "New password must be different from current password.", 400);
  }

  // Update password
  driver.password = newPassword;
  driver.passwordConfirm = confirmPassword;
  await driver.save();

  // Invalidate all tokens by incrementing token version
  await Driver.findByIdAndUpdate(driverId, {
    $inc: { tokenVersion: 1 },
    $unset: { refreshToken: "" }
  });

  return successResponse(res, {}, "Password updated successfully. Please login again.", 200);
});

// ===== FORGOT PASSWORD =====
exports.forgotPassword = catchAsync(async (req, res) => {
  const { email } = req.body;

  if (!email) return errorResponse(res, "Email is required.", 400);

  // Find driver by email
  const driver = await Driver.findOne({ email, deletedAt: null }).select("+passwordResetOtp");
  if (!driver) {
    // Don't reveal if email exists or not (security best practice)
    return successResponse(res, {}, "If email exists, password reset OTP has been sent to your email.", 200);
  }

  // Check if account is soft deleted
  if (driver.deletedAt) {
    return errorResponse(res, "Account is deleted. Please recover your account first.", 403);
  }

  // Generate OTP for password reset
  const otp = generateOtp();
  driver.passwordResetOtp = otp;
  driver.passwordResetOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  driver.passwordResetOtpVerified = false; // Reset verification flag
  await driver.save({ validateBeforeSave: false });

  // Send email with OTP
  try {
    await sendEmail({
      email: driver.email,
      subject: "Taxigate - Password Reset OTP",
      message: `You requested a password reset. Your verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, please ignore this email.`,
    });

    return successResponse(res, {}, "Password reset OTP has been sent to your email.", 200);
  } catch (error) {
    // Clear OTP if email fails
    driver.passwordResetOtp = undefined;
    driver.passwordResetOtpExpiresAt = undefined;
    driver.passwordResetOtpVerified = false;
    await driver.save({ validateBeforeSave: false });

    return errorResponse(res, "Failed to send email. Please try again later.", 500);
  }
});

// ===== VERIFY PASSWORD RESET OTP =====
exports.verifyPasswordResetOtp = catchAsync(async (req, res) => {
  const { email, otp } = req.body;

  // Validation
  if (!email) return errorResponse(res, "Email is required.", 400);
  if (!otp) return errorResponse(res, "OTP is required.", 400);

  // Find driver by email with password reset OTP
  const driver = await Driver.findOne({ email, deletedAt: null }).select("+passwordResetOtp");

  if (!driver) {
    return errorResponse(res, "Driver not found.", 404);
  }

  // Check if account is soft deleted
  if (driver.deletedAt) {
    return errorResponse(res, "Account is deleted. Please recover your account first.", 403);
  }

  // Verify OTP exists
  if (!driver.passwordResetOtp) {
    return errorResponse(res, "No OTP found. Please request a new password reset.", 400);
  }

  // Verify OTP matches
  if (driver.passwordResetOtp !== otp) {
    return errorResponse(res, "Invalid OTP.", 400);
  }

  // Check if OTP is expired
  if (!driver.passwordResetOtpExpiresAt || driver.passwordResetOtpExpiresAt < new Date()) {
    return errorResponse(res, "OTP expired, please request a new one.", 400);
  }

  // Mark OTP as verified
  driver.passwordResetOtpVerified = true;
  await driver.save({ validateBeforeSave: false });

  return successResponse(
    res,
    { otpVerified: true },
    "OTP verified successfully. You can now reset your password.",
    200
  );
});

// ===== RESET PASSWORD =====
exports.resetPassword = catchAsync(async (req, res) => {
  const { email, password, confirmPassword } = req.body;

  // Validation
  if (!email) return errorResponse(res, "Email is required.", 400);
  if (!password) return errorResponse(res, "Password is required.", 400);
  if (!confirmPassword) return errorResponse(res, "Confirm password is required.", 400);
  if (password !== confirmPassword) return errorResponse(res, "Passwords do not match.", 400);
  if (password.length < 8) return errorResponse(res, "Password must be at least 8 characters long.", 400);

  // Find driver
  const driver = await Driver.findOne({ email, deletedAt: null });

  if (!driver) {
    return errorResponse(res, "Driver not found.", 404);
  }

  // Check if account is soft deleted
  if (driver.deletedAt) {
    return errorResponse(res, "Account is deleted. Please recover your account first.", 403);
  }

  // MANDATORY: Check if OTP was verified first
  if (!driver.passwordResetOtpVerified) {
    return errorResponse(res, "OTP verification required. Please verify OTP first before resetting password.", 403);
  }

  // Check if OTP session is still valid (not expired)
  if (!driver.passwordResetOtpExpiresAt || driver.passwordResetOtpExpiresAt < new Date()) {
    return errorResponse(res, "OTP session expired. Please request a new password reset.", 400);
  }

  // Update password and clear OTP fields
  driver.password = password;
  driver.passwordConfirm = confirmPassword;
  driver.passwordResetOtp = undefined;
  driver.passwordResetOtpExpiresAt = undefined;
  driver.passwordResetOtpVerified = false;
  await driver.save();

  // Invalidate all tokens by incrementing token version
  await Driver.findByIdAndUpdate(driver._id, {
    $inc: { tokenVersion: 1 },
    $unset: { refreshToken: "" }
  });

  return successResponse(res, {}, "Password reset successfully. Please login with your new password.", 200);
});

// ===== DELETE ACCOUNT (SOFT DELETE) =====
exports.deleteAccount = catchAsync(async (req, res) => {
  const driverId = req.user.id;
  const { password } = req.body;

  // Validation
  if (!password) return errorResponse(res, "Password is required to delete account.", 400);

  // Find driver with password
  const driver = await Driver.findById(driverId).select("+password");
  if (!driver) return errorResponse(res, "Driver not found.", 404);

  // Verify password
  const isPasswordCorrect = await driver.correctPassword(password);
  if (!isPasswordCorrect) {
    return errorResponse(res, "Incorrect password. Account deletion failed.", 401);
  }

  // Check if already deleted
  if (driver.deletedAt) {
    return errorResponse(res, "Account is already deleted.", 400);
  }

  // Soft delete: set deletedAt timestamp
  driver.deletedAt = new Date();
  
  // Invalidate all tokens
  driver.tokenVersion = (driver.tokenVersion || 0) + 1;
  driver.refreshToken = undefined;
  
  // Set driver offline
  await goOffline(driverId);
  
  // Clear FCM tokens
  driver.fcmTokens = [];
  
  await driver.save({ validateBeforeSave: false });

  // Soft delete all vehicles associated with this driver
  const deletedVehicles = await Vehicle.updateMany(
    { driver: driverId, deletedAt: null },
    { deletedAt: new Date() }
  );

  // Send email notification to driver
  try {
    await sendEmail({
      email: driver.email,
      subject: "Taxigate - Account Deleted",
      message: `Hi ${driver.firstName || "Driver"}, your driver account has been deleted successfully. All associated vehicles have been temporarily removed. You can recover your account within 30 days, and your vehicles will need admin approval again.`,
    });
  } catch (err) {
    // Email notification failed, but don't fail the request
  }

  // Notify admin about driver account deletion
  try {
    await notifyDriverAccountDeleted(driver, deletedVehicles.modifiedCount || 0);
  } catch (notificationError) {
    // Log error but don't fail account deletion
  }

  return successResponse(res, {}, "Account deleted successfully. You can recover it within 30 days.", 200);
});

// ===== RECOVER ACCOUNT =====
exports.recoverAccount = catchAsync(async (req, res) => {
  const { email, password } = req.body;

  // Validation
  if (!email) return errorResponse(res, "Email is required.", 400);
  if (!password) return errorResponse(res, "Password is required.", 400);

  // Find driver by email (including soft-deleted accounts)
  const driver = await Driver.findOne({ email }).select("+password");
  if (!driver) {
    return errorResponse(res, "Account not found with this email.", 404);
  }

  // Check if account is soft deleted
  if (!driver.deletedAt) {
    return errorResponse(res, "Account is not deleted. You can login normally.", 400);
  }

  // Check if recovery period has expired (30 days)
  const daysSinceDeletion = (Date.now() - driver.deletedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceDeletion > 30) {
    return errorResponse(res, "Account recovery period has expired (30 days). Please contact support.", 403);
  }

  // Verify password
  const isPasswordCorrect = await driver.correctPassword(password);
  if (!isPasswordCorrect) {
    return errorResponse(res, "Incorrect password. Account recovery failed.", 401);
  }

  // Recover account: remove deletedAt and reset status to Pending for admin approval
  driver.deletedAt = undefined;
  driver.status = "Pending"; // Reset status to Pending so admin needs to approve again
  await driver.save({ validateBeforeSave: false });

  // Recover all vehicles associated with this driver
  // Reset vehicle status to "Pending" so they need admin approval again
  await Vehicle.updateMany(
    { driver: driver._id, deletedAt: { $ne: null } },
    { 
      deletedAt: null,
      status: "Pending" // Reset status to Pending for admin approval
    }
  );

  return successResponse(res, {}, "Account recovered successfully. Your account and vehicles are now pending admin approval. You will receive an email notification once your account is approved.", 200);
});

// ===== GET WALLET BALANCE =====
exports.getWalletBalance = catchAsync(async (req, res) => {
  const driverId = req.user.id;

  const driver = await Driver.findById(driverId).select("walletBalance firstName lastName");
  if (!driver) return errorResponse(res, "Driver not found.", 404);

  // Ensure balance is a number and properly formatted
  const balance = parseFloat((driver.walletBalance || 0).toFixed(2));

  return successResponse(
    res,
    {
      wallet: {
        balance: balance,
        currency: "EUR",
      },
      driver: {
        id: driver._id,
        firstName: driver.firstName,
        lastName: driver.lastName,
      },
    },
    "Wallet balance fetched successfully.",
    200
  );
});

// ===== GET WALLET TRANSACTIONS =====
exports.getWalletTransactions = catchAsync(async (req, res) => {
  const driverId = req.user.id;

  // Verify driver exists
  const driver = await Driver.findById(driverId);
  if (!driver) {
    return errorResponse(res, "Driver not found.", 404);
  }

  // Build query with proper error handling
  const query = WalletTransaction.find({ driverId })
    .populate({
      path: "bookingId",
      select: "from_location to_location price date_time",
      model: "Bookings",
      // Handle case where booking might be deleted or not found
      options: { lean: true }
    })
    .sort({ createdAt: -1 });

  const totalCount = await WalletTransaction.countDocuments({ driverId });

  const features = new APIFeatures(query, req.query)
    .filter()
    .sort()
    .limitFields()
    .paginate(totalCount);

  let transactions = [];
  try {
    transactions = await features.query.lean();
  } catch (error) {
    // If populate fails, try without populate
    const simpleQuery = WalletTransaction.find({ driverId })
      .sort({ createdAt: -1 });
    const simpleFeatures = new APIFeatures(simpleQuery, req.query)
      .filter()
      .sort()
      .limitFields()
      .paginate(totalCount);
    transactions = await simpleFeatures.query.lean();
  }

  // Safely map transactions, handling cases where booking might be null
  const safeTransactions = transactions.map((transaction) => {
    const booking = transaction.bookingId;
    return {
      id: transaction._id,
      bookingId: booking?._id || transaction.bookingId || null,
      bookingDetails: booking && typeof booking === 'object' && booking._id
        ? {
            from_location: booking.from_location || null,
            to_location: booking.to_location || null,
            price: booking.price || null,
            date_time: booking.date_time || null,
          }
        : null,
      amount: transaction.amount || 0,
      type: transaction.type || "credit",
      description: transaction.description || null,
      balanceAfter: transaction.balanceAfter || 0,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    };
  });

  return successResponse(
    res,
    {
      transactions: safeTransactions,
      pagination: features.pagination,
    },
    "Wallet transactions fetched successfully.",
    200
  );
});

// ===== GET DRIVER STATS =====
exports.getDriverStats = catchAsync(async (req, res) => {
  const driverId = req.user.id;

  // Verify driver exists
  const driver = await Driver.findById(driverId).select("walletBalance");
  if (!driver) {
    return errorResponse(res, "Driver not found.", 404);
  }

  // Calculate today's total earnings
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Start of today
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1); // Start of tomorrow

  const todayBookings = await Booking.find({
    driverId: driverId,
    status: "completed",
    completedAt: {
      $gte: today,
      $lt: tomorrow,
    },
  })
    .select("driverPrice price commission")
    .lean();

  let totalEarnings = 0;
  if (todayBookings.length > 0) {
    totalEarnings = todayBookings.reduce((sum, booking) => {
      // Parse driverPrice if available, otherwise calculate from price - commission
      let driverPrice = 0;
      const explicitDriverPrice = parseFloat(String(booking.driverPrice || "0").replace(/[^\d.-]/g, "")) || 0;
      
      if (explicitDriverPrice > 0) {
        driverPrice = explicitDriverPrice;
      } else {
        const totalPrice = parseFloat(String(booking.price || "0").replace(/[^\d.-]/g, "")) || 0;
        const commission = parseFloat(String(booking.commission || "0").replace(/[^\d.-]/g, "")) || 0;
        driverPrice = Math.max(0, totalPrice - commission);
      }
      
      return sum + driverPrice;
    }, 0);
  }
  totalEarnings = parseFloat(totalEarnings.toFixed(2));

  // Count completed rides
  const completedRides = await Booking.countDocuments({
    driverId: driverId,
    status: "completed",
  });

  // Calculate average rating from completed bookings (if rating field exists)
  // Note: Rating field may not exist yet in the schema, so we handle it gracefully
  let averageRating = null;
  let totalRatings = 0;
  
  try {
    const completedBookingsWithRating = await Booking.find({
      driverId: driverId,
      status: "completed",
      rating: { $exists: true, $ne: null },
    })
      .select("rating")
      .lean();

    if (completedBookingsWithRating.length > 0) {
      const ratings = completedBookingsWithRating
        .map((booking) => booking.rating)
        .filter((rating) => rating !== null && rating !== undefined && !isNaN(rating) && rating >= 1 && rating <= 5);

      if (ratings.length > 0) {
        totalRatings = ratings.length;
        const sum = ratings.reduce((acc, rating) => acc + rating, 0);
        averageRating = Math.round((sum / ratings.length) * 100) / 100;
      }
    }
  } catch (error) {
    // Rating field doesn't exist yet, return null
  }

  return successResponse(
    res,
    {
      stats: {
        totalEarnings,
        completedRides,
        averageRating,
        totalRatings,
        currency: "EUR",
      },
    },
    "Driver stats fetched successfully.",
    200
  );
});

// ===== ADMIN: GET DRIVER COMPLETE DETAILS =====
exports.getDriverCompleteDetails = catchAsync(async (req, res) => {
  const { driverId } = req.params;

  if (!driverId) {
    return errorResponse(res, "Driver ID is required.", 400);
  }

  // Validate ObjectId format
  if (!mongoose.Types.ObjectId.isValid(driverId)) {
    return errorResponse(res, "Invalid driver ID format.", 400);
  }

  // Find driver with all fields (excluding password and sensitive fields)
  const driver = await Driver.findById(driverId)
    .select("-password -passwordConfirm -refreshToken -otp -passwordResetToken -passwordResetOtp")
    .lean();

  if (!driver) {
    return errorResponse(res, "Driver not found.", 404);
  }

  // Get vehicles associated with this driver
  const vehicles = await Vehicle.find({ 
    driver: driverId,
    deletedAt: null // Exclude soft-deleted vehicles
  })
    .select("type brand model color plateNumber image status createdAt updatedAt")
    .lean()
    .sort({ createdAt: -1 });

  const safeVehicles = vehicles.map((vehicle) => ({
    id: vehicle._id,
    type: vehicle.type,
    brand: vehicle.brand,
    model: vehicle.model,
    color: vehicle.color,
    plateNumber: vehicle.plateNumber,
    image: vehicle.image,
    status: vehicle.status,
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
  }));

  // Get wallet transactions
  const walletTransactions = await WalletTransaction.find({ driverId })
    .populate({
      path: "bookingId",
      select: "from_location to_location price date_time",
      model: "Bookings",
      options: { lean: true },
    })
    .sort({ createdAt: -1 })
    .limit(50) // Limit to last 50 transactions
    .lean();

  const safeTransactions = walletTransactions.map((transaction) => {
    const booking = transaction.bookingId;
    return {
      id: transaction._id,
      bookingId: booking?._id || transaction.bookingId || null,
      bookingDetails: booking && typeof booking === "object" && booking._id
        ? {
            from_location: booking.from_location || null,
            to_location: booking.to_location || null,
            price: booking.price || null,
            date_time: booking.date_time || null,
          }
        : null,
      amount: transaction.amount || 0,
      type: transaction.type || "credit",
      description: transaction.description || null,
      balanceAfter: transaction.balanceAfter || 0,
      createdAt: transaction.createdAt,
    };
  });

  // Get driver stats
  const completedRides = await Booking.countDocuments({
    driverId: driverId,
    status: "completed",
  });

  let averageRating = null;
  let totalRatings = 0;

  try {
    const completedBookingsWithRating = await Booking.find({
      driverId: driverId,
      status: "completed",
      rating: { $exists: true, $ne: null },
    })
      .select("rating")
      .lean();

    if (completedBookingsWithRating.length > 0) {
      const ratings = completedBookingsWithRating
        .map((booking) => booking.rating)
        .filter((rating) => rating !== null && rating !== undefined && !isNaN(rating) && rating >= 1 && rating <= 5);

      if (ratings.length > 0) {
        totalRatings = ratings.length;
        const sum = ratings.reduce((acc, rating) => acc + rating, 0);
        averageRating = Math.round((sum / ratings.length) * 100) / 100;
      }
    }
  } catch (error) {
    // Rating field not available
  }

  // Check document completion status
  const requiredDocuments = [
    "documentFrontImage",
    "documentBackImage",
    "driverLicenseFront",
    "driverLicenseBack",
    "driverPassFront",
    "driverPassBack",
    "kiwaPermit",
    "insurancePolicy",
    "bankpass",
    "kvkUittreksel",
  ];

  const documentsStatus = requiredDocuments.map((docName) => ({
    name: docName,
    uploaded: !!driver[docName],
    url: driver[docName] || null,
  }));

  const documentsComplete = requiredDocuments.every((doc) => driver[doc]);

  // Build complete driver object
  const driverDetails = {
    // Basic Information
    id: driver._id,
    firstName: driver.firstName,
    lastName: driver.lastName,
    email: driver.email,
    phone: driver.phone,
    profilePicture: driver.profilePicture,
    
    // Status Information
    isVerified: driver.isVerified,
    status: driver.status,
    paidStatus: driver.paidStatus,
    isOnline: driver.isOnline,
    
    // Wallet Information
    walletBalance: parseFloat((driver.walletBalance || 0).toFixed(2)),
    currency: "EUR",
    
    // Documents
    documents: {
      documentFrontImage: driver.documentFrontImage || null,
      documentBackImage: driver.documentBackImage || null,
      driverLicenseFront: driver.driverLicenseFront || null,
      driverLicenseBack: driver.driverLicenseBack || null,
      driverPassFront: driver.driverPassFront || null,
      driverPassBack: driver.driverPassBack || null,
      kiwaPermit: driver.kiwaPermit || null,
      insurancePolicy: driver.insurancePolicy || null,
      bankpass: driver.bankpass || null,
      kvkUittreksel: driver.kvkUittreksel || null,
    },
    documentsStatus: {
      complete: documentsComplete,
      details: documentsStatus,
      uploadedCount: documentsStatus.filter((doc) => doc.uploaded).length,
      totalCount: requiredDocuments.length,
    },
    
    // Vehicles
    vehicles: safeVehicles,
    vehicleCount: safeVehicles.length,
    
    // Wallet Transactions
    walletTransactions: safeTransactions,
    transactionCount: safeTransactions.length,
    
    // Stats
    stats: {
      totalEarnings: parseFloat((driver.walletBalance || 0).toFixed(2)),
      completedRides,
      averageRating,
      totalRatings,
      currency: "EUR",
    },
    
    // Timestamps
    createdAt: driver.createdAt,
    updatedAt: driver.updatedAt,
    deletedAt: driver.deletedAt || null,
  };

  return successResponse(
    res,
    { driver: driverDetails },
    "Driver complete details fetched successfully.",
    200
  );
});

// ===== ADMIN: DELETE DRIVER ACCOUNT (SOFT DELETE) =====
exports.deleteDriverAccount = catchAsync(async (req, res) => {
  const { driverId } = req.params;

  if (!driverId) {
    return errorResponse(res, "Driver ID is required.", 400);
  }

  // Validate ObjectId format
  if (!mongoose.Types.ObjectId.isValid(driverId)) {
    return errorResponse(res, "Invalid driver ID format.", 400);
  }

  // Find driver
  const driver = await Driver.findById(driverId);
  if (!driver) {
    return errorResponse(res, "Driver not found.", 404);
  }

  // Check if already deleted
  if (driver.deletedAt) {
    return errorResponse(res, "Driver account is already deleted.", 400);
  }

  // Soft delete: set deletedAt timestamp
  driver.deletedAt = new Date();

  // Invalidate all tokens
  driver.tokenVersion = (driver.tokenVersion || 0) + 1;
  driver.refreshToken = undefined;

  // Set driver offline
  await goOffline(driverId);

  // Clear FCM tokens
  driver.fcmTokens = [];

  await driver.save({ validateBeforeSave: false });

  // Soft delete all vehicles associated with this driver
  const deletedVehicles = await Vehicle.updateMany(
    { driver: driverId, deletedAt: null },
    { deletedAt: new Date() }
  );

  // Send email notification to driver
  try {
    await sendEmail({
      email: driver.email,
      subject: "Taxigate - Account Deleted by Admin",
      message: `Hi ${driver.firstName || "Driver"}, your driver account has been deleted by an administrator. All associated vehicles have been temporarily removed. You can recover your account within 30 days by contacting support, and your vehicles will need admin approval again.`,
    });
  } catch (err) {
    // Don't fail the request if email fails
  }

  // Notify admin about driver account deletion (for admin dashboard)
  try {
    await notifyDriverAccountDeleted(driver, deletedVehicles.modifiedCount || 0);
  } catch (notificationError) {
    // Log error but don't fail account deletion
  }

  return successResponse(
    res,
    {
      driver: {
        id: driver._id,
        email: driver.email,
        firstName: driver.firstName,
        lastName: driver.lastName,
        deletedAt: driver.deletedAt,
      },
    },
    "Driver account and all associated vehicles deleted successfully. The account can be recovered within 30 days.",
    200
  );
});