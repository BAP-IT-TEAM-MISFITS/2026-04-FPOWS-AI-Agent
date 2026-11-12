import { FastMCP } from 'fastmcp';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import axios from 'axios';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

// Mocking some of the server.js environment and functions to test reporting
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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

async function runTestReport() {
    console.log("--- STARTING MANUAL REPORT TEST ---");
    try {
        const logPath = path.join(__dirname, 'email_history.jsonl');
        const now = new Date();
        
        if (!fs.existsSync(logPath)) {
            console.log('No history found, creating dummy log for test...');
            fs.writeFileSync(logPath, JSON.stringify({
                timestamp: new Date().toISOString(),
                jobId: "TEST-001",
                client: "Test Client 1",
                type: "EMAIL_SUCCESS"
            }) + "\n");
        }

        const raw = fs.readFileSync(logPath, 'utf8');
        const lines = raw.trim().split('\n').filter(Boolean);
        const allLogs = lines.map(line => {
            try { return JSON.parse(line); } catch (e) { return null; }
        }).filter(item => item !== null);

        console.log(`Found ${allLogs.length} logs total.`);

        const reportHtml = `
            <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
                <h2 style="color: #2c3e50;">[TEST] FPOWS Master Activity Summary</h2>
                <p>Total Reports Sent (All Time): ${allLogs.length}</p>
                <table width="100%" style="border-collapse: collapse; font-size: 11px;">
                    <thead>
                        <tr style="background: #2c2c2c; color: white;">
                            <th style="padding: 8px; border: 1px solid #444;">Date</th>
                            <th style="padding: 8px; border: 1px solid #444;">Job ID</th>
                            <th style="padding: 8px; border: 1px solid #444;">Client</th>
                            <th style="padding: 8px; border: 1px solid #444;">Recipient</th>
                            <th style="padding: 8px; border: 1px solid #444;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${allLogs.map(log => `
                            <tr>
                                <td style="padding: 6px; border: 1px solid #eee;">${new Date(log.timestamp).toLocaleDateString()}</td>
                                <td style="padding: 6px; border: 1px solid #eee;">#${log.jobId}</td>
                                <td style="padding: 6px; border: 1px solid #eee;">${log.client}</td>
                                <td style="padding: 6px; border: 1px solid #eee;">${log.clientEmail || log.to || '—'}</td>
                                <td style="padding: 6px; border: 1px solid #eee; color: #27ae60; font-weight: bold;">SUCCESS</td>
                            </tr>
                        `).reverse().join('')}
                    </tbody>
                </table>
            </div>
        `;

        const transporter = getTransporter();
        const recipients = [MANAGER_EMAIL].filter(Boolean).join(',');

        console.log(`Sending test report to: ${recipients}`);
        
        await transporter.sendMail({
            from: `"FPOWS Reporter Test" <${SMTP_USER}>`,
            to: recipients,
            subject: `[TEST] FPOWS Bi-Weekly Summary - ${now.toLocaleDateString()}`,
            html: reportHtml
        });

        console.log("SUCCESS: Test email sent.");
    } catch (err) {
        console.error("FAILED:", err.message);
    }
}

runTestReport();
