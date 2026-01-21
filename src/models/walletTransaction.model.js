// src/models/walletTransaction.model.js
const mongoose = require("mongoose");

const walletTransactionSchema = new mongoose.Schema(
  {
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
      index: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bookings",
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    type: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
      default: "credit",
    },
    description: {
      type: String,
      trim: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes for efficient queries
walletTransactionSchema.index({ driverId: 1, createdAt: -1 });
walletTransactionSchema.index({ bookingId: 1 });
walletTransactionSchema.index({ type: 1, createdAt: -1 });

module.exports =
  mongoose.models.WalletTransaction ||
  mongoose.model("WalletTransaction", walletTransactionSchema);

