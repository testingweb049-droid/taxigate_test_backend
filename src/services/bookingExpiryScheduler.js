const Booking = require("../models/booking.model");
const {
  notifyBookingExpired,
  notifyAdminBookingExpired,
  notifyLiveBookingRemoved,
} = require("./bookingNotifications");
const logger = require("../utils/logger");

// In-memory map of bookingId -> timeout
const expiryTimers = new Map();

const clearExpiryTimer = (bookingId) => {
  const timer = expiryTimers.get(bookingId);
  if (timer) {
    clearTimeout(timer);
    expiryTimers.delete(bookingId);
    logger.debug?.(`[EXPIRY] Cleared expiry timer for booking ${bookingId}`);
  }
};

const scheduleBookingExpiry = (booking) => {
  try {
    // Only auto-assigned, pending, non-expired bookings with expiresAt
    if (
      booking.assignmentType !== "auto" ||
      booking.status !== "pending" ||
      booking.isExpired === true
    ) {
      return;
    }

    const bookingId = booking._id?.toString();
    if (!bookingId) return;

    const expiresAt = booking.expiresAt instanceof Date ? booking.expiresAt : new Date(booking.expiresAt);
    const now = new Date();
    const delay = Math.max(expiresAt - now, 0);

    // If already expired by time calculation, expire immediately
    if (delay === 0) {
      expireBookingNow(bookingId);
      return;
    }

    clearExpiryTimer(bookingId);

    const timer = setTimeout(() => expireBookingNow(bookingId), delay);
    expiryTimers.set(bookingId, timer);
    logger.info(`[EXPIRY] Scheduled expiry for booking ${bookingId} in ${delay}ms`);
  } catch (err) {
    logger.error(`[EXPIRY] Failed to schedule expiry: ${err.message}`);
  }
};

const expireBookingNow = async (bookingId) => {
  try {
    clearExpiryTimer(bookingId);

    const now = new Date();
    const booking = await Booking.findOneAndUpdate(
      {
        _id: bookingId,
        assignmentType: "auto",
        status: "pending",
        isExpired: { $ne: true },
      },
      {
        $set: {
          isExpired: true,
          expiredAt: now,
        },
      },
      { new: true }
    );

    if (!booking) {
      // Already expired or not eligible
      return;
    }

    await notifyBookingExpired(booking);
    await notifyAdminBookingExpired(booking);
    await notifyLiveBookingRemoved(booking);

    logger.info(`[EXPIRY] Booking ${bookingId} expired and notifications sent`);
  } catch (err) {
    logger.error(`[EXPIRY] Error expiring booking ${bookingId}: ${err.message}`);
  }
};

module.exports = {
  scheduleBookingExpiry,
  clearExpiryTimer,
};

