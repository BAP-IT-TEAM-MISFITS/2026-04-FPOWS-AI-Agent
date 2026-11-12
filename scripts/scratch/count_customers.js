import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();
const SIMPRO_BASE_URL = process.env.SIMPRO_BASE_URL;
const SIMPRO_ACCESS_TOKEN = process.env.SIMPRO_ACCESS_TOKEN;
const COMPANY_ID = process.env.SIMPRO_COMPANY_ID || "1";

async function countUniqueCustomers() {
    try {
        const activeJobsRes = await axios.get(`${SIMPRO_BASE_URL}/api/v1.0/companies/${COMPANY_ID}/jobs/?Stage=in(Pending,Progress)&pageSize=250&columns=ID,Customer`, {
            headers: { 'Authorization': `Bearer ${SIMPRO_ACCESS_TOKEN}` }
        });
        
        const uniqueCustomers = new Map();
        if (activeJobsRes.data) {
            for (const j of activeJobsRes.data) {
                if (j.Customer && j.Customer.ID) {
                    const cId = j.Customer.ID;
                    const cName = j.Customer.CompanyName || j.Customer.Name || "Unknown Customer";
                    if (!uniqueCustomers.has(String(cId))) {
                        uniqueCustomers.set(String(cId), cName);
                    }
                }
            }
        }
        console.log(`Total Unique Customers with Active Work: ${uniqueCustomers.size}`);
        console.log("Customer List:");
        Array.from(uniqueCustomers.values()).forEach(name => console.log(`- ${name}`));
        
    } catch (err) {
        console.error(err.message);
    }
}
countUniqueCustomers();
