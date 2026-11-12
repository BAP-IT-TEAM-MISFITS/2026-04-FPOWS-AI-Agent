// FPOWS — entry point.
// Builds the Express app and starts the HTTP server. The daily report is fired
// by Cloud Scheduler hitting /api/trigger-manager-report (no in-process cron —
// running both sent the report twice).
// Application code lives under ./src (config, services, middleware, routes).
import { createApp } from './src/app.js';
import { PORT } from './src/config.js';

// Re-export so utility scripts can trigger the report without booting the server
// via a heavier path (see scripts/trigger_manual.js).
export { sendManagerDailyReport } from './src/services/report.js';

const app = createApp();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] FPOWS Automation live on port ${PORT}`);
});
