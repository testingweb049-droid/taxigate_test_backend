module.exports = function bookingConfirmationEmail(booking) {
  // Helper function to format booking date/time
  const formatDateTime = (date) => {
    if (!date) return "N/A";
    return new Date(date).toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const returnTripInfo = booking.return_date_time
    ? `<tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
          <strong>Return Trip:</strong>
        </td>
        <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
          ${formatDateTime(booking.return_date_time)}
        </td>
      </tr>`
    : "";

  const stopsInfo = booking.stops && booking.stops.length > 0
    ? `<tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0; vertical-align: top;">
          <strong>Stops:</strong>
        </td>
        <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
          ${booking.stops.map((stop, index) => `
            <div style="margin-bottom: ${index < booking.stops.length - 1 ? '8px' : '0'}; padding-left: 8px; border-left: 3px solid #667eea;">
              <span style="color: #667eea; font-weight: 600; margin-right: 6px;">${index + 1}.</span>
              <span style="color: #333333;">${stop}</span>
            </div>
          `).join('')}
        </td>
      </tr>`
    : "";

  const houseDetails = [];
  if (booking.pickup_house_no) {
    houseDetails.push(`<tr>
      <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
        <strong>Pickup House No:</strong>
      </td>
      <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
        ${booking.pickup_house_no}
      </td>
    </tr>`);
  }
  if (booking.dropoff_house_no) {
    houseDetails.push(`<tr>
      <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
        <strong>Drop-off House No:</strong>
      </td>
      <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
        ${booking.dropoff_house_no}
      </td>
    </tr>`);
  }
  const houseInfo = houseDetails.join("");

  const flightInfo = booking.flight_no
    ? `<tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
          <strong>Flight Number:</strong>
        </td>
        <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
          ${booking.flight_no}
        </td>
      </tr>`
    : "";

  const description = booking.note_description
    ? `<tr>
        <td colspan="2" style="padding: 16px 0; border-top: 2px solid #e0e0e0;">
          <strong>Special Instructions:</strong><br>
          <span style="color: #666; font-style: italic;">${booking.note_description}</span>
        </td>
      </tr>`
    : "";


    const phoneNumber = booking.number
    ? `<tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
          <strong>Phone Number:</strong>
        </td>
        <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
          ${booking.number}
        </td>
      </tr>`
    : "";
  

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Booking Confirmation - Taxigate</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background-color: #f5f5f5;
            margin: 0;
            padding: 0;
            line-height: 1.6;
            color: #333333;
          }
          .email-wrapper {
            max-width: 600px;
            margin: 40px auto;
            background-color: #ffffff;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          }
          .email-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #ffffff;
            padding: 40px 30px;
            text-align: center;
          }
          .email-header .logo {
            margin-bottom: 20px;
          }
          .email-header .logo img {
            max-width: 150px;
            height: auto;
            display: block;
            margin: 0 auto;
          }
          .email-header h1 {
            margin: 0;
            font-size: 28px;
            font-weight: 600;
            letter-spacing: -0.5px;
          }
          .email-header p {
            margin: 10px 0 0 0;
            font-size: 16px;
            opacity: 0.95;
          }
          .email-body {
            padding: 40px 30px;
          }
          .greeting {
            font-size: 18px;
            color: #333333;
            margin-bottom: 30px;
            font-weight: 500;
          }
          .booking-id {
            background-color: #f8f9fa;
            border-left: 4px solid #667eea;
            padding: 15px 20px;
            margin-bottom: 30px;
            border-radius: 4px;
          }
          .booking-id strong {
            color: #667eea;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .booking-id span {
            color: #333333;
            font-size: 16px;
            font-weight: 600;
          }
          .details-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 30px;
          }
          .details-table tr:last-child td {
            border-bottom: none;
          }
          .price-highlight {
            background-color: #f0f4ff;
            padding: 20px;
            border-radius: 6px;
            margin: 20px 0;
            text-align: center;
            border: 2px solid #667eea;
          }
          .price-highlight .price-label {
            font-size: 14px;
            color: #666666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 5px;
          }
          .price-highlight .price-value {
            font-size: 32px;
            font-weight: 700;
            color: #667eea;
            margin: 0;
          }
          .footer {
            background-color: #f8f9fa;
            padding: 30px;
            text-align: center;
            border-top: 1px solid #e0e0e0;
          }
          .footer p {
            margin: 5px 0;
            font-size: 14px;
            color: #666666;
          }
          .footer .company-name {
            font-weight: 600;
            color: #333333;
            font-size: 16px;
            margin-bottom: 10px;
          }
          @media only screen and (max-width: 600px) {
            .email-wrapper {
              margin: 20px;
              border-radius: 4px;
            }
            .email-header,
            .email-body,
            .footer {
              padding: 25px 20px;
            }
            .email-header h1 {
              font-size: 24px;
            }
            .price-highlight .price-value {
              font-size: 28px;
            }
          }
        </style>
      </head>
      <body>
        <div class="email-wrapper">
          <div class="email-header">
            <div class="logo">
              <img src="https://www.taxigate.nl/_next/image?url=%2F_next%2Fstatic%2Fmedia%2FMain_Logo.fb4c529e.png&w=128&q=75&dpl=dpl_DyM8W8hm8AM7zzQLmBrgZ2ekiqQm" alt="Taxigate Logo" />
            </div>
            <h1>Booking Confirmed</h1>
            <p>Thank you for choosing Taxigate</p>
          </div>
          
          <div class="email-body">
            <div class="greeting">
              Dear ${booking.user_name},
            </div>
            
            <p style="margin-bottom: 20px; color: #666666;">
              Your booking has been successfully confirmed. We're excited to serve you!
            </p>
            
            ${booking.orderNumber ? `
            <div class="booking-id">
              <strong>Order Number:</strong>
              <span style="margin-left: 8px;">${booking.orderNumber}</span>
            </div>
            ` : ''}
            
            <table class="details-table">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0; width: 40%;">
                  <strong>From:</strong>
                </td>
                <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                  ${booking.from_location}
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                  <strong>To:</strong>
                </td>
                <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                  ${booking.to_location}
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                  <strong>Date & Time:</strong>
                </td>
                <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                  ${formatDateTime(booking.date_time)}
                </td>
              </tr>
              ${returnTripInfo}
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                  <strong>Vehicle Type:</strong>
                </td>
                <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                  ${booking.cat_title}
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                  <strong>Passengers:</strong>
                </td>
                <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                  ${booking.num_passengers || 1}
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                  <strong>Luggage:</strong>
                </td>
                <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                  ${booking.luggage || "N/A"}
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                  <strong>Distance:</strong>
                </td>
                <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                  ${booking.distance || "N/A"}
                </td>
              </tr>
              ${stopsInfo}
              ${houseInfo}
              ${flightInfo}
              ${description}
              ${phoneNumber}
            </table>
            
            <div class="price-highlight">
              <div class="price-label">Total Price</div>
              <div class="price-value">€${booking.actualPrice || booking.price}</div>
            </div>
          </div>
          
          <div class="footer">
            <p class="company-name">Taxigate</p>
            <p>Your trusted transportation partner</p>
            <p style="margin-top: 15px; font-size: 12px; color: #999999;">
              © ${new Date().getFullYear()} Taxigate. All rights reserved.
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
};
