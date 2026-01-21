// src/services/pushNotification.js
const admin = require("firebase-admin");
const Driver = require("../models/driver.model");
const logger = require("../utils/logger");
const chalk = require("chalk");

// Initialize Firebase Admin SDK
let firebaseInitialized = false;

const initializeFirebase = () => {
    if (firebaseInitialized) return;

    try {
        // Check if Firebase credentials are provided
        if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL) {
            return;
        }

        // Check if Firebase app already exists
        try {
            admin.app();
            firebaseInitialized = true;
            logger.info(chalk.magenta("Firebase Admin SDK already initialized"));
            return;
        } catch (e) {
            // App doesn't exist, continue with initialization
        }

        // Initialize Firebase Admin
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            }),
        });

        firebaseInitialized = true;
        logger.info(chalk.magenta("Firebase Admin SDK initialized successfully"));
    } catch (error) {
        if (error.stack) {
        }
    }
};

// Initialize on module load
initializeFirebase();

/**
 * Send push notification to a single device
 * @param {string} deviceToken - FCM device token
 * @param {Object} notification - Notification payload
 * @param {Object} data - Additional data payload
 * @returns {Promise<boolean>}
 */
const sendToDevice = async (deviceToken, notification, data = {}) => {
    
    if (!firebaseInitialized) {
        return false;
    }

    try {
        const message = {
            token: deviceToken,
            notification: {
                title: notification.title || "Taxigate",
                body: notification.body || "You have a new notification",
                imageUrl: notification.imageUrl || undefined,
            },
            data: {
                ...data,
                // Convert all data values to strings (FCM requirement)
                // Arrays are JSON stringified so they can be parsed back to arrays
                ...Object.keys(data).reduce((acc, key) => {
                    const value = data[key];
                    if (Array.isArray(value)) {
                        // Stringify arrays so they can be parsed back to arrays
                        acc[key] = JSON.stringify(value);
                    } else if (value === null || value === undefined) {
                        acc[key] = "";
                    } else {
                        acc[key] = String(value);
                    }
                    return acc;
                }, {}),
            },
            // Android-specific configuration
            android: {
                priority: "high",
                ttl: 3600000,
                collapseKey: "booking_notification",
                notification: {
                    title: notification.title || "Taxigate",
                    body: notification.body || "You have a new notification",
                    icon: "ic_notification",
                    color: "#FF6B35",
                    sound: "default",
                    tag: "booking",
                    channelId: "booking_notifications",
                    priority: "high",
                    visibility: "public",
                    notificationCount: 1,
                    lightSettings: {
                        color: "#FF6B35", // Hex color format (orange/red theme color) - must be #RRGGBB or #RRGGBBAA
                        lightOnDurationMillis: 500, // Duration in milliseconds (number, not string)
                        lightOffDurationMillis: 500, // Duration in milliseconds (number, not string)
                    },
                    clickAction: "FLUTTER_NOTIFICATION_CLICK",
                    imageUrl: notification.imageUrl || undefined,
                },
                fcmOptions: {
                    analyticsLabel: "booking_notification",
                },
            },
            // iOS (APNs) specific configuration
            apns: {
                headers: {
                    "apns-priority": "10",
                    "apns-push-type": "alert",
                },
                payload: {
                    aps: {
                        alert: {
                            title: notification.title || "Taxigate",
                            body: notification.body || "You have a new notification",
                            subtitle: notification.subtitle || undefined,
                        },
                        sound: {
                            critical: false,
                            name: "default",
                            volume: 1.0,
                        },
                        badge: notification.badge || 1,
                        contentAvailable: true,
                        mutableContent: true,
                        category: "BOOKING_CATEGORY",
                        threadId: "booking_thread",
                        interruptionLevel: "active",
                        relevanceScore: 1.0,
                    },
                    // Arrays are JSON stringified so they can be parsed back to arrays
                    ...Object.keys(data).reduce((acc, key) => {
                        const value = data[key];
                        if (Array.isArray(value)) {
                            // Stringify arrays so they can be parsed back to arrays
                            acc[key] = JSON.stringify(value);
                        } else if (value === null || value === undefined) {
                            acc[key] = "";
                        } else {
                            acc[key] = String(value);
                        }
                        return acc;
                    }, {}),
                },
                fcmOptions: {
                    analyticsLabel: "booking_notification_ios",
                    imageUrl: notification.imageUrl || undefined,
                },
            },
            // Web push configuration
            webpush: {
                notification: {
                    title: notification.title || "Taxigate",
                    body: notification.body || "You have a new notification",
                    icon: "/icon-192x192.png",
                    badge: "/badge-72x72.png",
                    image: notification.imageUrl || undefined,
                    vibrate: [200, 100, 200],
                    requireInteraction: false,
                    silent: false,
                    tag: "booking",
                    renotify: true,
                    data: {
                        ...data,
                    },
                },
                fcmOptions: {
                    link: notification.link || undefined,
                    analyticsLabel: "booking_notification_web",
                },
            },
            fcmOptions: {
                analyticsLabel: "booking_notification",
            },
        };

        const response = await admin.messaging().send(message);
        return true;
    } catch (error) {
        
        // If token is invalid, remove it from database
        if (error.code === "messaging/invalid-registration-token" || 
            error.code === "messaging/registration-token-not-registered") {
            await removeInvalidToken(deviceToken);
        }
        
        return false;
    }
};

/**
 * Send push notification to multiple devices
 * @param {Array<string>} deviceTokens - Array of FCM device tokens
 * @param {Object} notification - Notification payload
 * @param {Object} data - Additional data payload
 * @returns {Promise<Object>} - Results with success and failure counts
 */
const sendToMultipleDevices = async (deviceTokens, notification, data = {}) => {
    
    
    // Ensure Firebase is initialized
    if (!firebaseInitialized) {
        initializeFirebase();
        
        // Wait a bit for initialization
        await new Promise(resolve => setTimeout(resolve, 100));
        
        if (!firebaseInitialized) {
            return { success: 0, failed: deviceTokens?.length || 0 };
        }
    }
    
    if (!deviceTokens || deviceTokens.length === 0) {
        return { success: 0, failed: 0 };
    }

    try {
        // Check Firebase initialization
        if (!firebaseInitialized) {
            return { success: 0, failed: deviceTokens.length };
        }
        
        
        // IMPORTANT: For notifications to work when app is CLOSED:
        // 1. Must have both 'notification' and 'data' fields (we have both)
        // 2. Android priority must be "high" (we have it)
        // 3. Flutter app MUST have background message handler configured
        // 4. Flutter app MUST request notification permissions
        // 5. Android notification channel MUST exist in Flutter app with high importance
        // 
        // If notifications only work when app is OPEN, the issue is in Flutter app configuration,
        // not the backend. The backend payload is correct for background notifications.
        // Convert all data values to strings (FCM requirement)
        // Arrays are JSON stringified so they can be parsed back to arrays
        const convertedData = {
            ...data,
            ...Object.keys(data).reduce((acc, key) => {
                const value = data[key];
                if (Array.isArray(value)) {
                    // Stringify arrays so they can be parsed back to arrays
                    acc[key] = JSON.stringify(value);
                } else if (value === null || value === undefined) {
                    acc[key] = "";
                } else {
                    acc[key] = String(value);
                }
                return acc;
            }, {}),
            // Add notification title and body to data for app to use
            notification_title: String(notification.title || "Taxigate"),
            notification_body: String(notification.body || "You have a new notification"),
        };
        
        const message = {
            // Notification payload - displayed by system when app is closed
            // This is REQUIRED for notifications to show in system tray when app is closed
            notification: {
                title: notification.title || "Taxigate",
                body: notification.body || "You have a new notification",
                imageUrl: notification.imageUrl || undefined, // Optional image URL
            },
            // Data payload - received by app when opened
            data: convertedData,
            // Android-specific configuration
            android: {
                priority: "high", // high or normal - high for important notifications (required for background)
                ttl: 3600000, // Time to live: 1 hour in milliseconds
                collapseKey: "booking_notification", // Collapse key for grouping notifications
                // Direct boot support (for Android 7.0+)
                directBootOk: true,
                notification: {
                    title: notification.title || "Taxigate",
                    body: notification.body || "You have a new notification",
                    icon: "ic_notification", // Default icon name (should exist in app)
                    color: "#FF6B35", // Notification color (hex format)
                    sound: "default", // Sound file name or "default"
                    tag: "booking", // Tag for replacing notifications
                    channelId: "booking_notifications", // Android notification channel ID (MUST exist in app)
                    priority: "high", // high, default, low, min, max - high ensures notification shows when app closed
                    visibility: "public", // public, private, secret
                    notificationCount: 1, // Badge count
                    // Light settings (LED) - color must be hex string #RRGGBB or #RRGGBBAA
                    lightSettings: {
                        color: "#FF6B35", // Hex color format (orange/red theme color)
                        lightOnDurationMillis: 500, // Duration in milliseconds (number, not string)
                        lightOffDurationMillis: 500, // Duration in milliseconds (number, not string)
                    },
                    // Click action - opens app when notification is tapped
                    clickAction: "FLUTTER_NOTIFICATION_CLICK", // Intent action (MUST match Flutter app)
                    // Localization
                    titleLocKey: undefined, // Localization key for title
                    bodyLocKey: undefined, // Localization key for body
                    titleLocArgs: undefined, // Arguments for title localization
                    bodyLocArgs: undefined, // Arguments for body localization
                    // Image URL
                    imageUrl: notification.imageUrl || undefined,
                },
                // FCM options
                fcmOptions: {
                    analyticsLabel: "booking_notification",
                },
            },
            // iOS (APNs) specific configuration
            apns: {
                headers: {
                    "apns-priority": "10", // 10 = immediate delivery (required for background notifications)
                    "apns-push-type": "alert", // alert = show notification, background = silent update
                },
                payload: {
                    aps: {
                        // Alert is required for notification to show when app is closed
                        alert: {
                            title: notification.title || "Taxigate",
                            body: notification.body || "You have a new notification",
                            subtitle: notification.subtitle || undefined,
                            launchImage: undefined,
                        },
                        sound: {
                            critical: false, // Critical sound flag
                            name: "default", // Sound file name or "default"
                            volume: 1.0, // Volume (0.0 to 1.0)
                        },
                        badge: notification.badge || 1, // Badge count
                        // contentAvailable: true allows background processing, but we want alert to show
                        contentAvailable: false, // Set to false when we want notification to show
                        mutableContent: true, // Allow notification modification
                        category: "BOOKING_CATEGORY", // Notification category (MUST match app configuration)
                        threadId: "booking_thread", // Thread identifier for grouping
                        // Interruption level (iOS 15+) - active ensures notification shows
                        interruptionLevel: "active", // passive, active, timeSensitive, critical
                        // Relevance score (0.0 to 1.0) - higher = more important
                        relevanceScore: 1.0,
                    },
                    // Custom data for iOS
                    // Arrays are JSON stringified so they can be parsed back to arrays
                    ...Object.keys(data).reduce((acc, key) => {
                        const value = data[key];
                        if (Array.isArray(value)) {
                            // Stringify arrays so they can be parsed back to arrays
                            acc[key] = JSON.stringify(value);
                        } else if (value === null || value === undefined) {
                            acc[key] = "";
                        } else {
                            acc[key] = String(value);
                        }
                        return acc;
                    }, {}),
                },
                // FCM options for iOS
                fcmOptions: {
                    analyticsLabel: "booking_notification_ios",
                    imageUrl: notification.imageUrl || undefined,
                },
            },
            // Web push configuration
            webpush: {
                notification: {
                    title: notification.title || "Taxigate",
                    body: notification.body || "You have a new notification",
                    icon: "/icon-192x192.png", // Icon URL
                    badge: "/badge-72x72.png", // Badge URL
                    image: notification.imageUrl || undefined,
                    vibrate: [200, 100, 200], // Vibration pattern
                    requireInteraction: false, // Require user interaction
                    silent: false, // Silent notification
                    tag: "booking", // Tag for replacing notifications
                    renotify: true, // Renotify if tag exists
                    data: {
                        ...data,
                    },
                    actions: [
                        {
                            action: "view",
                            title: "View",
                            icon: "/view-icon.png",
                        },
                        {
                            action: "dismiss",
                            title: "Dismiss",
                            icon: "/dismiss-icon.png",
                        },
                    ],
                },
                fcmOptions: {
                    link: notification.link || undefined, // Click action URL
                    analyticsLabel: "booking_notification_web",
                },
            },
            // FCM options (applies to all platforms)
            fcmOptions: {
                analyticsLabel: "booking_notification",
            },
        };

        // Use sendEachForMulticast for reliable delivery
        const multicastMessage = {
            tokens: deviceTokens,
            ...message,
        };
        
        const response = await admin.messaging().sendEachForMulticast(multicastMessage);
        
        // Log detailed results
        
        // Log successful message IDs for tracking
        if (response.successCount > 0) {
            response.responses.forEach((resp, idx) => {
                if (resp.success) {
                } else {
                }
            });
        }

        // Remove invalid tokens and log detailed errors
        if (response.failureCount > 0) {
            const invalidTokens = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    const error = resp.error;
                    
                    // Console log for visibility
                    
                    if (
                        error?.code === "messaging/invalid-registration-token" ||
                        error?.code === "messaging/registration-token-not-registered"
                    ) {
                        invalidTokens.push(deviceTokens[idx]);
                    } else if (error?.code === "messaging/authentication-error") {
                    } else if (error?.code === "messaging/server-unavailable") {
                    } else {
                    }
                }
            });

            if (invalidTokens.length > 0) {
                await removeInvalidTokens(invalidTokens);
            }
        }

        return {
            success: response.successCount,
            failed: response.failureCount,
        };
    } catch (error) {
        
        if (error.stack) {
        }
        
        // Check for common Firebase errors
        if (error.code === 'app/no-app') {
        } else if (error.code === 'messaging/invalid-argument') {
        } else if (error.code === 'messaging/authentication-error') {
        } else if (error.code === 'messaging/server-unavailable') {
        }
        
        return { success: 0, failed: deviceTokens.length };
    }
};

/**
 * Send push notification to a driver by ID
 * @param {string} driverId - Driver MongoDB ID
 * @param {Object} notification - Notification payload
 * @param {Object} data - Additional data payload
 * @returns {Promise<boolean>}
 */
const sendToDriver = async (driverId, notification, data = {}) => {
    try {
        const driver = await Driver.findById(driverId).select("fcmTokens");
        if (!driver || !driver.fcmTokens || driver.fcmTokens.length === 0) {
            return false;
        }

        const result = await sendToMultipleDevices(driver.fcmTokens, notification, data);
        return result.success > 0;
    } catch (error) {
        return false;
    }
};

/**
 * Send push notification to multiple drivers
 * @param {Array<string>} driverIds - Array of driver MongoDB IDs
 * @param {Object} notification - Notification payload
 * @param {Object} data - Additional data payload
 * @returns {Promise<Object>}
 */
const sendToDrivers = async (driverIds, notification, data = {}) => {
    try {
        
        // Ensure driverIds are valid MongoDB ObjectIds
        const validDriverIds = driverIds.filter(id => id && typeof id === 'string' && id.length > 0);
        
        if (validDriverIds.length === 0) {
            return { success: 0, failed: 0 };
        }
        
        const drivers = await Driver.find({ _id: { $in: validDriverIds } }).select("fcmTokens _id");
        
        if (drivers.length === 0) {
            return { success: 0, failed: 0 };
        }
        
        const allTokens = drivers.flatMap((driver) => {
            const tokens = driver.fcmTokens || [];
            if (tokens.length > 0) {
            } else {
            }
            return tokens;
        });


        if (allTokens.length === 0) {
            return { success: 0, failed: 0 };
        }

        // Ensure Firebase is initialized
        if (!firebaseInitialized) {
            initializeFirebase();
            await new Promise(resolve => setTimeout(resolve, 200));
            
            if (!firebaseInitialized) {
                return { success: 0, failed: allTokens.length };
            }
        }

        
        const result = await sendToMultipleDevices(allTokens, notification, data);
        
        // Console log final result
        
        if (result && result.success > 0) {
        }
        
        return result;
    } catch (error) {
        if (error.stack) {
        }
        // Return error result instead of throwing to allow caller to handle
        return { success: 0, failed: 0, error: error.message };
    }
};

/**
 * Remove invalid FCM token from all drivers
 * @param {string} token - Invalid FCM token
 */
const removeInvalidToken = async (token) => {
    try {
        await Driver.updateMany(
            { fcmTokens: token },
            { $pull: { fcmTokens: token } }
        );
    } catch (error) {
    }
};

/**
 * Remove multiple invalid FCM tokens
 * @param {Array<string>} tokens - Array of invalid FCM tokens
 */
const removeInvalidTokens = async (tokens) => {
    try {
        await Driver.updateMany(
            { fcmTokens: { $in: tokens } },
            { $pullAll: { fcmTokens: tokens } }
        );
    } catch (error) {
    }
};

module.exports = {
    sendToDevice,
    sendToMultipleDevices,
    sendToDriver,
    sendToDrivers,
    removeInvalidToken,
    removeInvalidTokens,
};

