import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();
const SIMPRO_BASE_URL = process.env.SIMPRO_BASE_URL;
const SIMPRO_ACCESS_TOKEN = process.env.SIMPRO_ACCESS_TOKEN;
const COMPANY_ID = process.env.SIMPRO_COMPANY_ID || "1";

async function countActiveSites() {
    try {
        const activeJobsRes = await axios.get(`${SIMPRO_BASE_URL}/api/v1.0/companies/${COMPANY_ID}/jobs/?Stage=in(Pending,Progress)&pageSize=250&columns=ID,Site,Customer`, {
            headers: { 'Authorization': `Bearer ${SIMPRO_ACCESS_TOKEN}` }
        });
        
        const discoveredSites = new Map();
        if (activeJobsRes.data) {
            for (const j of activeJobsRes.data) {
                if (j.Site?.ID && !discoveredSites.has(String(j.Site.ID))) {
                    discoveredSites.set(String(j.Site.ID), true);
                }
            }
        }
        console.log(`There are currently ${discoveredSites.size} sites with active Pending or Progress work.`);
    } catch (err) {
        console.error(err.message);
    }
}
countActiveSites();
