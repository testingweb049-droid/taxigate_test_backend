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

// Initialize connection on startup
(async () => {
  try {
    await ensureDBConnection();
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
    logger.info(chalk.blue("Initializing cron jobs..."));
    notifyUpcomingBookingsJob();
    logger.info(chalk.green("All cron jobs initialized successfully"));
    
    const PORT = process.env.PORT || 5000;
    const NODE_ENV = process.env.NODE_ENV || "development";
    
    app.listen(PORT, () => {
      logger.info(chalk.green(`Server running in ${NODE_ENV} mode on port ${PORT}`));
      
      if (NODE_ENV === "production") {
        const productionUrl = process.env.VERCEL_URL 
          ? `https://${process.env.VERCEL_URL}` 
          : "https://taxigate-driver-panel.vercel.app";
        logger.info(chalk.blue(`Webhook endpoint: ${productionUrl}/api/payments/webhook`));
        logger.info(chalk.yellow(`Configure this URL in Stripe Dashboard → Webhooks`));
      } else {
        logger.info(chalk.blue(`Webhook endpoint ready at: http://localhost:${PORT}/api/payments/webhook`));
        logger.info(chalk.yellow(`For local testing, use Stripe CLI: stripe listen --forward-to localhost:${PORT}/api/payments/webhook`));
      }
    });
  } catch (err) {
    process.exit(1);
  }
})();

module.exports = app;