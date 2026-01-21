const nodemailer = require("nodemailer");

const sendEmail = async (options) => {
  // Validate required environment variables
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_PORT || !process.env.EMAIL_USERNAME || !process.env.EMAIL_PASSWORD) {
    const missingVars = [];
    if (!process.env.EMAIL_HOST) missingVars.push("EMAIL_HOST");
    if (!process.env.EMAIL_PORT) missingVars.push("EMAIL_PORT");
    if (!process.env.EMAIL_USERNAME) missingVars.push("EMAIL_USERNAME");
    if (!process.env.EMAIL_PASSWORD) missingVars.push("EMAIL_PASSWORD");
    
    const error = new Error(`Missing required email environment variables: ${missingVars.join(", ")}`);
    console.error("[EMAIL] Configuration Error:", error.message);
    throw error;
  }

  // 1) Create a transporter with connection timeout
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT, 10),
    secure: process.env.EMAIL_PORT === "465", // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USERNAME,
      pass: process.env.EMAIL_PASSWORD,
    },
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });

  // 2) Define email options
  const mailOptions = {
    from: process.env.EMAIL_USERNAME,
    to: options.email,
    subject: options.subject,
    text: options.text || options.message, // Plain text version
    html: options.html || undefined, // HTML version (if provided)
  };

  // 3) Send the email with detailed error handling
  try {
    const info = await transporter.sendMail(mailOptions);
    return info;
  } catch (error) {
    console.error(`[EMAIL] Failed to send email to ${options.email}:`, {
      message: error.message,
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode,
      stack: error.stack,
    });
    throw error;
  }
};

module.exports = sendEmail;
