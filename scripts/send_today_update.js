import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const MANAGER_EMAIL = process.env.MANAGER_EMAIL;

function getTransporter() {
    return nodemailer.createTransport({
        service: 'gmail',
        auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
}

async function sendTodayUpdate() {
    const now = new Date();
    const dateFormatted = now.toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    
    const updateHtml = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; border: 1px solid #e0e0e0; border-radius: 12px; color: #333;">
            <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="color: #cc2222; margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 1px;">FPOWS Automation - Daily Status Update</h1>
                <p style="color: #666; font-size: 14px;">Project Technical Report: ${dateFormatted}</p>
            </div>

            <div style="background: #fdf2f2; border-left: 5px solid #cc2222; padding: 20px; margin-bottom: 30px;">
                <h2 style="color: #cc2222; margin-top: 0; font-size: 18px;">🚀 Critical Stability Achievements</h2>
                <ul style="line-height: 1.6;">
                    <li><strong>API Rate Limit Mitigation (429 Fix)</strong>: Implemented exponential backoff and sequential request logic to prevent simPRO from blocking the system during high-volume activity.</li>
                    <li><strong>Asset Sync Alignment (404 Fix)</strong>: Corrected the API pathing to target the <code>/customerAssets/</code> endpoint, ensuring background service date updates are real-time and error-free.</li>
                </ul>
            </div>

            <div style="margin-bottom: 30px;">
                <h2 style="color: #2c3e50; font-size: 18px; border-bottom: 2px solid #eee; padding-bottom: 10px;">📊 New Features & Operations</h2>
                <ul style="line-height: 1.6;">
                    <li><strong>Bi-Weekly Master Summary</strong>: Successfully deployed an automated reporting engine that runs every Tuesday, providing management with a full audit trail of all reports sent to clients.</li>
                    <li><strong>Enhanced History Logs</strong>: Added recipient email tracking to all logs for improved accountability and delivery verification.</li>
                    <li><strong>Presence Tracking</strong>: Implemented a live indicator in the dashboard to show who is currently viewing each simPRO job.</li>
                </ul>
            </div>

            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border: 1px solid #eee;">
                <h2 style="color: #2c3e50; margin-top: 0; font-size: 16px;">📂 Infrastructure & Deployment</h2>
                <p style="font-size: 14px; margin-bottom: 0;"><strong>Git Sync Status</strong>: All stable code (including the latest reporter logic) has been committed and pushed to the <strong>GitHub <code>main</code> branch</strong>. The live codebase is now perfectly aligned with the development environment.</p>
            </div>

            <p style="margin-top: 40px; text-align: center; font-size: 12px; color: #999;">
                This update was automatically generated and sent by the FPOWS Intelligence Assistant.<br>
                Redmen Fire Protection Automation System
            </p>
        </div>
    `;

    try {
        const transporter = getTransporter();
        const info = await transporter.sendMail({
            from: `"FRED — FPOWS" <${SMTP_USER}>`,
            to: MANAGER_EMAIL,
            subject: `[PROGRESS UPDATE] FPOWS Automation - Technical Status - ${now.toLocaleDateString()}`,
            html: updateHtml
        });
        console.log("SUCCESS: Today's progress update sent to manager.");
    } catch (err) {
        console.error("FAILED to send update:", err.message);
    }
}

sendTodayUpdate();
