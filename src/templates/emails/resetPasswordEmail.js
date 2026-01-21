module.exports = (resetURL) => `
  <div style="font-family: Arial, sans-serif; color: #333;">
    <h2>Password Reset Request</h2>
    <p>You requested a password reset. Click the button below:</p>
    <a href="${resetURL}" 
      style="background:#4CAF50; color:#fff; padding:10px 20px; text-decoration:none; border-radius:5px;">
      Reset Password
    </a>
    <p>If not you, please ignore this email.</p>
    <small>This link expires in 10 minutes.</small>
  </div>
`;
