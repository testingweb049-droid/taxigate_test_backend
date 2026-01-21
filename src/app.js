require("dotenv").config();
const express = require("express");
const morgan = require("morgan");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoSanitize = require("express-mongo-sanitize");
const xss = require("xss-clean");
const hpp = require("hpp");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const path = require("path");
const dbConnectMiddleware = require("./middleware/dbConnect");

const mongoose = require("mongoose");
const AppError = require("./utils/appError");
const errorHandler = require("./middleware/error");
const { verifyAblyConnection } = require("../config/ably");

const authRoutes = require("./routes/admin.routes");
const driverRoutes = require("./routes/driver.routes");
const vehicleRoutes = require("./routes/vehicle.routes");
const bookingRoutes = require("./routes/booking.routes");
const notificationRoutes = require("./routes/notification.routes");
const paymentRoutes = require("./routes/payment.routes");

const app = express();

// CORS
app.use(cors());
app.options("*", cors());

// Security
app.use(helmet());

// Logging
if (process.env.NODE_ENV === "development") app.use(morgan("dev"));

// Rate limiting
const API_RATE_LIMIT = parseInt(process.env.API_RATE_LIMIT) || 1000;
app.use(
  "/api",
  rateLimit({
    max: API_RATE_LIMIT,
    windowMs: 60 * 60 * 1000,
    message: "Too many requests from this IP, try again in an hour",
  })
);

// Body parser
// IMPORTANT: Payment webhook needs raw body for signature verification
// Apply raw body parser FIRST for webhook route only (before any JSON parsing)
// Use a function to check the path and apply raw parser
const isWebhookPath = (req) => {
  const url = req.originalUrl || req.url || "";
  const path = req.path || "";
  const baseUrl = req.baseUrl || "";
  
  // Check multiple possible URL formats for Vercel compatibility
  return url === "/api/payments/webhook" || 
         url.includes("/api/payments/webhook") ||
         (path === "/webhook" && baseUrl === "/api/payments") ||
         (path === "/webhook" && url.includes("/api/payments/webhook")) ||
         url.endsWith("/api/payments/webhook");
};

// Apply raw body parser FIRST for webhook route
// This MUST be the very first middleware to capture raw body
app.use((req, res, next) => {
  if (isWebhookPath(req)) {
    // Log webhook request for debugging
    console.log("[WEBHOOK] Incoming webhook request:", {
      method: req.method,
      url: req.url,
      originalUrl: req.originalUrl,
      path: req.path,
      baseUrl: req.baseUrl,
      contentType: req.headers["content-type"],
      bodyAlreadyExists: !!req.body,
      bodyType: req.body ? typeof req.body : 'none',
      bodyIsBuffer: req.body ? Buffer.isBuffer(req.body) : false
    });
    
    // Check if body is already a Buffer (can happen on Vercel)
    if (req.body && Buffer.isBuffer(req.body)) {
      console.log("[WEBHOOK] Body already exists as Buffer, using it directly");
      req.rawBody = req.body;
      return next();
    }
    
    // On Vercel, we need to capture the raw body stream
    // Use express.raw with verify option to ensure we get the exact bytes
    const rawParser = express.raw({ 
      type: "application/json", 
      limit: "10mb",
      verify: (req, res, buf, encoding) => {
        // Store the raw buffer - this is the exact bytes from Stripe
        req.rawBody = buf;
        console.log("[WEBHOOK] Raw body captured via verify callback:", {
          isBuffer: Buffer.isBuffer(buf),
          length: buf.length,
          encoding: encoding
        });
      }
    });
    
    rawParser(req, res, (err) => {
      if (err) {
        console.error("[MIDDLEWARE] Raw body parser error:", err);
        return next(err);
      }
      // Ensure rawBody is set (should be set by verify callback)
      if (!req.rawBody && req.body && Buffer.isBuffer(req.body)) {
        console.log("[WEBHOOK] Setting rawBody from req.body (Buffer)");
        req.rawBody = req.body;
      } else if (!req.rawBody) {
        console.error("[WEBHOOK] WARNING: rawBody not set after parsing!");
      }
      next();
    });
  } else {
    next();
  }
});

// Apply JSON parser to all routes except payment webhook
app.use((req, res, next) => {
  if (isWebhookPath(req)) {
    // Skip JSON parsing for webhook - preserve raw body
    // DO NOT parse JSON for webhook - it will corrupt signature verification
    // Keep body as raw Buffer for signature verification
    if (req.rawBody && Buffer.isBuffer(req.rawBody)) {
      req.body = req.rawBody; // Keep as Buffer
    }
    return next();
  }
  express.json({ limit: "10kb" })(req, res, next);
});

// Apply URL encoded parser to all routes except payment webhook
app.use((req, res, next) => {
  if (isWebhookPath(req)) {
    // Skip URL encoding for webhook - preserve raw body
    // DO NOT parse URL encoded for webhook - it will corrupt signature verification
    // Keep body as raw Buffer for signature verification
    if (req.rawBody && Buffer.isBuffer(req.rawBody)) {
      req.body = req.rawBody; // Keep as Buffer
    }
    return next();
  }
  express.urlencoded({ extended: true, limit: "10kb" })(req, res, next);
});

app.use(cookieParser());

// Sanitization
app.use(mongoSanitize());
app.use(xss());

app.use(
  hpp({
    whitelist: [
      "duration",
      "ratingsQuantity",
      "ratingsAverage",
      "maxGroupSize",
      "difficulty",
      "price",
    ],
  })
);

// Compression
app.use(compression());

// Ensure DB connection before any request
app.use(dbConnectMiddleware);

// Routes
app.get("/", (req, res) => res.send("Hello world"));
app.use("/auth", authRoutes);
app.use("/api/drivers", driverRoutes);
app.use("/api/vehicle", vehicleRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/payments", paymentRoutes);

// Health check
// PHASE 2: Enhanced health check with detailed Ably status
app.get("/api/health", async (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? "connected" : "disconnected";
  
  // PHASE 2: Enhanced Ably status check with detailed information
  let ablyStatus = "unknown";
  let ablyDetails = {};
  try {
    const ablyWorking = await verifyAblyConnection();
    ablyStatus = ablyWorking ? "connected" : "disconnected";
    
    // PHASE 2: Add detailed Ably information for debugging
    const hasApiKey = !!process.env.ABLY_API_KEY;
    const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    
    ablyDetails = {
      hasApiKey,
      isServerless,
      environment: process.env.VERCEL ? "vercel" : process.env.AWS_LAMBDA_FUNCTION_NAME ? "aws-lambda" : "local",
      status: ablyStatus,
    };
    
    if (!hasApiKey) {
      ablyDetails.error = "ABLY_API_KEY environment variable is not set";
      ablyDetails.help = "Please set ABLY_API_KEY in Vercel project settings -> Environment Variables";
    }
  } catch (error) {
    ablyStatus = "error";
    ablyDetails = {
      error: error?.message || "Unknown error",
      hasApiKey: !!process.env.ABLY_API_KEY,
    };
  }
  
  res.json({
    status: "success",
    database: dbStatus,
    ably: ablyStatus,
    ablyDetails, // PHASE 2: Include detailed Ably information
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Handle unknown routes
app.all("*", (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl}`, 404));
});

// Global error handler
app.use(errorHandler);

module.exports = app;
