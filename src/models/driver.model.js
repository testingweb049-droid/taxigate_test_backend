// src/models/driver.model.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const DriverSchema = new mongoose.Schema(
  {
    firstName: { type: String, trim: true, index: true },
    lastName: { type: String, trim: true, index: true },
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true, index: true },
    phone: { type: String, sparse: true, trim: true, index: true },

    // Password fields
    password: { type: String, minlength: 8, select: false },
    passwordConfirm: {
      type: String,
      required: function () { return this.isNew; },
      validate: {
        validator: function (el) { return this.isNew ? el === this.password : true; },
        message: "Passwords do not match!",
      },
    },
    passwordChangedAt: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
    // Password reset OTP
    passwordResetOtp: { type: String, trim: true, select: false },
    passwordResetOtpExpiresAt: { type: Date, index: true },
    passwordResetOtpVerified: { type: Boolean, default: false },

    // Verification & status
    isVerified: { type: Boolean, default: false, index: true },
    status: { type: String, enum: ["Pending", "Approved", "Rejected"], default: "Pending", index: true },
    paidStatus: { type: String, enum: ["Paid", "Unpaid"], default: "Unpaid", index: true },
    isOnline: { type: Boolean, default: false, index: true },

    // OTP
    otp: { type: String, trim: true },
    otpExpiresAt: { type: Date, index: true },
    otpSendCount: { type: Number, default: 0 },
    otpLastSentAt: { type: Date },

    // Documents & profile
    profilePicture: { type: String, trim: true },
    documentFrontImage: { type: String, trim: true },
    documentBackImage: { type: String, trim: true },
    driverLicenseFront: { type: String, trim: true },
    driverLicenseBack: { type: String, trim: true },
    driverPassFront: { type: String, trim: true },
    driverPassBack: { type: String, trim: true },
    kiwaPermit: { type: String, trim: true },
    insurancePolicy: { type: String, trim: true },
    bankpass: { type: String, trim: true },
    kvkUittreksel: { type: String, trim: true },

    fcmTokens: [{ type: String, trim: true }],

    // Role fixed as driver
    role: { type: String, enum: ["driver"], default: "driver", index: true },
    
    // Token version for logout invalidation
    tokenVersion: { type: Number, default: 0 },
    
    // Refresh token (hashed) for token rotation
    refreshToken: { type: String, select: false },
    
    // Soft delete
    deletedAt: { type: Date, default: null, index: true },
    
    // Wallet
    walletBalance: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, versionKey: false }
);

// ===== MIDDLEWARE =====

// Hash password before saving
DriverSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  this.passwordConfirm = undefined;
  next();
});

// Update passwordChangedAt
DriverSchema.pre("save", function (next) {
  if (!this.isModified("password") || this.isNew) return next();
  this.passwordChangedAt = Date.now() - 1000;
  next();
});

// ===== METHODS =====

// Compare entered password with stored password
DriverSchema.methods.correctPassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Check if password was changed after JWT issued
DriverSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

// Generate password reset token
DriverSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString("hex");
  this.passwordResetToken = crypto.createHash("sha256").update(resetToken).digest("hex");
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  return resetToken;
};

// ===== INDEXES =====
DriverSchema.index({ status: 1, isVerified: 1 });
DriverSchema.index({ isOnline: 1, status: 1 });
DriverSchema.index({ paidStatus: 1, isVerified: 1 });
DriverSchema.index({ firstName: "text", lastName: "text", email: "text", phone: "text" });
DriverSchema.index({ createdAt: -1 });

module.exports = mongoose.models.Driver || mongoose.model("Driver", DriverSchema);
