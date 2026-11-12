import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();
const SIMPRO_BASE_URL = process.env.SIMPRO_BASE_URL;
const SIMPRO_ACCESS_TOKEN = process.env.SIMPRO_ACCESS_TOKEN;
const COMPANY_ID = process.env.SIMPRO_COMPANY_ID || "1";

async function checkPendingProgress() {
    try {
        console.log("Fetching all Pending/Progress jobs to check for April 22 modifications...");
        const url = `${SIMPRO_BASE_URL}/api/v1.0/companies/${COMPANY_ID}/jobs/?Stage=in(Pending,Progress)&pageSize=250&columns=ID,Site,DateModified`;
        const res = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${SIMPRO_ACCESS_TOKEN}` }
        });
        
        console.log(`Checking ${res.data.length} active jobs...`);
        const targetDate = "2026-04-22";
        const modifiedSites = new Set();
        
        res.data.forEach(j => {
            if (j.DateModified && j.DateModified.startsWith(targetDate)) {
                modifiedSites.add(j.Site?.ID);
                console.log(`Job #${j.ID} modified yesterday at ${j.DateModified}`);
            }
        });

        console.log(`Summary: ${modifiedSites.size} sites modified on ${targetDate}.`);
    } catch (err) {
        console.error("Fetch failed:", err.message);
    }
}
checkPendingProgress();
