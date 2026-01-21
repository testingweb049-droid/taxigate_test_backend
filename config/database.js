const mongoose = require("mongoose");
const logger = require("../src/utils/logger");
const chalk = require("chalk");

let cachedConnection = null;

const connectDB = async () => {
  if (cachedConnection && mongoose.connection.readyState === 1) {
    return cachedConnection;
  }

  if (mongoose.connection.readyState === 2) {
    await new Promise((resolve, reject) => {
      mongoose.connection.once("connected", resolve);
      mongoose.connection.once("error", reject);
    });
    cachedConnection = mongoose.connection;
    return cachedConnection;
  }

  const options = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    bufferCommands: true,
    maxPoolSize: 50,
    minPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
    retryWrites: true,
    retryReads: true,
  };

  const connection = await mongoose.connect(process.env.MONGO_URI, options);
  cachedConnection = connection;
  
  logger.info(chalk.green("MongoDB connected successfully"));

  mongoose.connection.on("disconnected", () => {
    cachedConnection = null;
    logger.warn(chalk.yellow("MongoDB disconnected"));
  });

  mongoose.connection.on("error", (err) => {
    cachedConnection = null;
    logger.error(chalk.red("MongoDB connection error"));
  });

  return cachedConnection;
};

module.exports = connectDB;
