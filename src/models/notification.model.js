// models/notification.model.js
const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    /**
     * NOTIFICATION TYPE
     */
    type: {
      type: String,
      required: true,
      enum: ["booking-expired", "booking-assigned", "booking-cancelled", "booking-created", "booking-completed", "system"],
      index: true,
    },

    /**
     * TITLE AND MESSAGE
     */
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * RELATED BOOKING (if applicable)
     */
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bookings",
      index: true,
    },

    /**
     * BOOKING DETAILS (for quick access without joining)
     */
    bookingDetails: {
      from_location: String,
      to_location: String,
      price: String,
      user_name: String,
      email: String,
    },

    /**
     * READ STATUS
     */
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },

    /**
     * READ BY ADMIN
     */
    readBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
    readAt: {
      type: Date,
    },

    /**
     * PRIORITY
     */
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
      index: true,
    },

    /**
     * ADDITIONAL DATA
     */
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

/**
 * Indexes for efficient querying
 */
notificationSchema.index({ type: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ bookingId: 1 });
notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ isRead: 1, createdAt: -1 });

module.exports =
  mongoose.models.Notification || mongoose.model("Notification", notificationSchema);

