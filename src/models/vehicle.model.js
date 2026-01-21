const mongoose = require("mongoose");

const VehicleSchema = new mongoose.Schema({
    driver: { type: mongoose.Schema.Types.ObjectId, ref: "Driver", required: true, index: true },
    type: { 
        type: String, 
        enum: ["Standard", "Luxury", "Taxi Bus"], 
        required: true,
        trim: true 
    },
    brand: { type: String, trim: true, required: true },
    model: { type: String, trim: true, required: true },
    color: { type: String, trim: true, required: true },
    plateNumber: { type: String, trim: true, required: true, unique: true, index: true },
    image: { type: String, trim: true },
    status: { 
        type: String, 
        enum: ["Pending", "Approved", "Rejected"], 
        default: "Pending", 
        index: true 
    },
    addedAt: { type: Date, default: Date.now },
    deletedAt: { type: Date, index: true },
}, { timestamps: true, versionKey: false });

// Indexes
VehicleSchema.index({ driver: 1, status: 1 });
VehicleSchema.index({ status: 1 });
VehicleSchema.index({ createdAt: -1 });

module.exports = mongoose.models.Vehicle || mongoose.model("Vehicle", VehicleSchema);
