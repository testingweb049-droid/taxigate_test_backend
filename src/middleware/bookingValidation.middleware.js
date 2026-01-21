const { errorResponse } = require("../utils/response");
const { parseDistanceToNumber } = require("../utils/booking.helper");

const validateRequired = (body, fields) => {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === "");
  return missing;
};

exports.validateCreateBooking = (req, res, next) => {
  const required = [
    "from_location",
    "to_location",
    "date_time",
    "cat_title",
    "price",
    "user_name",
    "email",
    "distance",
  ];

  const missing = validateRequired(req.body, required);
  if (missing.length) {
    return errorResponse(
      res,
      `Missing required fields: ${missing.join(", ")}`,
      400
    );
  }

  const distanceNumber = parseDistanceToNumber(req.body.distance);
  if (Number.isNaN(distanceNumber) || distanceNumber < 0) {
    return errorResponse(res, "Invalid distance value.", 400);
  }

  return next();
};

exports.validateAssignDriver = (req, res, next) => {
  const { driverId } = req.body;
  if (!driverId) {
    return errorResponse(res, "Driver ID is required.", 400);
  }
  return next();
};

exports.validateDriverAction = (req, res, next) => {
  const { bookingId } = req.params;
  if (!bookingId) {
    return errorResponse(res, "Booking ID is required.", 400);
  }
  return next();
};

exports.validateRejectBooking = (req, res, next) => {
  const { bookingId } = req.params;
  if (!bookingId) {
    return errorResponse(res, "Booking ID is required.", 400);
  }
  // reason is optional but should be string when present
  if (req.body.reason !== undefined && typeof req.body.reason !== "string") {
    return errorResponse(res, "Rejection reason must be a string.", 400);
  }
  return next();
};


