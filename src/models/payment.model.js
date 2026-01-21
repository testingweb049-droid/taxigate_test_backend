// models/payment.model.js
const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bookings",
      required: true,
      index: true,
    },

    stripeSessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    stripePaymentIntentId: {
      type: String,
      trim: true,
      index: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "eur",
      uppercase: true,
      trim: true,
    },

    status: {
      type: String,
      enum: ["pending", "succeeded", "failed", "refunded"],
      default: "pending",
      index: true,
    },

    metadata: {
      type: Map,
      of: String,
      default: {},
    },

    paidAt: {
      type: Date,
    },
    failedAt: {
      type: Date,
    },
    refundedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    versionKey: "__v",
  }
);

paymentSchema.index({ bookingId: 1, status: 1 });
paymentSchema.index({ stripeSessionId: 1, status: 1 });
paymentSchema.index({ createdAt: -1 });
paymentSchema.virtual("formattedAmount").get(function () {
  return `${(this.amount / 100).toFixed(2)} ${this.currency.toUpperCase()}`;
});

module.exports =
  mongoose.models.Payment || mongoose.model("Payment", paymentSchema);

