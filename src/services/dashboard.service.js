const Booking = require("../models/booking.model");
const Driver = require("../models/driver.model");

/**
 * Get dashboard statistics
 * Returns: Total Sales, Today Orders, Completed Orders, Pending Orders
 */
exports.getDashboardStats = async () => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  // Total Sales - sum of actualPrice from all completed bookings
  const completedBookings = await Booking.find({ status: "completed" })
    .select("actualPrice price")
    .lean();

  const totalSales = completedBookings.reduce((sum, booking) => {
    const priceStr = booking.actualPrice || booking.price || "0";
    const priceNum = parseFloat(String(priceStr).replace(/[^\d.-]/g, "")) || 0;
    return sum + priceNum;
  }, 0);

  // Today Orders - count of bookings created today
  const todayOrders = await Booking.countDocuments({
    createdAt: {
      $gte: startOfToday,
      $lte: endOfToday,
    },
  });

  // Completed Orders - count of completed bookings
  const completedOrders = await Booking.countDocuments({
    status: "completed",
  });

  // Pending Orders - count of pending bookings (not expired, not cancelled)
  const pendingOrders = await Booking.countDocuments({
    status: "pending",
    isExpired: false,
  });

  return {
    totalSales: totalSales.toFixed(2),
    todayOrders,
    completedOrders,
    pendingOrders,
  };
};

/**
 * Get revenue chart data (monthly revenue for last 12 months)
 */
exports.getRevenueChartData = async () => {
  const now = new Date();
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const bookings = await Booking.find({
    status: "completed",
    createdAt: { $gte: twelveMonthsAgo },
  })
    .select("actualPrice price createdAt")
    .lean();

  // Group by month manually
  const revenueMap = new Map();
  bookings.forEach((booking) => {
    const date = new Date(booking.createdAt);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const key = `${year}-${month}`;

    const priceStr = booking.actualPrice || booking.price || "0";
    const priceNum = parseFloat(String(priceStr).replace(/[^\d.-]/g, "")) || 0;

    if (!revenueMap.has(key)) {
      revenueMap.set(key, { revenue: 0, orders: 0 });
    }
    const data = revenueMap.get(key);
    data.revenue += priceNum;
    data.orders += 1;
  });

  // Generate data for last 12 months
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "July", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const chartData = {
    labels: [],
    netProfit: [], // Revenue
    orders: [], // Completed orders count
  };

  for (let i = 11; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
    const data = revenueMap.get(monthKey) || { revenue: 0, orders: 0 };

    chartData.labels.push(months[date.getMonth()]);
    chartData.netProfit.push(Math.round(data.revenue));
    chartData.orders.push(data.orders);
  }

  return chartData;
};

/**
 * Get recent orders (latest bookings)
 */
exports.getRecentOrders = async (limit = 10) => {
  const bookings = await Booking.find({})
    .select("_id orderNumber from_location to_location user_name email actualPrice price status createdAt")
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .lean();

  return bookings.map((booking) => ({
    id: booking._id.toString(),
    orderNumber: booking.orderNumber || booking._id.toString(), // Use orderNumber if available, fallback to _id
    username: booking.user_name,
    date: new Date(booking.createdAt).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    amount: parseFloat(String(booking.actualPrice || booking.price || "0").replace(/[^\d.-]/g, "")).toFixed(2),
    isComplete: booking.status === "completed",
  }));
};

/**
 * Get top customers (customers with most bookings or highest spending)
 */
exports.getTopCustomers = async (limit = 7) => {
  // Only count completed bookings for top customers (they generate revenue)
  const bookings = await Booking.find({
    status: "completed",
  })
    .select("email user_name actualPrice price")
    .lean();

  // Group by email manually
  const customerMap = new Map();
  bookings.forEach((booking) => {
    const email = booking.email;
    if (!customerMap.has(email)) {
      customerMap.set(email, {
        name: booking.user_name,
        totalBookings: 0,
        totalSpent: 0,
      });
    }
    const customer = customerMap.get(email);
    customer.totalBookings += 1;
    const priceStr = booking.actualPrice || booking.price || "0";
    const priceNum = parseFloat(String(priceStr).replace(/[^\d.-]/g, "")) || 0;
    customer.totalSpent += priceNum;
  });

  const customerData = Array.from(customerMap.entries())
    .map(([email, data]) => ({
      _id: email,
      name: data.name,
      totalBookings: data.totalBookings,
      totalSpent: data.totalSpent,
    }))
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, parseInt(limit));

  // Calculate score based on total spent (normalized to 0-100)
  const maxSpent = customerData.length > 0 ? customerData[0].totalSpent : 1;
  
  return customerData.map((customer, index) => {
    const score = Math.round((customer.totalSpent / maxSpent) * 100);
    // Determine color based on score
    let color = "destructive";
    if (score >= 80) color = "success";
    else if (score >= 60) color = "primary";
    else if (score >= 40) color = "info";
    else if (score >= 20) color = "warning";

    return {
      id: index + 1,
      name: customer.name,
      email: customer._id, // Use email from _id field
      score,
      color,
      amount: customer.totalSpent.toFixed(2),
      totalBookings: customer.totalBookings,
    };
  });
};

/**
 * Get booking status statistics (for customer statistics chart)
 */
exports.getBookingStatusStats = async () => {
  const completed = await Booking.countDocuments({ status: "completed" });
  const pending = await Booking.countDocuments({ 
    status: "pending",
    isExpired: false,
  });
  const cancelled = await Booking.countDocuments({ status: "cancelled" });

  return {
    completed,
    pending,
    cancelled,
  };
};
