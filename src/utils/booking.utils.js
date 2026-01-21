const { errorResponse } = require("./response");

const handleNotification = async (notificationPromise) => {
  try {
    await Promise.race([
      notificationPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Notification timeout after 45 seconds")), 45000)
      )
    ]);
  } catch (err) {
    if (err.message === "Notification timeout after 45 seconds") {
    } else if (err.message && err.message.includes("Ably")) {
    } else {
      if (err.stack) {
      }
      if (!err.message || !err.message.includes("Ably")) {
        throw err;
      }
    }
  }
};

const toBookingResponse = (booking) => {
  if (!booking) return null;
  return {
    id: booking._id,
    orderNumber: booking.orderNumber, 
    from_location: booking.from_location,
    to_location: booking.to_location,
    luggage: booking.luggage,
    num_passengers: booking.num_passengers,
    date_time: booking.date_time,
    return_date_time: booking.return_date_time,
    cat_title: booking.cat_title,
    actualPrice: booking.actualPrice || booking.price, 
    price: booking.price, 
    user_name: booking.user_name,
    email: booking.email,
    number: booking.number,
    note_description: booking.note_description,
    pickup_house_no: booking.pickup_house_no,
    dropoff_house_no: booking.dropoff_house_no,
    stops: booking.stops && Array.isArray(booking.stops) ? booking.stops : [],
    stopsCoordinates: booking.stopsCoordinates && Array.isArray(booking.stopsCoordinates) ? booking.stopsCoordinates : [],
    flight_no: booking.flight_no,
    distance: booking.distance,
    commission: booking.commission,
    driverPrice: booking.driverPrice,
    driverId: booking.driverId,
    assignmentType: booking.assignmentType,
    status: booking.status,
    isAccepted: booking.isAccepted,
    isRejected: booking.isRejected,
    rejectionReason: booking.rejectionReason,
    startedAt: booking.startedAt,
    pickedUpAt: booking.pickedUpAt,
    droppedOffAt: booking.droppedOffAt,
    completedAt: booking.completedAt,
    pickupCoordinates: booking.pickupCoordinates || null, 
    dropoffCoordinates: booking.dropoffCoordinates || null, 
    isPaid: booking.isPaid,
    expiresAt: booking.expiresAt,
    expiredAt: booking.expiredAt,
    isExpired: booking.isExpired,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
};


const handleServiceError = (res, err) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal server error";
  return errorResponse(res, message, statusCode, err.meta ? [err.meta] : []);
};

module.exports = {
  handleNotification,
  toBookingResponse,
  handleServiceError,
};

