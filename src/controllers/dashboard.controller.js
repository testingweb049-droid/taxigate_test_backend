const catchAsync = require("../utils/catchAsync");
const { successResponse, errorResponse } = require("../utils/response");
const {
  getDashboardStats,
  getRevenueChartData,
  getRecentOrders,
  getTopCustomers,
  getBookingStatusStats,
} = require("../services/dashboard.service");

/**
 * Get dashboard statistics
 * GET /api/dashboard/stats
 */
exports.getDashboardStats = catchAsync(async (req, res) => {
  const stats = await getDashboardStats();
  return successResponse(res, stats, "Dashboard statistics fetched successfully");
});

/**
 * Get revenue chart data
 * GET /api/dashboard/revenue-chart
 */
exports.getRevenueChartData = catchAsync(async (req, res) => {
  const chartData = await getRevenueChartData();
  return successResponse(res, chartData, "Revenue chart data fetched successfully");
});

/**
 * Get recent orders
 * GET /api/dashboard/recent-orders?limit=10
 */
exports.getRecentOrders = catchAsync(async (req, res) => {
  const { limit = 10 } = req.query;
  const orders = await getRecentOrders(limit);
  return successResponse(res, { orders }, "Recent orders fetched successfully");
});

/**
 * Get top customers
 * GET /api/dashboard/top-customers?limit=7
 */
exports.getTopCustomers = catchAsync(async (req, res) => {
  const { limit = 7 } = req.query;
  const customers = await getTopCustomers(limit);
  return successResponse(res, { customers }, "Top customers fetched successfully");
});

/**
 * Get booking status statistics
 * GET /api/dashboard/booking-status-stats
 */
exports.getBookingStatusStats = catchAsync(async (req, res) => {
  const stats = await getBookingStatusStats();
  return successResponse(res, stats, "Booking status statistics fetched successfully");
});
