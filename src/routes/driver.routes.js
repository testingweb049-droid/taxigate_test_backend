const express = require("express");
const uploadDriverDocuments = require("../utils/driverDocumentsUpload");
const {
  registerDriver,
  verifyOtp,
  resendOtp,
  loginDriver,
  logoutDriver,
  refreshToken,
  uploadDriverDocuments: uploadDocs,
  setupProfile,
  setOnlineStatus,
  approveDriver,
  getAllDrivers,
  getDriverProfile,
  getDriverDocuments,
  getDriverVehicles,
  getOnlineStatus,
  getOnboardingStatus,
  registerFcmToken,
  removeFcmToken,
  updatePassword,
  forgotPassword,
  verifyPasswordResetOtp,
  resetPassword,
  deleteAccount,
  recoverAccount,
  getWalletBalance,
  getWalletTransactions,
  updateProfile,
  getDriverStats,
  getDriverCompleteDetails,
  deleteDriverAccount,
} = require("../controllers/driver.controller");
const { protect, restrictTo } = require("../middleware/auth.middleware");
const uploadProfilePicture = require("../utils/uploadAvatar");
const validateRequestSize = require("../middleware/validateRequestSize");

const router = express.Router();

const documentFields = [
  { name: "documentFrontImage", maxCount: 1 },
  { name: "documentBackImage", maxCount: 1 },
  { name: "driverLicenseFront", maxCount: 1 },
  { name: "driverLicenseBack", maxCount: 1 },
  { name: "driverPassFront", maxCount: 1 },
  { name: "driverPassBack", maxCount: 1 },
  { name: "kiwaPermit", maxCount: 1 },
  { name: "insurancePolicy", maxCount: 1 },
  { name: "bankpass", maxCount: 1 },
  { name: "kvkUittreksel", maxCount: 1 },
];

// ===== PUBLIC ROUTES =====
router.post("/signup", registerDriver);
router.post("/login", loginDriver);
router.post("/resend-otp", resendOtp);
router.post("/forgot-password", forgotPassword);
router.post("/verify-password-reset-otp", verifyPasswordResetOtp);
router.post("/reset-password", resetPassword);
router.post("/recover-account", recoverAccount);

// ===== REFRESH TOKEN ROUTE (No auth required, uses refresh token cookie) =====
router.post("/refresh-token", refreshToken);

// ===== PROTECTED DRIVER ROUTES =====
// OTP verification requires temporary auth (from signup) - but we'll protect it after OTP is verified
router.post("/verify-otp", verifyOtp);
router.post("/setup-profile", protect, restrictTo("driver"), uploadProfilePicture.single("profilePicture"), setupProfile);
router.post("/upload-documents", protect, restrictTo("driver"), validateRequestSize, uploadDriverDocuments.fields(documentFields), uploadDocs);
router.post("/logout", protect, restrictTo("driver"), logoutDriver);

router.get("/profile", protect, restrictTo("driver"), getDriverProfile);
router.patch("/profile", protect, restrictTo("driver"), uploadProfilePicture.single("profilePicture"), updateProfile);
router.get("/documents", protect, restrictTo("driver"), getDriverDocuments);
router.get("/vehicles", protect, restrictTo("driver"), getDriverVehicles);
router.get("/online-status", protect, restrictTo("driver"), getOnlineStatus);
router.post("/online-status", protect, restrictTo("driver"), setOnlineStatus);
router.get("/onboarding-status", protect, restrictTo("driver"), getOnboardingStatus);

// Push notification token management
router.post("/register-fcm-token", protect, restrictTo("driver"), registerFcmToken);
router.post("/remove-fcm-token", protect, restrictTo("driver"), removeFcmToken);

// Password management
router.post("/update-password", protect, restrictTo("driver"), updatePassword);

// Account management
router.post("/delete-account", protect, restrictTo("driver"), deleteAccount);

// Wallet management
router.get("/wallet/balance", protect, restrictTo("driver"), getWalletBalance);
router.get("/wallet/transactions", protect, restrictTo("driver"), getWalletTransactions);

// Driver stats
router.get("/stats", protect, restrictTo("driver"), getDriverStats);

// ===== ADMIN ROUTES =====
router.get("/all", protect, restrictTo("admin"), getAllDrivers);
router.get("/:driverId", protect, restrictTo("admin"), getDriverCompleteDetails);
router.post("/approve", protect, restrictTo("admin"), approveDriver);
router.delete("/:driverId", protect, restrictTo("admin"), deleteDriverAccount);

module.exports = router;
