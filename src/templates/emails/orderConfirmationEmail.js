module.exports = function orderConfirmationEmail(data) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Order Confirmation</title>
        <style>
          body {
            font-family: "Segoe UI", Arial, sans-serif;
            background-color: #f7f7f7;
            padding: 30px;
            margin: 0;
          }
          .container {
            background-color: #ffffff;
            border-radius: 10px;
            max-width: 600px;
            margin: 0 auto;
            padding: 30px;
            box-shadow: 0 3px 10px rgba(0, 0, 0, 0.1);
          }
          .header {
            text-align: center;
            border-bottom: 2px solid #ff6600;
            padding-bottom: 10px;
            margin-bottom: 20px;
          }
          .header h2 {
            color: #ff6600;
            margin-bottom: 5px;
          }
          .details p {
            line-height: 1.6;
            font-size: 15px;
            margin: 8px 0;
          }
          .btn {
            display: inline-block;
            background-color: #ff6600;
            color: #fff;
            padding: 10px 20px;
            border-radius: 5px;
            text-decoration: none;
            margin-top: 20px;
          }
          .footer {
            margin-top: 30px;
            text-align: center;
            font-size: 12px;
            color: #888;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>Thank you for your order, ${data.fullName} 🎉</h2>
            <p>Your order has been successfully placed!</p>
          </div>
  
          <div class="details">
            <p><strong>Order Number:</strong> ${data.orderNumber}</p>
            <p><strong>Tracking Number:</strong> ${data.trackingNumber}</p>
            <p><strong>Total Amount:</strong> SAR ${data.totalAmount}</p>
            <p><strong>Payment Method:</strong> ${data.paymentMethod}</p>
            <p><strong>Order Status:</strong> ${data.orderStatus}</p>
  
            <h4>Shipping Address:</h4>
            <p>
              ${data.streetAddress}, ${data.city}, ${data.country}
            </p>
  
            <a href="https://emberidge.com/track/${
              data.trackingNumber
            }" class="btn">
              Track My Order
            </a>
          </div>
  
          <div class="footer">
            <p>© ${new Date().getFullYear()} Emberidge. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
    `;
};
