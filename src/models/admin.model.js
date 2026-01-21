// src/models/admin.model.js
const mongoose = require("mongoose");
const validator = require("validator");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const adminSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please provide your name"],
      trim: true,
      index: true,
    },
    email: {
      type: String,
      required: [true, "Please provide your email"],
      unique: true,
      lowercase: true,
      trim: true,
      validate: [validator.isEmail, "Please provide a valid email"],
      index: true,
    },
    dateOfBirth: { type: Date, index: true },
    phoneNumber: {
      type: String,
      trim: true,
      validate: {
        validator: (v) => /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]*$/.test(v),
        message: "Please enter a valid phone number",
      },
      index: true,
    },
    gender: { type: String, enum: ["Male", "Female", "Other"], index: true },
    avatar: { type: String, default: "", trim: true },
    role: { type: String, enum: ["admin"], default: "admin", index: true },

    password: { type: String, required: true, minlength: 8, select: false },
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
    active: { type: Boolean, default: true, select: false, index: true },
    
    // Token version for logout invalidation
    tokenVersion: { type: Number, default: 0 },
    
    // Refresh token (hashed) for token rotation
    refreshToken: { type: String, select: false },
  },
  { timestamps: true, versionKey: false }
);

// ===== MIDDLEWARE =====

// Hash password before saving
adminSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  this.passwordConfirm = undefined;
  next();
});

// Update passwordChangedAt
adminSchema.pre("save", function (next) {
  if (!this.isModified("password") || this.isNew) return next();
  this.passwordChangedAt = Date.now() - 1000;
  next();
});

// ===== METHODS =====

// Compare password
adminSchema.methods.correctPassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Check if password was changed after JWT issued
adminSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

// Generate password reset token
adminSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString("hex");
  this.passwordResetToken = crypto.createHash("sha256").update(resetToken).digest("hex");
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  return resetToken;
};

// ===== INDEXES =====
adminSchema.index({ email: 1 });
adminSchema.index({ role: 1, active: 1 });
adminSchema.index({ createdAt: -1 });
adminSchema.index({ name: "text", email: "text", phoneNumber: "text" });

module.exports = mongoose.models.Admin || mongoose.model("Admin", adminSchema);
