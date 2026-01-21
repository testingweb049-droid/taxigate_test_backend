// services/paymentConfirmation.service.js
const Booking = require("../models/booking.model");
const Payment = require("../models/payment.model");
const { confirmPayment } = require("./payment.service");
const {
  sendBookingNotifications,
} = require("../controllers/booking.controller");

/**
 * Confirm payment and trigger all notifications
 * This is called after Stripe webhook confirms payment
 * @param {string} bookingId - Booking ID
 * @param {string} paymentId - Payment ID
 * @returns {Promise<object>} - Updated booking and payment
 */
exports.confirmPaymentAndNotify = async (bookingId, paymentId) => {
  // Get payment record
  const payment = await Payment.findById(paymentId);
  if (!payment) {
    throw new Error("Payment not found");
  }

  // Verify payment belongs to booking
  if (payment.bookingId.toString() !== bookingId.toString()) {
    throw new Error("Payment does not belong to this booking");
  }

  // Check if already processed (idempotency)
  if (payment.status === "succeeded") {
    const booking = await Booking.findById(bookingId);
    if (booking && booking.isPaid) {
      return { booking, payment };
    }
  }

  // Update payment status (if not already succeeded)
  if (payment.status !== "succeeded") {
    payment.status = "succeeded";
    payment.paidAt = new Date();
    await payment.save();
  }

  // Update booking: mark as paid
  const booking = await Booking.findByIdAndUpdate(
    bookingId,
    {
      $set: {
        isPaid: true,
        paymentId: paymentId,
      },
    },
    { new: true }
  );

  if (!booking) {
    throw new Error("Booking not found");
  }

  // Send all notifications (emails, push notifications, Ably, etc.)
  try {
    await sendBookingNotificationsForBooking(booking);
  } catch (notificationError) {
    // Log error but don't fail payment confirmation
    console.error("Error sending notifications after payment confirmation:", notificationError.message);
  }

  return { booking, payment };
};

/**
 * Send booking notifications (extracted logic to avoid circular dependencies)
 * @param {object} booking - Booking object
 */
const sendBookingNotificationsForBooking = async (booking) => {
  const Booking = require("../models/booking.model");
  const sendEmail = require("../utils/email");
  const bookingConfirmationEmail = require("../templates/emails/bookingConfirmationEmail");
  const adminBookingNotificationEmail = require("../templates/emails/adminBookingNotificationEmail");
  const {
    notifyNewBooking,
    notifyAllDriversNewBooking,
    notifyAdminBookingCreated,
    notifyLiveBookingAdded,
  } = require("../services/bookingNotifications");
  const { scheduleBookingExpiry } = require("../services/bookingExpiryScheduler");

  // Check if notifications already sent
  if (booking.notificationsSentAt) {
    return;
  }

  // Calculate price for assignment type check
  const actualPriceNumber = parseFloat(String(booking.actualPrice || booking.price || "0").replace(/[^\d.-]/g, "")) || 0;
  const isAutoAssigned = actualPriceNumber <= 150 && booking.assignmentType === "auto";

  // PHASE 1: Send email notifications
  try {
    // Send email to customer
    if (booking.email) {
      try {
        const customerEmailHtml = bookingConfirmationEmail(booking);
        await sendEmail({
          email: booking.email,
          subject: `Booking Confirmation`,
          html: customerEmailHtml,
          text: `Booking Confirmation - Your booking has been confirmed.`,
        });
      } catch (customerEmailError) {
        console.error("Failed to send email to customer:", customerEmailError.message);
      }
    }

    // Send email to admin
    const adminHtml = adminBookingNotificationEmail(booking);
    const adminEmail = process.env.EMAIL_USERNAME;

    if (adminEmail) {
      try {
        await sendEmail({
          email: adminEmail,
          subject: `New Booking Created`,
          html: adminHtml,
        });
      } catch (adminEmailError) {
        console.error("Failed to send email to admin:", adminEmailError.message);
      }
    }
  } catch (emailError) {
    console.error("Error in email sending process:", emailError.message);
  }

  // PHASE 2: Send push notifications to drivers (only for auto-assigned bookings)
  if (isAutoAssigned) {
    try {
      await notifyAllDriversNewBooking(booking);
    } catch (fcmError) {
      console.error("Failed to send push notifications:", fcmError.message);
    }
  }

  // PHASE 3: Schedule expiry for auto-assigned pending bookings
  scheduleBookingExpiry(booking);

  // PHASE 4: Send Ably real-time notifications
  try {
    // Always notify admin
    try {
      await notifyAdminBookingCreated(booking);
    } catch (adminNotifError) {
      console.error("Failed to notify admin:", adminNotifError.message);
    }

    // Send real-time notifications to online drivers (only for auto-assigned)
    if (isAutoAssigned) {
      try {
        await notifyNewBooking(booking);
      } catch (notificationError) {
        console.error("Failed to notify drivers:", notificationError.message);
      }
    }

    // Send live booking added notification (only for auto-assigned bookings)
    if (isAutoAssigned && booking.status === "pending" && !booking.isExpired) {
      try {
        await notifyLiveBookingAdded(booking);
      } catch (liveError) {
        console.error("Failed to add to live bookings:", liveError.message);
      }
    }
  } catch (globalError) {
    console.error("Global notification error:", globalError.message);
  }

  // Mark notifications as sent
  booking.notificationsSentAt = new Date();
  await booking.save();
};

