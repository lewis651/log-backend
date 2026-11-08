import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

// Create transporter if SMTP settings are configured
const createTransporter = () => {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  if (!host && !user) {
    return null;
  }

  // If host is provided or if user is gmail
  const config = host
    ? {
        host,
        port,
        secure,
        auth: user && pass ? { user, pass } : undefined,
        tls: {
          rejectUnauthorized: false
        }
      }
    : {
        service: 'gmail',
        auth: { user, pass },
        tls: {
          rejectUnauthorized: false
        }
      };

  return nodemailer.createTransport(config);
};

export const sendTrackingEmail = async ({
  to,
  receiver_name,
  tracking_number,
  start_location,
  end_location,
  expected_delivery,
  product_image,
  package_type,
  weight,
  description
}) => {
  if (!to || !to.includes('@')) {
    console.warn('⚠️ No valid recipient email provided for shipment notification.');
    return { success: false, reason: 'Invalid or missing email' };
  }

  const frontendUrl = (
    process.env.FRONTEND_ORIGIN ||
    process.env.FRONTEND_URL ||
    'https://logistiqo.site'
  ).replace(/\/+$/, '');

  const trackingLink = `${frontendUrl}/tracking?id=${encodeURIComponent(tracking_number)}`;

  const formattedDate = expected_delivery
    ? new Date(expected_delivery).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : 'Estimated soon';

  const transporter = createTransporter();
  const fromEmail =
    process.env.EMAIL_FROM ||
    (process.env.SMTP_USER ? `"Logistiqo Logistics" <${process.env.SMTP_USER}>` : '"Logistiqo Tracking" <no-reply@logistiqo.site>');

  // Full image URL if product_image is a relative upload path
  let fullImageUrl = null;
  if (product_image) {
    if (product_image.startsWith('http://') || product_image.startsWith('https://')) {
      fullImageUrl = product_image;
    } else {
      const backendUrl = (process.env.BACKEND_URL || 'http://localhost:5000').replace(/\/+$/, '');
      fullImageUrl = `${backendUrl}${product_image.startsWith('/') ? '' : '/'}${product_image}`;
    }
  }

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Your package is on the way</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 30px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
    .header { background: #0b1a2c; padding: 28px; text-align: center; }
    .brand { color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; text-decoration: none; }
    .brand span { color: #e63030; }
    .content { padding: 32px 28px; }
    h1 { font-size: 22px; color: #0b1a2c; margin-top: 0; margin-bottom: 12px; }
    p { font-size: 15px; line-height: 1.6; color: #475569; margin: 0 0 16px; }
    .tracking-card { background: #f1f5f9; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center; border: 1px solid #cbd5e1; }
    .tracking-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin-bottom: 6px; }
    .tracking-num { font-size: 26px; font-weight: 800; color: #0b1a2c; font-family: monospace; letter-spacing: 1px; }
    .btn-track { display: inline-block; background-color: #e63030; color: #ffffff !important; padding: 14px 32px; border-radius: 8px; font-size: 15px; font-weight: 700; text-decoration: none; margin-top: 16px; }
    .details-table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
    .details-table td { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; }
    .details-table td.label { font-weight: 600; color: #64748b; width: 38%; }
    .details-table td.value { color: #0b1a2c; font-weight: 500; }
    .image-preview { margin: 24px 0; text-align: center; background: #fafafa; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; }
    .image-preview img { max-width: 100%; max-height: 280px; border-radius: 6px; object-fit: cover; }
    .footer { background: #f8fafc; padding: 20px 28px; text-align: center; font-size: 13px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">Logisti<span>qo</span></div>
    </div>
    <div class="content">
      <h1>Your package is on the way!</h1>
      <p>Hello ${receiver_name || 'Valued Customer'},</p>
      <p>Great news! Your shipment has been registered and is now in transit. You can track your package in real-time with the tracking number below.</p>
      
      <div class="tracking-card">
        <div class="tracking-label">Tracking Number</div>
        <div class="tracking-num">${tracking_number}</div>
        <a href="${trackingLink}" class="btn-track">Track Your Package</a>
      </div>

      <table class="details-table">
        <tr>
          <td class="label">Origin</td>
          <td class="value">${start_location}</td>
        </tr>
        <tr>
          <td class="label">Destination</td>
          <td class="value">${end_location}</td>
        </tr>
        <tr>
          <td class="label">Estimated Delivery</td>
          <td class="value">${formattedDate}</td>
        </tr>
        ${package_type ? `<tr><td class="label">Package Type</td><td class="value">${package_type}</td></tr>` : ''}
        ${weight ? `<tr><td class="label">Weight</td><td class="value">${weight}</td></tr>` : ''}
        ${description ? `<tr><td class="label">Notes</td><td class="value">${description}</td></tr>` : ''}
      </table>

      ${
        fullImageUrl
          ? `
        <div class="image-preview">
          <div style="font-size: 13px; font-weight: 700; color: #475569; margin-bottom: 8px; text-transform: uppercase;">Product / Package Image</div>
          <img src="${fullImageUrl}" alt="Package item" />
        </div>
      `
          : ''
      }

      <p style="margin-top: 24px; font-size: 14px; color: #64748b;">
        If you have any questions, you can use our 24/7 Live Chat on our tracking page.
      </p>
    </div>
    <div class="footer">
      <p style="margin: 0 0 6px;">You are receiving this notification because a cargo shipment was registered for your delivery address.</p>
      <p style="margin: 0;">&copy; ${new Date().getFullYear()} Logistiqo Logistics Platform. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;

  const textContent = `
Your package is on the way!

Hello ${receiver_name || 'Customer'},
Your shipment has been dispatched. Track your package using the tracking number below:

Tracking Number: ${tracking_number}
Track here: ${trackingLink}

Origin: ${start_location}
Destination: ${end_location}
Estimated Delivery: ${formattedDate}
${package_type ? `Package Type: ${package_type}\n` : ''}${weight ? `Weight: ${weight}\n` : ''}${description ? `Notes: ${description}\n` : ''}
Logistiqo Logistics Team
  `;

  const emailSubject = `Shipment Notification: Package ${tracking_number} is in transit`;
  const replyToAddress = process.env.REPLY_TO || process.env.SMTP_USER || 'Logistiqo@gmail.com';

  // 1. Send via Resend if API key is provided
  if (process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const resendFrom =
        process.env.EMAIL_FROM ||
        'Logistiqo Logistics <notifications@logistiqo.site>';

      const res = await resend.emails.send({
        from: resendFrom,
        to,
        subject: emailSubject,
        html: htmlContent,
        text: textContent,
        reply_to: replyToAddress,
        headers: {
          'X-Mailer': 'Logistiqo Logistics Notification System',
          'Auto-Submitted': 'auto-generated',
          'List-Unsubscribe': `<mailto:${replyToAddress}?subject=unsubscribe>`,
        }
      });

      if (res.error) {
        console.error(`❌ [Resend Error]:`, res.error);
        return { success: false, error: res.error.message };
      }

      console.log(`✅ [Resend] Tracking email sent to ${to}. Email ID: ${res.data?.id}`);
      return { success: true, id: res.data?.id };
    } catch (err) {
      console.error(`❌ [Resend Exception] Failed to send email to ${to}:`, err.message || err);
      return { success: false, error: err.message };
    }
  }

  // 2. Otherwise send via SMTP if configured
  if (!transporter) {
    console.log(`\n==================================================`);
    console.log(`✉️ [EMAIL NOTIFICATION] (Resend / SMTP not configured - Simulated Send)`);
    console.log(`To: ${to}`);
    console.log(`Subject: ${emailSubject}`);
    console.log(`Tracking Link: ${trackingLink}`);
    console.log(`==================================================\n`);
    return { success: true, simulated: true };
  }

  // When using Gmail SMTP, the 'from' address MUST match the authenticated user to pass SPF/DKIM
  const smtpFromAddress = process.env.SMTP_USER
    ? `"Logistiqo Logistics" <${process.env.SMTP_USER}>`
    : fromEmail;

  try {
    const info = await transporter.sendMail({
      from: smtpFromAddress,
      to,
      replyTo: replyToAddress,
      subject: emailSubject,
      text: textContent,
      html: htmlContent,
      headers: {
        'X-Mailer': 'Logistiqo Notification System',
        'Auto-Submitted': 'auto-generated',
        'X-Auto-Response-Suppress': 'All',
        'List-Unsubscribe': `<mailto:${replyToAddress}?subject=unsubscribe>`,
      }
    });
    console.log(`✅ Tracking email sent to ${to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`❌ Failed to send tracking email to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
};
