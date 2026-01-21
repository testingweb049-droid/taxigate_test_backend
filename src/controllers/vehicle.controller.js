const Vehicle = require("../models/vehicle.model");
const Driver = require("../models/driver.model");
const { errorResponse, successResponse } = require("../utils/response");
const catchAsync = require("../utils/catchAsync");
const sendEmail = require("../utils/email");
const { notifyVehicleUploaded } = require("../services/driverNotifications");

// ===== DRIVER: ADD VEHICLE =====
exports.addVehicle = catchAsync(async (req, res) => {
    const { type, brand, model, color, plateNumber } = req.body;
    
    // Individual field validation
    if (!type) return errorResponse(res, "Vehicle type is required.", 400);
    const validTypes = ["Standard", "Luxury", "Taxi Bus"];
    if (!validTypes.includes(type)) {
        return errorResponse(res, `Vehicle type must be one of: ${validTypes.join(", ")}.`, 400);
    }
    if (!brand) return errorResponse(res, "Vehicle brand is required.", 400);
    if (!model) return errorResponse(res, "Vehicle model is required.", 400);
    if (!color) return errorResponse(res, "Vehicle color is required.", 400);
    if (!plateNumber) return errorResponse(res, "Plate number is required.", 400);

    // Find driver
    const driver = await Driver.findById(req.user.id);
    if (!driver) return errorResponse(res, "Driver not found.", 404);

    // Verification check
    if (!driver.isVerified) {
        return errorResponse(res, "Please verify your account first to add vehicle.", 403);
    }

    // Check vehicle limit - driver can have up to 3 vehicles (exclude soft-deleted)
    const vehicleCount = await Vehicle.countDocuments({ 
        driver: req.user.id,
        deletedAt: null 
    });
    if (vehicleCount >= 3) {
        return errorResponse(res, "A driver can only have up to 3 vehicles. Please delete an existing vehicle before adding a new one.", 400);
    }

    // Check if driver already has a vehicle with the same type (exclude soft-deleted)
    const existingVehicleType = await Vehicle.findOne({ 
        driver: req.user.id, 
        type: type,
        deletedAt: null
    });
    if (existingVehicleType) {
        return errorResponse(res, `You already have a ${type} vehicle. Each driver can have only one vehicle of each type (Standard, Luxury, Taxi Bus).`, 400);
    }

    // Check duplicate plate number
    const existingPlate = await Vehicle.findOne({ plateNumber });
    if (existingPlate) {
        return errorResponse(res, "Vehicle with this plate number already exists.", 400);
    }

    const vehicleData = {
        driver: req.user.id,
        type,
        brand,
        model,
        color,
        plateNumber,
        status: "Pending",
    };

    // If image is uploaded
    if (req.file?.path) {
        vehicleData.image = req.file.path;
    }

    const vehicle = await Vehicle.create(vehicleData);

    // Populate driver for notification
    const vehicleWithDriver = await Vehicle.findById(vehicle._id)
        .populate("driver", "email firstName lastName phone")
        .lean();

    // Notify admin about vehicle upload
    try {
        await notifyVehicleUploaded(vehicleWithDriver, vehicleWithDriver.driver);
    } catch (notificationError) {
        // Log error but don't fail vehicle creation
    }

    const safeVehicle = {
        id: vehicle._id,
        driver: vehicle.driver,
        type: vehicle.type,
        brand: vehicle.brand,
        model: vehicle.model,
        color: vehicle.color,
        plateNumber: vehicle.plateNumber,
        image: vehicle.image,
        status: vehicle.status,
        createdAt: vehicle.createdAt,
    };

    return successResponse(
        res,
        { vehicle: safeVehicle },
        "Vehicle added successfully. Your request is pending admin approval. You will receive an email notification once approved.",
        201
    );
});

// ===== DRIVER: GET MY VEHICLES =====
exports.getMyVehicles = catchAsync(async (req, res) => {
    const vehicles = await Vehicle.find({ 
        driver: req.user.id,
        deletedAt: null // Exclude soft-deleted vehicles
    })
        .select("type brand model color plateNumber image status createdAt")
        .lean()
        .sort({ createdAt: -1 });

    const safeVehicles = vehicles.map(vehicle => ({
        id: vehicle._id,
        driver: vehicle.driver,
        type: vehicle.type,
        brand: vehicle.brand,
        model: vehicle.model,
        color: vehicle.color,
        plateNumber: vehicle.plateNumber,
        image: vehicle.image,
        status: vehicle.status,
        createdAt: vehicle.createdAt,
    }));

    return successResponse(res, { vehicles: safeVehicles }, "Vehicles fetched successfully.", 200);
});

// ===== DRIVER: GET SINGLE VEHICLE =====
exports.getVehicleById = catchAsync(async (req, res) => {
    const { vehicleId } = req.params;

    const vehicle = await Vehicle.findOne({ 
        _id: vehicleId, 
        driver: req.user.id 
    })
    .select("type brand model color plateNumber image status createdAt")
    .lean();

    if (!vehicle) {
        return errorResponse(res, "Vehicle not found or you don't have access to this vehicle.", 404);
    }

    const safeVehicle = {
        id: vehicle._id,
        driver: vehicle.driver,
        type: vehicle.type,
        brand: vehicle.brand,
        model: vehicle.model,
        color: vehicle.color,
        plateNumber: vehicle.plateNumber,
        image: vehicle.image,
        status: vehicle.status,
        createdAt: vehicle.createdAt,
    };

    return successResponse(res, { vehicle: safeVehicle }, "Vehicle fetched successfully.", 200);
});

// ===== DRIVER: UPDATE VEHICLE =====
exports.updateVehicle = catchAsync(async (req, res) => {
    const { vehicleId } = req.params;
    const { type, brand, model, color, plateNumber } = req.body;

    // Find vehicle and verify ownership (exclude soft-deleted)
    const vehicle = await Vehicle.findOne({ 
        _id: vehicleId, 
        driver: req.user.id,
        deletedAt: null
    });

    if (!vehicle) {
        return errorResponse(res, "Vehicle not found or you don't have access to this vehicle.", 404);
    }
    // Check duplicate plate number if plateNumber is being updated
    if (plateNumber && plateNumber !== vehicle.plateNumber) {
        const existingPlate = await Vehicle.findOne({ 
            plateNumber, 
            _id: { $ne: vehicleId } 
        });
        if (existingPlate) {
            return errorResponse(res, "Vehicle with this plate number already exists.", 400);
        }
    }

    const updates = {};
    if (type) {
        const validTypes = ["Standard", "Luxury", "Taxi Bus"];
        if (!validTypes.includes(type)) {
            return errorResponse(res, `Vehicle type must be one of: ${validTypes.join(", ")}.`, 400);
        }
        updates.type = type;
    }
    if (brand) updates.brand = brand;
    if (model) updates.model = model;
    if (color) updates.color = color;
    if (plateNumber) updates.plateNumber = plateNumber;
    if (req.file?.path) updates.image = req.file.path;

    const updatedVehicle = await Vehicle.findByIdAndUpdate(
        vehicleId,
        updates,
        { new: true, runValidators: true }
    );

    const safeVehicle = {
        id: updatedVehicle._id,
        driver: updatedVehicle.driver,
        type: updatedVehicle.type,
        brand: updatedVehicle.brand,
        model: updatedVehicle.model,
        color: updatedVehicle.color,
        plateNumber: updatedVehicle.plateNumber,
        image: updatedVehicle.image,
        status: updatedVehicle.status,
        createdAt: updatedVehicle.createdAt,
    };

    return successResponse(res, { vehicle: safeVehicle }, "Vehicle updated successfully. Status reset to pending for admin review.", 200);
});

// ===== DRIVER: DELETE VEHICLE =====
exports.deleteVehicle = catchAsync(async (req, res) => {
    const { vehicleId } = req.params;

    // Find and delete vehicle in one operation (optimized)
    const vehicle = await Vehicle.findOneAndDelete({ 
        _id: vehicleId, 
        driver: req.user.id 
    });

    if (!vehicle) {
        return errorResponse(res, "Vehicle not found or you don't have access to this vehicle.", 404);
    }

    return successResponse(res, {}, "Vehicle deleted successfully.", 200);
});

// ===== ADMIN: GET ALL VEHICLES =====
exports.getAllVehicles = catchAsync(async (req, res) => {
    const { status, driverId, page = 1, limit = 10 } = req.query;
    
    const query = { deletedAt: null }; // Exclude soft-deleted vehicles
    if (status) query.status = status;
    if (driverId) query.driver = driverId;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Use parallel queries for better performance
    const [vehicles, total] = await Promise.all([
        Vehicle.find(query)
            .populate("driver", "firstName lastName email phone")
            .select("type brand model color plateNumber image status createdAt driver")
            .lean()
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit)),
        Vehicle.countDocuments(query)
    ]);

    const safeVehicles = vehicles.map(vehicle => ({
        id: vehicle._id,
        driver: {
            id: vehicle.driver._id,
            firstName: vehicle.driver.firstName,
            lastName: vehicle.driver.lastName,
            email: vehicle.driver.email,
            phone: vehicle.driver.phone,
        },
        type: vehicle.type,
        brand: vehicle.brand,
        model: vehicle.model,
        color: vehicle.color,
        plateNumber: vehicle.plateNumber,
        image: vehicle.image,
        status: vehicle.status,
        createdAt: vehicle.createdAt,
    }));

    return successResponse(
        res,
        { 
            vehicles: safeVehicles,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / parseInt(limit)),
                totalVehicles: total,
                limit: parseInt(limit)
            }
        },
        "Vehicles fetched successfully.",
        200
    );
});

// ===== ADMIN: GET VEHICLE BY ID =====
exports.getVehicleByIdAdmin = catchAsync(async (req, res) => {
    const { vehicleId } = req.params;

    const vehicle = await Vehicle.findOne({
        _id: vehicleId,
        deletedAt: null // Exclude soft-deleted vehicles
    })
        .populate("driver", "firstName lastName email phone");

    if (!vehicle) {
        return errorResponse(res, "Vehicle not found.", 404);
    }

    const safeVehicle = {
        id: vehicle._id,
        driver: {
            id: vehicle.driver._id,
            firstName: vehicle.driver.firstName,
            lastName: vehicle.driver.lastName,
            email: vehicle.driver.email,
            phone: vehicle.driver.phone,
        },
        type: vehicle.type,
        brand: vehicle.brand,
        model: vehicle.model,
        color: vehicle.color,
        plateNumber: vehicle.plateNumber,
        image: vehicle.image,
        status: vehicle.status,
        createdAt: vehicle.createdAt,
    };

    return successResponse(res, { vehicle: safeVehicle }, "Vehicle fetched successfully.", 200);
});

// ===== ADMIN: APPROVE VEHICLE =====
exports.approveVehicle = catchAsync(async (req, res) => {
    const { vehicleId } = req.params;

    const vehicle = await Vehicle.findOne({
        _id: vehicleId,
        deletedAt: null // Only approve non-deleted vehicles
    })
        .populate("driver", "email firstName lastName");

    if (!vehicle) {
        return errorResponse(res, "Vehicle not found.", 404);
    }

    if (vehicle.status === "Approved") {
        return errorResponse(res, "Vehicle is already approved.", 400);
    }

    vehicle.status = "Approved";
    await vehicle.save();

    // Send email notification to driver
    try {
      await sendEmail({
        email: vehicle.driver.email,
        subject: "Taxigate - Vehicle Approved",
        message: `Hi ${vehicle.driver.firstName || "Driver"}, your vehicle (${vehicle.brand} ${vehicle.model}, Plate: ${vehicle.plateNumber}) has been approved. You can now accept bookings.`,
      });
    } catch (err) {
      // Email notification failed, but don't fail the request
    }

    const safeVehicle = {
        id: vehicle._id,
        driver: {
            id: vehicle.driver._id,
            firstName: vehicle.driver.firstName,
            lastName: vehicle.driver.lastName,
            email: vehicle.driver.email,
        },
        type: vehicle.type,
        brand: vehicle.brand,
        model: vehicle.model,
        color: vehicle.color,
        plateNumber: vehicle.plateNumber,
        image: vehicle.image,
        status: vehicle.status,
        createdAt: vehicle.createdAt,
    };

    return successResponse(res, { vehicle: safeVehicle }, "Vehicle approved successfully.", 200);
});

// ===== ADMIN: REJECT VEHICLE =====
exports.rejectVehicle = catchAsync(async (req, res) => {
    const { vehicleId } = req.params;
    const { reason } = req.body;

    const vehicle = await Vehicle.findOne({
        _id: vehicleId,
        deletedAt: null // Only approve non-deleted vehicles
    })
        .populate("driver", "email firstName lastName");

    if (!vehicle) {
        return errorResponse(res, "Vehicle not found.", 404);
    }

    if (vehicle.status === "Rejected") {
        return errorResponse(res, "Vehicle is already rejected.", 400);
    }

    vehicle.status = "Rejected";
    await vehicle.save();

    // Send email notification to driver with rejection reason
    try {
      await sendEmail({
        email: vehicle.driver.email,
        subject: "Taxigate - Vehicle Rejected",
        message: `Hi ${vehicle.driver.firstName || "Driver"}, your vehicle (${vehicle.brand} ${vehicle.model}, Plate: ${vehicle.plateNumber}) has been rejected.${reason ? ` Reason: ${reason}` : ' Please contact support for more information.'} Please note: You need at least one approved vehicle to accept bookings.`,
      });
    } catch (err) {
      // Email notification failed, but don't fail the request
    }

    const safeVehicle = {
        id: vehicle._id,
        driver: {
            id: vehicle.driver._id,
            firstName: vehicle.driver.firstName,
            lastName: vehicle.driver.lastName,
            email: vehicle.driver.email,
        },
        type: vehicle.type,
        brand: vehicle.brand,
        model: vehicle.model,
        color: vehicle.color,
        plateNumber: vehicle.plateNumber,
        image: vehicle.image,
        status: vehicle.status,
        createdAt: vehicle.createdAt,
    };

    return successResponse(res, { vehicle: safeVehicle }, "Vehicle rejected successfully.", 200);
});
