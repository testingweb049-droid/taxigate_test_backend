const express = require("express");
const {
  createBooking,
  sendBookingNotifications,
  getBookingStatus,
  getBookingByOrderNumber,
  assignDriverToBooking,
  unassignDriver,
  viewPendingLongDistanceBookings,
  getAllPendingBookings,
  viewAdminAssignedBookings,
  viewHighPriceBookings,
  viewLowPriceBookings,
  getAllBookings,
  getAvailableBookings,
  acceptBooking,
  rejectBooking,
  upcomingBookings,
  startBooking,
  activeBooking,
  pickupBooking,
  dropoffBooking,
  completeBooking,
  completedBookings,
  getAllAssignedBookings,
  getExpiredBookings,
  getLiveBookings,
  getAdminCompletedBookings,
  deleteBooking,
} = require("../controllers/booking.controller");
const { protect, restrictTo } = require("../middleware/auth.middleware");
const {
  validateCreateBooking,
  validateAssignDriver,
  validateDriverAction,
  validateRejectBooking,
} = require("../middleware/bookingValidation.middleware");

const router = express.Router();

// ===== USER ROUTES =====
router.post("/", validateCreateBooking, createBooking);
router.post("/:bookingId/send-notifications", sendBookingNotifications);
router.get("/:bookingId/status", getBookingStatus);
router.get("/order/:orderNumber", getBookingByOrderNumber);

// ===== ADMIN ROUTES =====
router.get(
  "/admin/all",
  protect,
  restrictTo("admin"),
  getAllBookings
);
router.get(
  "/admin/pending-long-distance",
  protect,
  restrictTo("admin"),
  viewPendingLongDistanceBookings
);
router.get(
  "/admin/pending",
  protect,
  restrictTo("admin"),
  getAllPendingBookings
);
router.get(
  "/admin/above-150",
  protect,
  restrictTo("admin"),
  viewHighPriceBookings
);
router.get(
  "/admin/below-150",
  protect,
  restrictTo("admin"),
  viewLowPriceBookings
);
router.get(
  "/admin/assigned",
  protect,
  restrictTo("admin"),
  viewAdminAssignedBookings
);
router.get(
  "/admin/expired",
  protect,
  restrictTo("admin"),
  getExpiredBookings
);
router.get(
  "/admin/completed",
  protect,
  restrictTo("admin"),
  getAdminCompletedBookings
);
router.patch(
  "/:bookingId/assign-driver",
  protect,
  restrictTo("admin"),
  validateAssignDriver,
  assignDriverToBooking
);
router.patch(
  "/:bookingId/unassign-driver",
  protect,
  restrictTo("admin"),
  unassignDriver
);
router.delete(
  "/:bookingId",
  protect,
  restrictTo("admin"),
  deleteBooking
);

// ===== UNIFIED ROUTES (DRIVER & ADMIN) =====
// Get all live bookings (non-expired, pending bookings) - Unified endpoint
// Works for both drivers and admins - Real-time updates via Ably
router.get(
  "/live",
  protect,
  restrictTo("admin", "driver"),
  getLiveBookings
);

// Legacy endpoint - kept for backward compatibility
router.get(
  "/driver/available",
  protect,
  restrictTo("admin", "driver"),
  getAvailableBookings
);

// ===== DRIVER ROUTES =====
router.patch(
  "/:bookingId/accept",
  protect,
  restrictTo("driver"),
  validateDriverAction,
  acceptBooking
);
router.patch(
  "/:bookingId/reject",
  protect,
  restrictTo("driver"),
  validateRejectBooking,
  rejectBooking
);
router.get(
  "/driver/upcoming",
  protect,
  restrictTo("driver"),
  upcomingBookings
);
router.patch(
  "/:bookingId/start",
  protect,
  restrictTo("driver"),
  validateDriverAction,
  startBooking
);
router.get(
  "/driver/active",
  protect,
  restrictTo("driver"),
  activeBooking
);
router.patch(
  "/:bookingId/pickup",
  protect,
  restrictTo("driver"),
  validateDriverAction,
  pickupBooking
);
router.patch(
  "/:bookingId/dropoff",
  protect,
  restrictTo("driver"),
  validateDriverAction,
  dropoffBooking
);
router.patch(
  "/:bookingId/complete",
  protect,
  restrictTo("driver"),
  validateDriverAction,
  completeBooking
);
router.get(
  "/driver/completed",
  protect,
  restrictTo("driver"),
  completedBookings
);
router.get(
  "/driver/assigned",
  protect,
  restrictTo("driver"),
  getAllAssignedBookings
);

module.exports = router;

