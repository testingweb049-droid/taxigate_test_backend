const { createLogger, format, transports } = require("winston");
const { combine, timestamp, printf, colorize, errors } = format;
const DailyRotateFile = require("winston-daily-rotate-file");
const path = require("path");

const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} ${level}: ${stack || message}`;
});

const loggerTransports = [
  new transports.Console(), // Always log to console
];

// Only add file rotation locally
if (process.env.NODE_ENV === "development") {
  loggerTransports.push(
    new DailyRotateFile({
      dirname: path.join("logs"), // Local logs folder
      filename: "app-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "14d",
    })
  );
}

const logger = createLogger({
  level: process.env.NODE_ENV === "development" ? "debug" : "info",
  format: combine(
    colorize(),
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    errors({ stack: true }),
    logFormat
  ),
  transports: loggerTransports,
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  process.exit(1);
});

module.exports = logger;
