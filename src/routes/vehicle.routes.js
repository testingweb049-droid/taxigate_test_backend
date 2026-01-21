const express = require("express");
const {
    addVehicle,
    getMyVehicles,
    getVehicleById,
    updateVehicle,
    deleteVehicle,
    getAllVehicles,
    getVehicleByIdAdmin,
    approveVehicle,
    rejectVehicle,
} = require("../controllers/vehicle.controller");
const uploadVehicleImage = require("../utils/vehicleImageUpload");
const { protect, restrictTo } = require("../middleware/auth.middleware");

const router = express.Router();

// ===== ADMIN ROUTES (must come before driver routes to avoid conflicts) =====
router.get("/admin/all", protect, restrictTo("admin"), getAllVehicles);
router.get("/admin/:vehicleId", protect, restrictTo("admin"), getVehicleByIdAdmin);
router.post("/admin/:vehicleId/approve", protect, restrictTo("admin"), approveVehicle);
router.post("/admin/:vehicleId/reject", protect, restrictTo("admin"), rejectVehicle);

// ===== PROTECTED DRIVER ROUTES =====
router.post("/", protect, restrictTo("driver"), uploadVehicleImage.single("image"), addVehicle);
router.get("/my-vehicles", protect, restrictTo("driver"), getMyVehicles);
router.get("/:vehicleId", protect, restrictTo("driver"), getVehicleById);
router.post("/:vehicleId", protect, restrictTo("driver"), uploadVehicleImage.single("image"), updateVehicle);
router.delete("/:vehicleId", protect, restrictTo("driver"), deleteVehicle);

module.exports = router;
