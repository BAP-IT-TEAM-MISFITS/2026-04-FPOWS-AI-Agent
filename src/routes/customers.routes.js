// Customer & schedule routes: today's schedules, customer search (with a 60s
// cache + live fallback), per-customer jobs, latest active job, and a cache
// debug view. The active-customers cache is shared via src/state.js.
import express from 'express';
import { COMPANY_ID } from '../config.js';
import { getSimpro, getSimproAll } from '../services/simpro.js';
import { searchLimiter } from '../middleware/rateLimit.js';
import { cache } from '../state.js';

export const customersRouter = express.Router();

// Short-TTL cache for the per-customer jobs list — drilling into a customer
// hits this every time, so cache it briefly (rate-limit protection).
const _custJobsCache = new Map();
const CUST_JOBS_TTL_MS = parseInt(process.env.CUST_JOBS_CACHE_TTL_MS || '60000', 10);

// Schedules endpoint
customersRouter.get('/api/schedules/today', async (req, res) => {
    console.log(`[GET] /api/schedules/today`);
    try {
        const jobsRes = await getSimpro(`/api/v1.0/companies/${COMPANY_ID}/jobs/?pageSize=50&columns=ID,Name,Customer,DateIssued`);
        const schedules = jobsRes.data.map(job => ({
            jobId: job.ID,
            client: job.Customer?.CompanyName || job.Name || "simPRO Record",
            site: "simPRO Site",
            time: job.DateIssued ? new Date(job.DateIssued).toLocaleDateString('en-AU') : "Live Record"
        }));
        res.json({ date: new Date().toISOString().split('T')[0], schedules });
    } catch (err) {
        res.json({ date: "Offline", schedules: [] });
    }
});

// Customer Search endpoint
customersRouter.get('/api/customers/search', searchLimiter, async (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length > 0 && q.length < 2) return res.json({ results: [] });
    console.log(`[GET] /api/customers/search?q=${q}`);
    try {
        // Cache valid for 60 seconds. force=1 always bypasses it (e.g. on modal open)
        if (!cache.customers || (Date.now() - cache.customersTime) > 60000 || req.query.force === '1') {
            // 1. Fetch ALL active jobs to populate customers (Fully Live Portfolio)
            const jobs = await getSimproAll(`/api/v1.0/companies/${COMPANY_ID}/jobs/?Stage=in(Pending,Progress)&columns=ID,Name,Customer,Site,Status,DateIssued,DateModified,Tags`);
            const siteMap = new Map();

            // Build unique map of customers
            const uniqueMap = new Map();
            const OVERDUE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;
            const now = Date.now();

            jobs.forEach(job => {
                if (job.Customer && job.Customer.ID) {
                    const cId = job.Customer.ID;
                    const modDate = job.DateModified ? new Date(job.DateModified).getTime() : 0;

                    if (!uniqueMap.has(cId)) {
                        const isOverdue = modDate > 0 ? (now - modDate) > OVERDUE_THRESHOLD_MS : false;
                        uniqueMap.set(cId, {
                            id: cId,
                            name: job.Customer.CompanyName || `${job.Customer.GivenName || ''} ${job.Customer.FamilyName || ''}`.trim() || 'Unnamed',
                            type: job.Customer.CompanyName ? 'Company' : 'Individual',
                            priority: false,
                            overdue: isOverdue,
                            postcode: 'N/A',
                            latestActivity: modDate,
                            latestJobId: job.ID,
                            latestSite: job.Site?.Name || 'Unknown'
                        });
                    } else {
                        // If we already have this customer, check if this job is newer
                        const curr = uniqueMap.get(cId);
                        if (modDate > curr.latestActivity) {
                            curr.latestActivity = modDate;
                            curr.latestJobId = job.ID;
                            curr.latestSite = job.Site?.Name || 'Unknown';
                            const OVERDUE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;
                            curr.overdue = (now - modDate) > OVERDUE_THRESHOLD_MS;
                        }
                    }
                }
            });
            let customersArray = Array.from(uniqueMap.values());

            // Sort the raw array by activity before processing tags
            customersArray.sort((a, b) => b.latestActivity - a.latestActivity);

            const getTagNames = (tags) => {
                if (!Array.isArray(tags) || tags.length === 0) return null;
                const names = tags.map(t => {
                    if (typeof t === 'string') return t;
                    if (t.Name) return t.Name;
                    if (t.ID) return `Tag ID: ${t.ID}`;
                    return 'Tagged';
                }).filter(Boolean);
                return names.length > 0 ? names : null;
            };

            // Fetch customer profile Tags and Address in bulk (ID=in(...)) rather than
            // one request per customer — there are 500+ customers with active work.
            const profiles = new Map();
            const ID_CHUNK = 100; // keeps the URL short; well under the 250 pageSize
            for (const routeType of ['companies', 'individuals']) {
                const ids = customersArray
                    .filter(c => (c.type === 'Company') === (routeType === 'companies'))
                    .map(c => c.id);
                for (let i = 0; i < ids.length; i += ID_CHUNK) {
                    try {
                        const chunk = ids.slice(i, i + ID_CHUNK).join(',');
                        const custRes = await getSimpro(`/api/v1.0/companies/${COMPANY_ID}/customers/${routeType}/?ID=in(${chunk})&pageSize=250&columns=ID,Tags,Address`);
                        for (const p of custRes.data || []) profiles.set(p.ID, p);
                    } catch (e) {
                        // Ignore lookup errors — those customers just stay unenriched
                    }
                }
            }

            for (const c of customersArray) {
                const p = profiles.get(c.id);
                if (!p) continue;

                // Strictly filter down to only tags containing "testing" (which catches both TESTING and NON TESTING)
                const testingTags = (getTagNames(p.Tags) || []).filter(t => t.toLowerCase().includes('testing'));
                if (testingTags.length > 0) {
                    c.priority = true;
                    c.priorityTags = testingTags;
                }

                if (p.Address && p.Address.PostalCode) {
                    c.postcode = p.Address.PostalCode;
                }
            }

            cache.customers = customersArray;
            cache.customersTime = Date.now();
        }

        // 3. Perform Case-Insensitive Name & Postcode Search
        let filtered = cache.customers;
        if (q.length >= 2) {
            const lowerQ = q.toLowerCase();
            filtered = cache.customers.filter(c =>
                c.name.toLowerCase().includes(lowerQ) ||
                (c.postcode && c.postcode.toLowerCase().includes(lowerQ))
            );

            // FALLBACK: If we have few results, query simPRO directly for this name OR site
            if (filtered.length < 10) {
                try {
                    // 1. Search Customers (Standard fuzzy search)
                    const liveRes = await getSimpro(`/api/v1.0/companies/${COMPANY_ID}/customers/?Search=${encodeURIComponent(q)}&pageSize=20`);

                    // 2. Search Sites (High Precision wildcard search)
                    const siteRes = await getSimpro(`/api/v1.0/companies/${COMPANY_ID}/sites/?Name=%25${encodeURIComponent(q)}%25&pageSize=50`);

                    const liveCustomers = []; // Customers found via site get top priority
                    const fuzzyCustomers = liveRes.data || [];

                    // Process matching sites and fetch their customers
                    if (siteRes.data && siteRes.data.length > 0) {
                        for (const sMatch of siteRes.data) {
                            try {
                                const siteDetailRes = await getSimpro(`/api/v1.0/companies/${COMPANY_ID}/sites/${sMatch.ID}`);
                                const site = siteDetailRes.data;

                                let custId = site.Customer?.ID;
                                let custType = site.Customer?.Type;

                                if (!custId && site.Customers && site.Customers.length > 0) {
                                    custId = site.Customers[0].ID;
                                    custType = site.Customers[0].Type;
                                }

                                if (custId) {
                                    if (!liveCustomers.find(c => String(c.ID) === String(custId))) {
                                        const typePath = (custType || 'Company').toLowerCase() === 'individual' ? 'individuals' : 'companies';
                                        const custDetail = await getSimpro(`/api/v1.0/companies/${COMPANY_ID}/customers/${typePath}/${custId}`);
                                        if (custDetail.data) {
                                            custDetail.data._foundViaSite = true;
                                            liveCustomers.push(custDetail.data);
                                        }
                                    }
                                }
                            } catch (detailErr) {
                                console.error(`[SEARCH DEBUG ERROR] Failed site-customer resolution #${sMatch.ID}: ${detailErr.message}`);
                            }
                        }
                    }

                    // 3. Process All Found (Site Matches + Fuzzy Matches)
                    const liveResults = [];

                    // Priority: Site Matches
                    for (const lc of liveCustomers) {
                        const isCompany = !!(lc.CompanyName || (lc.Name && !lc.GivenName));
                        const cName = lc.CompanyName || lc.Name || `${lc.GivenName || ''} ${lc.FamilyName || ''}`.trim();
                        liveResults.push({
                            id: lc.ID,
                            name: cName,
                            type: isCompany ? 'Company' : 'Individual',
                            priority: true,
                            overdue: false,
                            postcode: lc.Address?.PostalCode || 'N/A',
                            latestActivity: 0,
                            isLiveFallback: true,
                            foundViaSite: true
                        });
                    }

                    // Fuzzy Matches
                    for (const lc of fuzzyCustomers) {
                        if (!liveResults.find(r => String(r.id) === String(lc.ID))) {
                            const isCompany = !!(lc.CompanyName || (lc.Name && !lc.GivenName));
                            const cName = lc.CompanyName || lc.Name || `${lc.GivenName || ''} ${lc.FamilyName || ''}`.trim();
                            liveResults.push({
                                id: lc.ID,
                                name: cName,
                                type: isCompany ? 'Company' : 'Individual',
                                priority: false,
                                overdue: false,
                                postcode: lc.Address?.PostalCode || 'N/A',
                                latestActivity: 0,
                                isLiveFallback: true
                            });
                        }
                    }

                    // Merge liveResults into filtered (Live results get priority)
                    const finalMerged = [...liveResults];
                    for (const f of filtered) {
                        if (!finalMerged.find(r => String(r.id) === String(f.id))) {
                            finalMerged.push(f);
                        }
                    }
                    filtered = finalMerged;
                } catch (e) {
                    console.error(`[SEARCH FALLBACK ERROR] ${e.message}`);
                }
            }
        }

        // 4. Arrange: Ensure only a max of 10 clients are prioritized
        let majorCount = 0;
        const results = filtered.map(c => {
            if (c.priority) {
                if (majorCount < 10) {
                    majorCount++;
                    return c;
                } else {
                    return { ...c, priority: false, priorityTags: null };
                }
            }
            return c;
        }).slice(0, 50);
        res.json({ results, cacheTime: cache.customersTime });
    } catch (err) {
        console.error(`[CUSTOMER SEARCH ERROR] ${err.message}`);
        res.json({ results: [], error: err.message });
    }
});

// Customer Jobs endpoint (get jobs for a specific customer)
customersRouter.get('/api/customers/:id/jobs', async (req, res) => {
    const custId = req.params.id;
    console.log(`[GET] /api/customers/${custId}/jobs`);
    if (req.query.force !== '1') {
        const hit = _custJobsCache.get(custId);
        if (hit && (Date.now() - hit.t) < CUST_JOBS_TTL_MS) return res.json({ jobs: hit.jobs, cached: true });
    }
    try {
        const jobsRes = await getSimpro(`/api/v1.0/companies/${COMPANY_ID}/jobs/?Customer.ID=${custId}&pageSize=30&orderby=-ID&columns=ID,Name,Site,Stage,DateIssued`);

        const validStages = ['Pending', 'Progress', 'Completed', 'Invoiced'];
        const jobs = (jobsRes.data || [])
            .filter(j => validStages.includes(j.Stage))
            .map(j => ({
                id: j.ID,
                name: j.Name || `Job #${j.ID}`,
                site: j.Site?.Name || 'Unknown Site',
                stage: j.Stage === 'Progress' ? 'In Progress' : (j.Stage || 'Unknown'),
                date: j.DateIssued ? new Date(j.DateIssued).toLocaleDateString('en-AU') : '—',
                rawDate: j.DateIssued || '0'
            }))
            .sort((a, b) => {
                const getScore = (s) => {
                    const sl = (s || '').toLowerCase();
                    if (sl.includes('progress')) return 1;
                    if (sl.includes('pending')) return 2;
                    if (sl.includes('completed')) return 3;
                    if (sl.includes('invoiced')) return 4;
                    return 5;
                };
                const scoreA = getScore(a.stage);
                const scoreB = getScore(b.stage);
                if (scoreA !== scoreB) return scoreA - scoreB;
                return parseInt(b.id) - parseInt(a.id);
            });

        _custJobsCache.set(custId, { t: Date.now(), jobs });
        res.json({ jobs });
    } catch (err) {
        console.error(`[CUSTOMER JOBS ERROR] ${err.message}`);
        res.json({ jobs: [], error: err.message });
    }
});

// Latest job endpoint — returns the most recently modified active job
customersRouter.get('/api/latest-job', async (req, res) => {
    try {
        const category = req.query.category; // 'major' or 'regular'
        const customer = req.query.customer;

        if (category && cache.customers) {
            const isMajor = category === 'major';

            // Use cache insertion order (already sorted by latestActivity desc at build time)
            // Apply same 10-major cap as the search modal display
            let majorCount = 0;
            const displayList = cache.customers.map(c => {
                if (c.priority) {
                    if (majorCount < 10) { majorCount++; return c; }
                    return { ...c, priority: false };
                }
                return c;
            });

            // Top customer in the category = first in display list (most recently active)
            const topCustomer = displayList.find(c => isMajor ? c.priority : !c.priority);
            if (!topCustomer || !topCustomer.latestJobId) return res.json({ jobId: null });

            // Job ID and site are stored directly in cache — no re-scan needed
            return res.json({
                jobId: topCustomer.latestJobId,
                client: topCustomer.name,
                site: topCustomer.latestSite || 'Unknown',
                modified: topCustomer.latestActivity ? new Date(topCustomer.latestActivity).toISOString() : null
            });
        }

        const customerFilter = customer ? `&Customer.CompanyName=${encodeURIComponent(customer)}` : '';
        const jobsRes = await getSimpro(`/api/v1.0/companies/${COMPANY_ID}/jobs/?Stage=in(Pending,Progress)&pageSize=1&orderby=-DateModified&columns=ID,Name,Customer,Site,DateModified${customerFilter}`);
        const job = jobsRes.data?.[0];
        if (!job) return res.json({ jobId: null, message: 'No active jobs found' });
        res.json({
            jobId: job.ID,
            client: job.Customer?.CompanyName || job.Customer?.Name || 'Unknown',
            site: job.Site?.Name || 'Unknown',
            modified: job.DateModified || null
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

customersRouter.get('/api/debug-cache', (req, res) => {
    if (!cache.customers) return res.json({ error: 'Cache not built yet — open Search Customers first' });
    const top20 = cache.customers.slice(0, 20).map(c => ({
        id: c.id,
        name: c.name,
        priority: c.priority,
        latestJobId: c.latestJobId,
        latestSite: c.latestSite,
        latestActivity: c.latestActivity ? new Date(c.latestActivity).toISOString() : null
    }));
    res.json({ total: cache.customers.length, top20 });
});
