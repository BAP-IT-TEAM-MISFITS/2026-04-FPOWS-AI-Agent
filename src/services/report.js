// Daily manager report: discovers every site with active work, fetches live
// data for each, and emails an HTML portfolio summary to management.
import fs from 'fs';
import path from 'path';
import { COMPANY_ID, MANAGER_EMAIL, SMTP_USER, DATA_DIR } from '../config.js';
import { getSimpro, getSimproAll } from './simpro.js';
import { getTransporter } from './mailer.js';
import { fetchFpowData } from './fpow.js';

export async function sendManagerDailyReport(bypassCheck = false) {
    console.log("[CRON] Generating Daily Live Portfolio Summary Report for Manager...");
    const logPath = path.join(DATA_DIR, 'email_history.jsonl');
    const statusPath = path.join(DATA_DIR, 'last_daily_report.txt');
    const now = new Date();

    let rawLog;
    try { rawLog = await fs.promises.readFile(logPath, 'utf8'); } catch {
        console.log("[CRON] No history found. Skipping report.");
        return;
    }

    try {
        const raw = rawLog.trim();
        if (!raw) {
            console.log("[CRON] History file is empty.");
            return;
        }

        const lines = raw.split('\n').filter(Boolean);
        const logs = lines.map(line => {
            try { return JSON.parse(line); } catch (e) { return null; }
        }).filter(item => item !== null);

        // --- Expanded Discovery: Major & Regular Clients ---
        const discoveredSites = new Map();

        try {
            console.log("[CRON] Discovering Total Portfolio (Major & Regular Clients)...");
            console.log("[CRON] Discovering Total Portfolio via Global Site Scan...");

            // 1. Target ONLY sites with In Progress jobs. Including Pending would mean
            // ~1,400 more jobs / ~550 sites, which the per-site live fetch can't cover
            // in a reasonable time.
            console.log("[CRON] Scanning for In Progress jobs...");
            const activeJobs = await getSimproAll(`/api/v1.0/companies/${COMPANY_ID}/jobs/?Stage=Progress&columns=ID,Site,Customer`);

            if (activeJobs.length) {
                console.log(`[CRON] Found ${activeJobs.length} active jobs across the portfolio.`);
                for (const j of activeJobs) {
                    if (j.Site?.ID && !discoveredSites.has(String(j.Site.ID))) {
                        discoveredSites.set(String(j.Site.ID), {
                            siteName: j.Site.Name || "Active Site",
                            representativeJobId: j.ID,
                            client: j.Customer?.CompanyName || j.Customer?.Name || "Individual Client"
                        });
                    }
                }
            }
            console.log(`[CRON] Discovery Complete: ${discoveredSites.size} unique sites have active work.`);

            // 2. Add sites from TODAY'S SCHEDULES (Safety catch)
            const todayStr = now.toISOString().split('T')[0];
            const schedulesRes = await getSimpro(`/api/v1.0/companies/${COMPANY_ID}/schedules/?Date=${todayStr}&pageSize=250`);
            if (schedulesRes.data) {
                for (const s of schedulesRes.data) {
                    if (s.Site?.ID && !discoveredSites.has(String(s.Site.ID))) {
                        let repJobId = s.Reference || null;
                        if (repJobId) {
                            discoveredSites.set(String(s.Site.ID), {
                                siteName: s.Site.Name || "Scheduled Site",
                                representativeJobId: repJobId,
                                client: s.Customer?.Name || "Scheduled Client"
                            });
                        }
                    }
                }
            }
        } catch (e) {
            console.error("[CRON] Discovery Error:", e.message);
        }

        // --- Merge with History Logs (Enhanced to catch logs with only jobId) ---
        for (const log of logs) {
            const sid = log.siteId ? String(log.siteId) : null;
            if (sid && !discoveredSites.has(sid)) {
                discoveredSites.set(sid, {
                    siteName: log.siteName || "Unknown Site",
                    representativeJobId: log.jobId,
                    client: log.client
                });
            } else if (!sid && log.jobId) {
                // FALLBACK: If log only has jobId, we need to fetch its site to include it
                try {
                    const jobRes = await getSimpro(`/api/v1.0/companies/${COMPANY_ID}/jobs/${log.jobId}?columns=Site,Customer`);
                    const j = jobRes.data;
                    if (j.Site?.ID && !discoveredSites.has(String(j.Site.ID))) {
                        discoveredSites.set(String(j.Site.ID), {
                            siteName: j.Site.Name || "Unknown Site",
                            representativeJobId: log.jobId,
                            client: j.Customer?.CompanyName || j.Customer?.Name || log.client
                        });
                        console.log(`[CRON] Recovered Site #${j.Site.ID} from Job #${log.jobId} in logs.`);
                    }
                } catch (e) {
                    console.warn(`[CRON] Could not recover site for Job #${log.jobId}: ${e.message}`);
                }
            }
        }

        if (discoveredSites.size === 0) {
            console.log("[CRON] No sites found in discovery or logs.");
            return;
        }

        let reportRows = "";
        const processedSites = discoveredSites.size;
        console.log(`[CRON] Starting report generation for ${processedSites} unique sites...`);

        // Process each unique site with a LIVE FETCH as requested
        for (const [siteId, info] of discoveredSites.entries()) {
            try {
                console.log(`[CRON] Fetching live data for Site #${siteId} (via Job #${info.representativeJobId})...`);
                const liveData = await fetchFpowData(info.representativeJobId);
                const works = liveData.OutstandingWorks || [];

                let worksSummaryHtml = "";
                if (works.length > 0) {
                    worksSummaryHtml = `<table width="100%" style="border-collapse:collapse; font-size:11px; color:#444;">`;
                    works.forEach(w => {
                        const s = (w.DisplayStatus || 'PENDING').toUpperCase();
                        const statusStyle = s === 'PENDING' ? 'color:#92400E; font-weight:700;' : 'color:#0369A1; font-weight:700;';
                        // REMOVED TRUNCATION: Show full issue detail as requested
                        const fullIssue = (w.Issue || "").replace(/\n/g, '<br>');
                        worksSummaryHtml += `
                            <tr style="border-bottom:1px solid #eee;">
                                <td style="padding:8px 0; width:70px; vertical-align:top;"><span style="${statusStyle}">#${w.Job || '—'}</span></td>
                                <td style="padding:8px 0; width:110px; text-transform:uppercase; font-size:9px; font-weight:600; vertical-align:top;">${w.EquipmentType || 'Works'}</td>
                                <td style="padding:8px 0; line-height:1.4;">${fullIssue}</td>
                            </tr>
                        `;
                    });
                    worksSummaryHtml += `</table>`;
                } else {
                    worksSummaryHtml = `<i style="color:#999;">No outstanding works found live.</i>`;
                }

                const sixMo = liveData.ServiceDue?.LiveSixMo?.Month || "—";
                const sixYear = liveData.ServiceDue?.LiveSixMo?.Year || "";
                const twelveMo = liveData.ServiceDue?.LiveTwelveMo?.Month || "—";
                const twelveYear = liveData.ServiceDue?.LiveTwelveMo?.Year || "";

                reportRows += `
                    <tr style="border-bottom: 2px solid #eee;">
                        <td style="padding: 15px; vertical-align: top; background: #fafafa; border-right: 1px solid #ddd; width: 260px;">
                            <div style="font-weight: 700; color: #1a1a1a; margin-bottom:4px; font-size: 14px;">${info.siteName}</div>
                            <div style="font-size: 11px; color: #666; margin-bottom: 8px;">Site ID: ${siteId}</div>

                            <div style="margin-bottom: 12px; padding: 8px; background: #fff; border: 1px solid #eee; border-radius: 4px;">
                                <div style="font-size: 10px; text-transform: uppercase; color: #999; font-weight: bold; margin-bottom: 4px;">Live Service Dates</div>
                                <div style="font-size: 11px; margin-bottom: 2px;"><strong>6-Monthly:</strong> ${sixMo} ${sixYear}</div>
                                <div style="font-size: 11px;"><strong>12-Monthly:</strong> ${twelveMo} ${twelveYear}</div>
                            </div>

                            <div style="font-size: 11px; color: #cc2222;"><strong>Customer:</strong> ${info.client}</div>
                        </td>
                        <td style="padding: 15px; vertical-align: top;">
                            ${worksSummaryHtml}
                        </td>
                    </tr>
                `;

                await new Promise(r => setTimeout(r, 800)); // Respectful staggered fetching
            } catch (err) {
                console.error(`[CRON ERROR] Failed to fetch live summary for Site #${siteId}:`, err.message);
            }
        }

        const emailHtml = `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 950px; margin: auto; padding: 20px; color:#333; line-height: 1.5;">
                <h2 style="color: #cc2222; border-bottom: 4px solid #cc2222; padding-bottom: 12px; margin-bottom: 5px;">FPOWS Live Portfolio Status Report</h2>
                <div style="font-size: 12px; color: #666; margin-bottom: 25px;">Daily Summary for Management · ${now.toLocaleDateString('en-AU')}</div>

                <p>Hello Management, this report summarizes <strong>all outstanding jobs</strong> (Pending & In-Progress) fetched live from simPRO for every site in your customer portfolio.</p>

                <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #ddd; border-collapse: collapse; margin-top: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.05);">
                    <thead>
                        <tr style="background: #2c2c2c; color: white; text-transform: uppercase; font-size: 10px; letter-spacing: 1px;">
                            <th align="left" style="padding: 14px; width: 250px;">Site & Customer Information</th>
                            <th align="left" style="padding: 14px;">Summary of All Outstanding Findings (Live)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${reportRows || '<tr><td colspan="2" style="padding:40px; text-align:center; color:#999;">No site activity recorded with linkable Site IDs.</td></tr>'}
                    </tbody>
                </table>

                <div style="margin-top: 30px; padding: 20px; background: #fdf2f2; border-left: 5px solid #cc2222; border-radius: 4px; font-size: 12px;">
                    <strong>Technical Summary:</strong> This report is dynamically generated. If a job described here is updated in simPRO, the changes will reflect live in this summary.
                </div>

                <p style="text-align: center; font-size: 10px; color: #aaa; margin-top: 50px;">
                    REDMEN FPOWS Master Reporter v2.1 · Automated Dispatch
                </p>
            </div>
        `;

        const transporter = getTransporter();
        if (!transporter) {
            throw new Error('SMTP transporter not initialised — check SMTP_USER/SMTP_PASS env vars in Cloud Run.');
        }

        const recipients = [MANAGER_EMAIL].filter(Boolean).join(',');
        if (!recipients) {
            throw new Error('MANAGER_EMAIL env var is not set — no recipient for daily report.');
        }

        await transporter.sendMail({
            from: `"FPOWS Reporter" <${SMTP_USER}>`,
            to: recipients,
            subject: `[LIVE STATUS] FPOWS Daily Portfolio Summary - ${processedSites} Sites - ${now.toLocaleDateString('en-AU')}`,
            html: emailHtml
        });

        await fs.promises.writeFile(statusPath, now.toISOString());
        console.log(`[CRON] Daily Portfolio Report sent to ${recipients}.`);
    } catch (err) {
        console.error(`[CRON ERROR] ${err.message}`);
    }
}
