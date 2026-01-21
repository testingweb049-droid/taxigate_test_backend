const express = require("express");
const {
    signupAdmin,
    loginAdmin,
    logoutAdmin,
    refreshToken,
    getMe,
    getTotalWalletBalance,
} = require("../controllers/admin.controller");
const {
    getDashboardStats,
    getRevenueChartData,
    getRecentOrders,
    getTopCustomers,
    getBookingStatusStats,
} = require("../controllers/dashboard.controller");
const { getBookingByOrderNumber } = require("../controllers/booking.controller");
const { protect, restrictTo } = require("../middleware/auth.middleware");

const router = express.Router();

// ===== PUBLIC ROUTES =====
router.post("/signup", signupAdmin);
router.post("/login", loginAdmin);

// ===== REFRESH TOKEN ROUTE (No auth required, uses refresh token cookie) =====
router.post("/refresh-token", refreshToken);

// ===== PROTECTED ADMIN ROUTES =====
router.get("/me", protect, restrictTo("admin"), getMe);
router.post("/logout", protect, restrictTo("admin"), logoutAdmin);
router.get("/wallet/total", protect, restrictTo("admin"), getTotalWalletBalance);

// ===== DASHBOARD ROUTES =====
router.get("/dashboard/stats", protect, restrictTo("admin"), getDashboardStats);
router.get("/dashboard/revenue-chart", protect, restrictTo("admin"), getRevenueChartData);
router.get("/dashboard/recent-orders", protect, restrictTo("admin"), getRecentOrders);
router.get("/dashboard/top-customers", protect, restrictTo("admin"), getTopCustomers);
router.get("/dashboard/booking-status-stats", protect, restrictTo("admin"), getBookingStatusStats);
router.get("/dashboard/order/:orderNumber", protect, restrictTo("admin"), getBookingByOrderNumber);

module.exports = router;
