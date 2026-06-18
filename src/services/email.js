/**
 * Email service using Resend API
 * Sends agent download + registration code emails — branded Axenora AI
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM = process.env.RESEND_FROM_EMAIL || 'Axenora AI <onboarding@axenoraai.in>';
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost').replace(/\/+$/, '');

async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set, skipping email');
    return { success: false, error: 'Email not configured (RESEND_API_KEY missing)' };
  }

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error('Resend API error:', data);
      return { success: false, error: data.message || 'Email send failed' };
    }

    console.log(`Email sent to ${to}: ${data.id}`);
    return { success: true, id: data.id };
  } catch (err) {
    console.error('Email send error:', err.message);
    return { success: false, error: err.message };
  }
}

async function sendAgentInviteEmail({ to, employeeName, registrationCode }) {
  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a14; color: #e2e8f0; border-radius: 16px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #7c3aed, #4f46e5, #0ea5e9); padding: 40px 24px; text-align: center;">
        <h1 style="margin: 0; font-size: 32px; color: #fff; font-weight: 800; letter-spacing: -0.5px;">Axenora AI</h1>
        <p style="margin: 10px 0 0; color: rgba(255,255,255,0.8); font-size: 13px; letter-spacing: 1px; text-transform: uppercase;">Powered by Kaarthik Dass Arora</p>
      </div>

      <div style="padding: 36px 28px;">
        <div style="text-align: center; margin: 0 0 28px;">
          <p style="font-size: 24px; font-weight: 700; color: #ffffff; margin: 0; line-height: 1.3;">
            Congratulations, ${employeeName}!
          </p>
          <p style="font-size: 16px; color: #a78bfa; margin: 12px 0 0; font-weight: 500;">
            You are onboarding to the automation world
          </p>
        </div>

        <p style="font-size: 14px; color: #94a3b8; margin: 0 0 28px; line-height: 1.7; text-align: center;">
          Your workspace has been created. Log in to the CRM from your <strong style="color: #e2e8f0;">work computer</strong> — the onboarding page will guide you through the desktop app download and setup.
        </p>

        <div style="background: #1a1a2e; border: 1px solid #2d2d4a; border-radius: 12px; padding: 24px; margin: 0 0 28px;">
          <p style="font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #7c3aed; margin: 0 0 12px; font-weight: 700; text-align: center;">Your Registration Code</p>
          <p style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #a78bfa; margin: 0; text-align: center; font-family: 'Courier New', monospace;">${registrationCode}</p>
          <p style="font-size: 11px; color: #4a4a6a; margin: 10px 0 0; text-align: center;">You will need this code during desktop app setup</p>
        </div>

        <div style="background: #1a1a2e; border: 1px solid #2d2d4a; border-radius: 12px; padding: 20px; margin: 0 0 28px;">
          <p style="font-size: 13px; font-weight: 700; color: #e2e8f0; margin: 0 0 14px;">Getting Started:</p>
          <ol style="font-size: 13px; color: #94a3b8; margin: 0; padding-left: 20px; line-height: 2;">
            <li>Log in to the CRM from your <strong style="color: #e2e8f0;">office work computer</strong></li>
            <li>Click the <strong style="color: #a78bfa;">Download Setup App</strong> button on the onboarding screen</li>
            <li>Run the installer and enter your code: <strong style="color: #a78bfa;">${registrationCode}</strong></li>
            <li>Click <strong>Register</strong> — everything starts automatically</li>
          </ol>
        </div>

        <p style="font-size: 12px; color: #4a4a6a; margin: 0; line-height: 1.6; text-align: center;">
          You must complete setup from your office computer on the company network.<br/>
          For support, contact your system administrator.
        </p>
      </div>

      <div style="background: #0d0d1a; padding: 20px 24px; text-align: center; border-top: 1px solid #1a1a2e;">
        <p style="font-size: 12px; color: #4a4a6a; margin: 0; font-weight: 500;">Axenora AI &mdash; by Kaarthik Dass Arora</p>
        <p style="font-size: 10px; color: #2d2d4a; margin: 6px 0 0;">axenoraai.in</p>
      </div>
    </div>
  `;

  return sendEmail({
    to,
    subject: 'Welcome to Axenora AI — You\'re Onboarding to the Automation World',
    html,
  });
}

module.exports = { sendEmail, sendAgentInviteEmail };
