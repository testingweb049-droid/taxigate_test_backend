// models/booking.model.js
const mongoose = require("mongoose");

const coordinatesSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
  },
  { _id: false }
);

const bookingSchema = new mongoose.Schema(
  {
    from_location: { type: String, required: true, index: true, trim: true },
    to_location: { type: String, required: true, index: true, trim: true },
    luggage: { type: String, trim: true },
    num_passengers: { type: Number, min: 1 },
    date_time: { type: Date, required: true, index: true },
    return_date_time: { type: Date },
    cat_title: { type: String, required: true, trim: true, index: true },
    actualPrice: { type: String, trim: true },
    price: { type: String, required: true, trim: true },
    user_name: { type: String, required: true, trim: true, index: true },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    number: { type: String, trim: true },
    note_description: { type: String, trim: true },
    pickup_house_no: { type: String, trim: true },
    dropoff_house_no: { type: String, trim: true },
    stops: [{ type: String, trim: true }],
    stopsCoordinates: [coordinatesSchema],
    flight_no: { type: String, trim: true, index: true },
    distance: { type: String, trim: true },
    commission: { type: String, default: "0", trim: true },
    driverPrice: { type: String, default: "0", trim: true },
    assignmentType: {
      type: String,
      enum: ["auto", "admin", null],
      default: null,
      index: true,
    },

    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      index: true,
      default: null,
    },

    status: {
      type: String,
      default: "pending",
      enum: [
        "pending",
        "accepted",
        "started",
        "picked_up",
        "dropped_off",
        "completed",
        "rejected",
        "cancelled",
      ],
      index: true,
    },

    isAccepted: { type: Boolean, default: false, index: true },
    isRejected: { type: Boolean, default: false, index: true },
    rejectionReason: { type: String, trim: true },

    startedAt: { type: Date },
    pickedUpAt: { type: Date },
    droppedOffAt: { type: Date },
    completedAt: { type: Date },

    pickupCoordinates: { type: coordinatesSchema },
    dropoffCoordinates: { type: coordinatesSchema },

    isPaid: { type: Boolean, default: false, index: true },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      index: true,
      default: null,
    },

    expiresAt: { type: Date, index: true },
    expiredAt: { type: Date },
    isExpired: { type: Boolean, default: false, index: true },

    orderNumber: {
      type: String,
      unique: true,
      index: true,
      trim: true,
      sparse: true,
    },

    notificationsSentAt: {
      type: Date,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: "__v",
    optimisticConcurrency: true,
  }
);


bookingSchema.index({ from_location: 1, to_location: 1, date_time: 1 });
bookingSchema.index({ driverId: 1, status: 1 });
bookingSchema.index({ driverId: 1, status: 1, date_time: -1 });
bookingSchema.index({ email: 1, date_time: -1 });
bookingSchema.index({ status: 1, isPaid: 1 });
bookingSchema.index({ assignmentType: 1, status: 1 });
bookingSchema.index({ paymentId: 1 });
bookingSchema.index({ date_time: -1 });
bookingSchema.index({ createdAt: -1 });
bookingSchema.index({ status: 1, assignmentType: 1, isExpired: 1, expiresAt: 1 });

bookingSchema.index({
  from_location: "text",
  to_location: "text",
  user_name: "text",
  email: "text",
  cat_title: "text",
  flight_no: "text",
  orderNumber: "text",
});

module.exports =
  mongoose.models.Booking || mongoose.model("Bookings", bookingSchema);
