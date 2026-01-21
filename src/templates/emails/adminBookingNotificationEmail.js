module.exports = function adminBookingNotificationEmail(booking) {
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

  const returnTripRow = booking.return_date_time
    ? `<tr>
        <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0; width: 38%;">
          <strong>Return Trip:</strong>
        </td>
        <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
          ${formatDateTime(booking.return_date_time)}
        </td>
      </tr>`
    : "";

  const stopsRow = booking.stops && booking.stops.length > 0
    ? `<tr>
        <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
          <strong>Stops:</strong>
        </td>
        <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
          ${booking.stops.join(", ")}
        </td>
      </tr>`
    : "";

  const houseRows = [];
  if (booking.pickup_house_no) {
    houseRows.push(`<tr>
      <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
        <strong>Pickup House No:</strong>
      </td>
      <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
        ${booking.pickup_house_no}
      </td>
    </tr>`);
  }
  if (booking.dropoff_house_no) {
    houseRows.push(`<tr>
      <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
        <strong>Drop-off House No:</strong>
      </td>
      <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
        ${booking.dropoff_house_no}
      </td>
    </tr>`);
  }
  const houseInfoRows = houseRows.join("");

  const flightRow = booking.flight_no
    ? `<tr>
        <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
          <strong>Flight Number:</strong>
        </td>
        <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
          ${booking.flight_no}
        </td>
      </tr>`
    : "";

  const specialInstructionsRow = booking.note_description
    ? `<tr>
        <td colspan="2" style="padding: 14px 0; border-top: 2px solid #e0e0e0;">
          <strong>Special Instructions:</strong><br />
          <span style="color: #555; font-style: italic;">${booking.note_description}</span>
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
  
  const priceValue = parseFloat(String(booking.actualPrice || booking.price || "0").replace(/[^\d.-]/g, "")) || 0;
  const assignmentType = priceValue > 150 ? "Admin Assignment Required" : "Auto Assignment";

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>New Booking - Admin Notification</title>
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
            max-width: 640px;
            margin: 40px auto;
            background-color: #ffffff;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
          }
          .email-header {
            background: linear-gradient(135deg, #111827 0%, #1f2937 50%, #4b5563 100%);
            color: #ffffff;
            padding: 32px 28px;
          }
          .email-header .logo {
            margin-bottom: 16px;
            text-align: center;
          }
          .email-header .logo img {
            max-width: 120px;
            height: auto;
            display: block;
            margin: 0 auto;
          }
          .email-header h1 {
            margin: 0 0 4px 0;
            font-size: 24px;
            font-weight: 600;
            letter-spacing: -0.3px;
          }
          .email-header p {
            margin: 0;
            font-size: 14px;
            opacity: 0.9;
          }
          .badge-row {
            margin-top: 14px;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
          }
          .badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 999px;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.6px;
          }
          .badge-primary {
            background-color: #f97316;
            color: #111827;
          }
          .badge-secondary {
            background-color: rgba(243, 244, 246, 0.18);
            color: #e5e7eb;
          }
          .email-body {
            padding: 28px 28px 32px;
          }
          .summary-box {
            background-color: #f9fafb;
            border-radius: 6px;
            padding: 14px 16px;
            border: 1px solid #e5e7eb;
            margin-bottom: 20px;
          }
          .summary-box h2 {
            margin: 0 0 8px 0;
            font-size: 16px;
            font-weight: 600;
          }
          .summary-box p {
            margin: 2px 0;
            font-size: 13px;
            color: #4b5563;
          }
          .details-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 8px;
          }
          .section-title {
            margin: 24px 0 8px 0;
            font-size: 14px;
            font-weight: 600;
            color: #374151;
            text-transform: uppercase;
            letter-spacing: 0.6px;
          }
          .price-highlight {
            margin-top: 16px;
            padding: 16px 18px;
            border-radius: 6px;
            background: linear-gradient(135deg, #eff6ff 0%, #e0f2fe 50%, #ecfeff 100%);
            border: 1px solid #bfdbfe;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .price-highlight .label {
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            color: #4b5563;
          }
          .price-highlight .value {
            font-size: 22px;
            font-weight: 700;
            color: #1d4ed8;
          }
          .footer {
            background-color: #f9fafb;
            padding: 18px 24px;
            text-align: center;
            border-top: 1px solid #e5e7eb;
          }
          .footer p {
            margin: 4px 0;
            font-size: 12px;
            color: #6b7280;
          }
          .footer .company-name {
            font-weight: 600;
            color: #111827;
            font-size: 13px;
          }
          @media only screen and (max-width: 640px) {
            .email-wrapper {
              margin: 20px;
              border-radius: 4px;
            }
            .email-header,
            .email-body {
              padding: 22px 18px;
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
            <h1>New Booking Created</h1>
            <p>A customer has placed a new booking.</p>
            <div class="badge-row">
              ${booking.orderNumber ? `<span class="badge badge-primary">Order Number: ${booking.orderNumber}</span>` : `<span class="badge badge-primary">Booking ID: ${booking._id}</span>`}
              <span class="badge badge-secondary">${assignmentType}</span>
            </div>
          </div>

          <div class="email-body">
            <div class="summary-box">
              <h2>Quick Overview</h2>
              <p><strong>Customer:</strong> ${booking.user_name} (${booking.email})</p>
              <p><strong>Route:</strong> ${booking.from_location} → ${booking.to_location}</p>
              <p><strong>Date & Time:</strong> ${formatDateTime(booking.date_time)}</p>
            </div>

            <div class="section-title">Customer Details</div>
            <table class="details-table">
              <tr>
                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0; width: 38%;">
                  <strong>Name:</strong>
                </td>
                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
                  ${booking.user_name}
                </td>
              </tr>
              <tr>
                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
                  <strong>Email:</strong>
                </td>
                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
                  ${booking.email}
                </td>
              </tr>
              <tr>
                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
                  <strong>Phone:</strong>
                </td>
                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
                  ${booking.number || "N/A"}
                </td>
              </tr>
            </table>

            <div class="section-title">Trip Details</div>
            <table class="details-table">
              <tr>
                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
                  <strong>From:</strong>
                </td>
                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
                  ${booking.from_location}
                </td>
              </tr>
              <tr>
                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
                  <strong>To:</strong>
                </td>
                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
                  ${booking.to_location}
                </td>
              </tr>
              <tr>
                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
                  <strong>Date & Time:</strong>
                </td>
                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
                  ${formatDateTime(booking.date_time)}
                </td>
              </tr>
              ${returnTripRow}
              <tr>
                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
                  <strong>Vehicle Type:</strong>
                </td>
                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
                  ${booking.cat_title}
                </td>
              </tr>
              <tr>
                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
                  <strong>Passengers:</strong>
                </td>
                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
                  ${booking.num_passengers || 1}
                </td>
              </tr>
              <tr>
                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
                  <strong>Luggage:</strong>
                </td>
                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
                  ${booking.luggage || "N/A"}
                </td>
              </tr>
              <tr>
                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
                  <strong>Distance:</strong>
                </td>
                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
                  ${booking.distance || "N/A"}
                </td>
              </tr>
              ${stopsRow}
              ${houseInfoRows}
              ${flightRow}
              ${specialInstructionsRow}
              ${phoneNumber}
            </table>

            <div class="price-highlight">
              <div>
                <div class="label">Total Price</div>
                <div class="value">€${booking.actualPrice || booking.price}</div>
              </div>
              <div style="text-align: right; font-size: 12px; color: #4b5563;">
                <div><strong>Assignment:</strong> ${assignmentType}</div>
                <div><strong>Status:</strong> ${booking.status || "pending"}</div>
              </div>
            </div>

            <p style="margin-top: 20px; font-size: 13px; color: #4b5563;">
              Please log in to the Taxigate admin dashboard to review this booking and, if required,
              assign it to an appropriate driver.
            </p>
          </div>

          <div class="footer">
            <p class="company-name">Taxigate</p>
            <p>New booking notification for administrators</p>
            <p>© ${new Date().getFullYear()} Taxigate. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;
};
