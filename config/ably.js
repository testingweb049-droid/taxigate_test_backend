const Ably = require("ably");
const { randomUUID } = require("crypto");
const logger = require("../src/utils/logger");
const chalk = require("chalk");

let ably = null;
let ablyRest = null;
let ablyInitialized = false;

/**
 * Initialize Ably clients
 * PHASE 1: Made lazy and serverless-safe - only initializes when needed
 */
const initializeAbly = () => {
    // Check if REST client is already initialized
    if (ablyRest) {
        return { ably, ablyRest };
    }

    const ablyApiKey = process.env.ABLY_API_KEY;
    
    // PHASE 1: Graceful error handling for missing env var (serverless-safe)
    if (!ablyApiKey) {
        logger.warn("[ABLY] ABLY_API_KEY environment variable is not set - Ably features disabled");
        return { ably: null, ablyRest: null };
    }

    try {
        // PHASE 1: Detect serverless environment (Vercel, AWS Lambda, etc.)
        const isServerless = !!(
            process.env.VERCEL || 
            process.env.AWS_LAMBDA_FUNCTION_NAME || 
            process.env.FUNCTION_NAME ||
            process.env.K_SERVICE // Google Cloud Functions
        );

        // Initialize Ably REST client (always needed for publishing)
        if (!ablyRest) {
            ablyRest = new Ably.Rest({
                key: ablyApiKey,
            });
            if (isServerless) {
                logger.info(chalk.blue("[ABLY] REST client initialized (serverless mode)"));
            } else {
                logger.info(chalk.blue("[ABLY] REST client initialized"));
            }
        }

        // PHASE 1: Skip Realtime client in serverless (not needed for publishing, and causes issues)
        // Realtime client is only needed for server-side subscriptions, which don't work in serverless
        if (!isServerless && !ably) {
            ably = new Ably.Realtime({
                key: ablyApiKey,
                clientId: process.env.ABLY_CLIENT_ID || "server",
                echoMessages: false,
                logLevel: 0, // Disable Ably internal logging
            });
            
            // Setup connection event handlers to log connection status
            ably.connection.on("connected", () => {
                logger.info(chalk.blue("[ABLY] Realtime connected"));
            });
            
            ably.connection.on("disconnected", () => {
                logger.warn(chalk.yellow("[ABLY] Realtime disconnected"));
            });
            
            ably.connection.on("failed", () => {
                logger.error(chalk.red("[ABLY] Realtime connection failed"));
            });

            // Setup Realtime handlers only if Realtime client exists
            setupRealtimeHandlers();
        } else if (isServerless) {
            logger.info(chalk.blue("[ABLY] Skipping Realtime client initialization (serverless environment)"));
        }

        ablyInitialized = true;
        return { ably, ablyRest };
    } catch (error) {
        logger.error(`[ABLY] Failed to initialize Ably: ${error?.message || error}`);
        // PHASE 1: Don't throw in serverless - return null clients instead
        return { ably: null, ablyRest: null };
    }
};

// PHASE 1: REMOVED immediate initialization - now lazy (only when needed)
// This prevents module load errors in serverless environments

/**
 * Verify Ably REST client is working (for diagnostics)
 * PHASE 2: Enhanced verification with better error messages
 * @returns {Promise<boolean>} True if Ably is working, false otherwise
 */
const verifyAblyConnection = async () => {
    try {
        // PHASE 1: Lazy initialization
        if (!ablyRest) {
            const initialized = initializeAbly();
            if (!initialized.ablyRest) {
                logger.warn("[ABLY] Verification failed: REST client not initialized. Check ABLY_API_KEY environment variable.");
                return false;
            }
            ablyRest = initialized.ablyRest;
        }
        
        // Try to get a channel (this will verify the client is working)
        const testChannel = ablyRest.channels.get("test-connection");
        // Just getting the channel doesn't verify connection, but it's a basic check
        logger.info("[ABLY] Connection verification successful");
        return true;
    } catch (error) {
        logger.error(`[ABLY] Connection verification failed: ${error?.message || error}`);
        return false;
    }
};

// Connection state management
let connectionRetries = 0;
const MAX_RETRIES = 5;
let reconnectTimeout = null;

// Setup Realtime connection handlers
const setupRealtimeHandlers = () => {
    if (!ably) {
        return;
    }

    ably.connection.on("connecting", () => {
        connectionRetries = 0;
    });

    ably.connection.on("connected", () => {
        connectionRetries = 0;
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
    });

    ably.connection.on("disconnected", () => {
    });

    ably.connection.on("suspended", () => {
    });

    ably.connection.on("failed", (err) => {
        connectionRetries++;
        
        // Exponential backoff reconnection
        if (connectionRetries < MAX_RETRIES) {
            const backoffTime = Math.min(1000 * Math.pow(2, connectionRetries), 30000);
            
            reconnectTimeout = setTimeout(() => {
                if (ably) {
                    ably.connection.connect();
                }
            }, backoffTime);
        }
    });

    ably.connection.on("closed", () => {
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
    });
};

// PHASE 1: Setup handlers only if Realtime client exists (not in serverless)
// This is now called from initializeAbly() when Realtime client is created

// Channel cache to reuse channel instances (for REST client)
const channelCache = new Map();

// Helper: get REST channel (with caching for reuse)
// PHASE 1: Lazy initialization - only initializes when needed
const getChannel = (channelName) => {
    // Ensure Ably is initialized (lazy initialization)
    if (!ablyRest) {
        const initialized = initializeAbly();
        if (!initialized.ablyRest) {
            const error = new Error("Ably REST client not available. Check ABLY_API_KEY environment variable in Vercel.");
            logger.error(`[ABLY] Failed to get channel ${channelName}: ${error.message}`);
            throw error;
        }
        ablyRest = initialized.ablyRest;
    }

    if (!channelCache.has(channelName)) {
        const channel = ablyRest.channels.get(channelName);
        channelCache.set(channelName, channel);
        return channel;
    }
    return channelCache.get(channelName);
};

// Helper: get Realtime channel
// PHASE 1: Only works in non-serverless environments
const getRealtimeChannel = (channelName) => {
    if (!ably) {
        const initialized = initializeAbly();
        if (!initialized.ably) {
            const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
            if (isServerless) {
                throw new Error("Ably Realtime client is not available in serverless environments. Use REST client for publishing.");
            }
            throw new Error("Ably Realtime client not available. Check ABLY_API_KEY environment variable.");
        }
        ably = initialized.ably;
        // setupRealtimeHandlers() is already called in initializeAbly()
    }
    return ably.channels.get(channelName);
};

// PHASE 1 & 4: Enhanced error handling and lazy initialization for publishToChannel
// Publish event using REST client
const publishToChannel = async (channelName, eventName, data) => {
    try {
        // PHASE 1: Lazy initialization - only when publishToChannel is called
        if (!ablyRest) {
            const initialized = initializeAbly();
            if (!initialized.ablyRest) {
                const error = new Error("Ably REST client not initialized. ABLY_API_KEY may be missing in Vercel environment variables.");
                logger.error(`[ABLY] Failed to initialize REST client for channel ${channelName}, event ${eventName}`);
                logger.error(`[ABLY] Please ensure ABLY_API_KEY is set in Vercel project settings -> Environment Variables`);
                throw error;
            }
            ablyRest = initialized.ablyRest;
        }

        const payloadData = data || {};
        const enrichedData = {
            ...payloadData,
            _sentAt: payloadData._sentAt || new Date().toISOString(),
            _seq: payloadData._seq || Date.now(),
            _eventId: payloadData._eventId || randomUUID(),
        };

        // Use REST client for publishing
        const channel = getChannel(channelName);
        
        // REST client publish returns a Promise
        const publishPromise = channel.publish(eventName, enrichedData);
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Ably publish timeout after 10 seconds")), 10000)
        );
        
        try {
            await Promise.race([publishPromise, timeoutPromise]);
            // PHASE 4: Log successful publishes for critical events
            const criticalEvents = [
                'wallet-balance-updated',
                'booking-completed',
                'live-booking-removed',
                'upcoming-booking-added',
                'booking-accepted-admin',
                'booking-rejected-admin'
            ];
            if (criticalEvents.includes(eventName)) {
                logger.info(`[ABLY] Successfully published critical event ${eventName} to channel ${channelName}`);
            }
            return true;
        } catch (publishError) {
            // PHASE 4: Enhanced error logging
            logger.error(`[ABLY] Failed to publish event ${eventName} to channel ${channelName}: ${publishError?.message || publishError}`);
            if (publishError?.stack) {
                logger.error(`[ABLY] Stack trace: ${publishError.stack}`);
            }
            throw publishError;
        }
    } catch (err) {
        // PHASE 4: Log all errors with context
        logger.error(`[ABLY] Error in publishToChannel for ${channelName}/${eventName}: ${err?.message || err}`);
        throw err;
    }
};

/**
 * Batch publish multiple events to the same channel using REST client
 * More efficient than multiple separate publishes
 * @param {string} channelName - The channel name
 * @param {Array<{eventName: string, data: any}>} events - Array of events to publish
 * @returns {Promise<Array>} Array of results for each publish
 */
const batchPublishToChannel = async (channelName, events) => {
    if (!Array.isArray(events) || events.length === 0) {
        return [];
    }

    const channel = getChannel(channelName);

    // Create promises for all publishes using REST client
    const publishPromises = events.map(async ({ eventName, data }) => {
        try {
            const payloadData = data || {};
            const enrichedData = {
                ...payloadData,
                _sentAt: payloadData._sentAt || new Date().toISOString(),
                _seq: payloadData._seq || Date.now(),
                _eventId: payloadData._eventId || randomUUID(),
            };
            await channel.publish(eventName, enrichedData);
            return { eventName, success: true };
        } catch (err) {
            throw err;
        }
    });

    // Execute all publishes and return results
    try {
        const results = await Promise.allSettled(publishPromises);
        return results;
    } catch (error) {
        throw error;
    }
};

// Subscribe to channel using Realtime client
// PHASE 1: Only works in non-serverless environments
const subscribeToChannel = (channelName) => {
    try {
        const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
        if (isServerless) {
            logger.warn(`[ABLY] subscribeToChannel called in serverless environment - skipping (channel: ${channelName})`);
            return;
        }
        const channel = getRealtimeChannel(channelName);
        
        channel.subscribe((msg) => {
        });
    } catch (err) {
        logger.warn(`[ABLY] Failed to subscribe to channel ${channelName}: ${err?.message || err}`);
    }
};

// PHASE 1: REMOVED immediate subscription - not needed in serverless and causes issues
// Subscriptions are only needed for long-lived server processes, not serverless functions

// ===== PUSH NOTIFICATION FUNCTIONS =====

/**
 * Send push notification via Ably Push
 * This works even when the app is closed (like WhatsApp)
 * 
 * @param {string} channelName - The Ably channel name
 * @param {string} eventName - The event name
 * @param {Object} data - The notification data
 * @param {Array<string>} deviceTokens - Array of device tokens (FCM/APNs tokens)
 * @param {Object} pushNotification - Push notification payload (title, body, etc.)
 */
const sendPushNotification = async (
    channelName,
    eventName,
    data,
    deviceTokens = [],
    pushNotification = {}
) => {
    return new Promise(async (resolve, reject) => {
        try {
            // PHASE 1: Lazy initialization
            if (!ablyRest) {
                const initialized = initializeAbly();
                if (!initialized.ablyRest) {
                    const error = new Error("Ably REST client not available. Check ABLY_API_KEY in Vercel environment variables.");
                    logger.error(`[ABLY] ${error.message}`);
                    return reject(error);
                }
                ablyRest = initialized.ablyRest;
            }

            const channel = ablyRest.channels.get(channelName);

            // Default push notification payload
            const defaultPushPayload = {
                notification: {
                    title: pushNotification.title || "New Booking",
                    body: pushNotification.body || "You have a new booking request",
                    sound: "default",
                    badge: 1,
                },
                data: {
                    event: eventName,
                    ...data,
                },
            };

            // If device tokens are provided, send push notifications
            if (deviceTokens && deviceTokens.length > 0) {
                // Publish with push notification
                const pushPayload = {
                    ...defaultPushPayload,
                    push: {
                        notification: defaultPushPayload.notification,
                        data: defaultPushPayload.data,
                    },
                };

                // For each device token, publish the notification
                const publishPromises = deviceTokens.map((deviceToken) => {
                    return channel.publish(eventName, pushPayload, {
                        extras: {
                            push: {
                                recipients: [
                                    {
                                        transportType: "fcm", // or "apns" for iOS
                                        registrationToken: deviceToken,
                                    },
                                ],
                            },
                        },
                    });
                });

                await Promise.all(publishPromises);
            }

            // Also publish to channel for real-time (in-app) notifications
            await publishToChannel(channelName, eventName, data);

            resolve(true);
        } catch (err) {
            reject(err);
        }
    });
};

// Getter functions with lazy initialization
// PHASE 1: Lazy initialization for getters
const getAbly = () => {
    if (!ably) {
        const initialized = initializeAbly();
        ably = initialized.ably;
        if (!ably) {
            const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
            if (isServerless) {
                logger.warn("[ABLY] Realtime client not available in serverless environment");
            }
        }
    }
    return ably;
};

const getAblyRest = () => {
    if (!ablyRest) {
        const initialized = initializeAbly();
        ablyRest = initialized.ablyRest;
        if (!ablyRest) {
            logger.error("[ABLY] REST client not available - check ABLY_API_KEY environment variable");
        }
    }
    return ablyRest;
};

module.exports = {
    // Getters
    get ably() {
        return getAbly();
    },
    get ablyRest() {
        return getAblyRest();
    },
    // Helper functions
    getChannel, // Returns REST channel
    getRealtimeChannel, // Returns Realtime channel
    publishToChannel, // Uses REST client
    batchPublishToChannel, // Uses REST client
    subscribeToChannel, // Uses Realtime client
    sendPushNotification,
    // Initialization and verification functions
    initializeAbly, // Initialize Ably clients
    verifyAblyConnection, // Verify Ably is working
};
