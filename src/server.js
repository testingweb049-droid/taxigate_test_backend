require("dotenv").config();
const mongoose = require("mongoose");
const app = require("./app");
const connectDB = require("../config/database");
const logger = require("./utils/logger");
const chalk = require("chalk");
const notifyUpcomingBookingsJob = require("./jobs/notifyUpcomingBookings");

// Ensure database connection before handling requests
let isConnecting = false;
let connectionPromise = null;

const ensureDBConnection = async () => {
  // If already connected, return immediately
  if (mongoose.connection.readyState === 1) {
    return;
  }

  // If connection is in progress, wait for it
  if (isConnecting && connectionPromise) {
    return connectionPromise;
  }

  // Start new connection
  isConnecting = true;
  connectionPromise = connectDB()
    .then(() => {
      isConnecting = false;
      return;
    })
    .catch((err) => {
      isConnecting = false;
      connectionPromise = null;
      throw err;
    });

  return connectionPromise;
};

// Enhanced middleware with better error handling
app.use(async (req, res, next) => {
  // Skip connection check if already connected
  if (mongoose.connection.readyState === 1) {
    return next();
  }

  try {
    await ensureDBConnection();
    next();
  } catch (error) {
    return res.status(503).json({
      status: "error", 
      message: "Database connection unavailable. Please try again.",
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  
  res.status(200).json({
    status: 'success',
    message: 'Server is running',
    database: dbStatus,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Only start server if not in Vercel serverless environment
// In Vercel, the app is exported and handled by the serverless function
if (!process.env.VERCEL) {
  // Initialize connection on startup
  (async () => {
    try {
      await ensureDBConnection();
      
      // Check webhook secret configuration
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (webhookSecret) {
        const secretPreview = webhookSecret.length > 10 
          ? `${webhookSecret.substring(0, 6)}...${webhookSecret.substring(webhookSecret.length - 4)}`
          : "***";
        logger.info(chalk.green(`Stripe webhook secret configured: ${secretPreview}`));
      } else {
        logger.warn(chalk.yellow("STRIPE_WEBHOOK_SECRET not found in .env file"));
        logger.warn(chalk.yellow("   Webhook endpoint will not work without this secret"));
      }
      
      // Initialize background jobs
      logger.info(chalk.blue("Initializing cron jobs..."));
      // Note: Booking expiry is now handled in real-time via bookingExpiryScheduler
      // No need for cron job - each booking schedules its own expiry timer
      notifyUpcomingBookingsJob();
      logger.info(chalk.green("All cron jobs initialized successfully"));
      
      const PORT = process.env.PORT || 5000;
      const NODE_ENV = process.env.NODE_ENV || "development";
      
      app.listen(PORT, () => {
        logger.info(chalk.green(`Server running in ${NODE_ENV} mode on port ${PORT}`));
        logger.info(chalk.blue(`Webhook endpoint ready at: http://localhost:${PORT}/api/payments/webhook`));
        logger.info(chalk.yellow(`For local testing, use Stripe CLI: stripe listen --forward-to localhost:${PORT}/api/payments/webhook`));
      });
    } catch (err) {
      process.exit(1);
    }
  })();
} else {
  // In Vercel, initialize DB connection on first request (lazy loading)
  // The middleware will handle connection for each request
  logger.info(chalk.blue("Running in Vercel serverless environment"));
  
  // Check webhook secret configuration
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (webhookSecret) {
    const secretPreview = webhookSecret.length > 10 
      ? `${webhookSecret.substring(0, 6)}...${webhookSecret.substring(webhookSecret.length - 4)}`
      : "***";
    logger.info(chalk.green(`Stripe webhook secret configured: ${secretPreview}`));
  } else {
    logger.warn(chalk.yellow("STRIPE_WEBHOOK_SECRET not found in environment variables"));
    logger.warn(chalk.yellow("   Webhook endpoint will not work without this secret"));
  }
}

module.exports = app;