// Core FPOW data aggregation: assembles a full job/site/customer picture from
// simPRO, and keeps asset service dates in sync as a background task.
import axios from 'axios';
import { SIMPRO_BASE_URL, SIMPRO_ACCESS_TOKEN, COMPANY_ID, SIMPRO_READ_ONLY } from '../config.js';
import { getSimpro } from './simpro.js';
import { cleanDescriptionForClient, fullDescriptionForStaff } from './text.js';

/**
 * Background Service: Sync Asset Service Dates back to simPRO
 * This ensures that when a job is processed, the next service date is automatically set in the DB.
 */
export async function syncAssetDates(siteId, jobDate, jobType) {
    if (!siteId) return;
    if (SIMPRO_READ_ONLY) {
        console.log(`[AUTO-SYNC] Skipped — SIMPRO_READ_ONLY=1 (no writes to simPRO)`);
        return;
    }

    try {
        console.log(`[AUTO-SYNC] Starting asset sync for Site #${siteId} (Type: ${jobType}, Date: ${jobDate})`);

        // 1. Calculate the Target Next Date
        const baseDate = new Date(jobDate);
        if (isNaN(baseDate.getTime())) return;

        // Move to the same day next cycle
        if (jobType === "12 Monthly") {
            baseDate.setFullYear(baseDate.getFullYear() + 1);
        } else {
            baseDate.setMonth(baseDate.getMonth() + 6);
        }

        // Format to YYYY-MM-DD for simPRO
        const nextDateStr = baseDate.toISOString().split('T')[0];
        console.log(`[AUTO-SYNC] Target Next Date: ${nextDateStr}`);

        // 2. Fetch Customer Assets for this Site (Returns ServiceLevels INLINE)
        const assetsRes = await getSimpro(`/api/v1.0/companies/${COMPANY_ID}/customerAssets/?Site.ID=${siteId}&pageSize=250`);
        if (!assetsRes.data || assetsRes.data.length === 0) return;

        for (const asset of assetsRes.data) {
            try {
                // 3. Extract Inline Service Levels
                const serviceLevels = asset.ServiceLevels || [];
                if (serviceLevels.length === 0) continue;

                for (const sl of serviceLevels) {
                    const slName = (sl.Name || "").toLowerCase();
                    const isAnnualMatch = jobType === "12 Monthly" && (slName.includes("annual") || slName.includes("12 month") || slName.includes("yearly") || slName.includes("12month"));
                    const is6MonthMatch = jobType === "6 Monthly" && (slName.includes("6 month") || slName.includes("6month") || slName.includes("bi-annual") || slName.includes("half year") || slName.includes("semi-annual"));

                    if (isAnnualMatch || is6MonthMatch) {
                        // 4. Update if the date is different (Standardizes to /customerAssets/ endpoint)
                        const dateStr = sl.ServiceDate || sl.NextDate || "";
                        if (dateStr !== nextDateStr) {
                            console.log(`[AUTO-SYNC] Updating Asset #${asset.ID} Service Level #${sl.ID} to ${nextDateStr}`);
                            await axios.patch(`${SIMPRO_BASE_URL}/api/v1.0/companies/${COMPANY_ID}/customerAssets/${asset.ID}/serviceLevels/${sl.ID}/`,
                                { ServiceDate: nextDateStr, NextDate: nextDateStr },
                                { headers: { 'Authorization': `Bearer ${SIMPRO_ACCESS_TOKEN}` } }
                            );
                        }
                    }
                }
            } catch (e) {
                console.error(`[AUTO-SYNC ERROR] Failed asset #${asset.ID}: ${e.message}`);
            }
        }
        console.log(`[AUTO-SYNC] Completed for Site #${siteId}`);
    } catch (err) {
        console.error(`[AUTO-SYNC CRITICAL ERROR]: ${err.message}`);
    }
}

/**
 * Shared logic for data aggregation.
 * Can be called by the MCP tool or the REST API.
 */
// Short-TTL in-memory cache for aggregated job data. Opening a job fires many
// simPRO calls; caching collapses repeated opens / back-and-forth navigation so
// we don't re-hit simPRO every time (rate-limit protection). Pass { force: true }
// (e.g. the Reload button) to bypass and fetch fresh.
const _jobCache = new Map();
const JOB_CACHE_TTL_MS = parseInt(process.env.JOB_CACHE_TTL_MS || '45000', 10);

export const fetchFpowData = async (jobId, opts = {}) => {
    const _cacheKey = String(jobId);
    if (!opts.force) {
        const _hit = _jobCache.get(_cacheKey);
        if (_hit && (Date.now() - _hit.t) < JOB_CACHE_TTL_MS) return _hit.data;
    }
    const jobRes = await getSimpro(`/api/v1.0/companies/${COMPANY_ID}/jobs/${jobId}`);
    const jobData = jobRes.data;

    // 1. Site Info
    let siteName = jobData.Site?.Name || "Site Details Not Found";
    let siteArea = "N/A";
    let afssFromNotes = null;
    if (jobData.Site?.ID) {
        try {
            const siteRes = await getSimpro(`/api/v1.0/companies/${COMPANY_ID}/sites/${jobData.Site.ID}?columns=Address,PublicNotes`);
            if (siteRes.data && siteRes.data.Address) {
                const addr = siteRes.data.Address;
                const isAustralia = !addr.Country || addr.Country.toLowerCase().includes('australia');
                if (isAustralia) {
                    const suburb = addr.City || "";
                    const state = addr.State || "";
                    const postcode = addr.PostalCode || "";
                    siteArea = `${suburb}${suburb && (state || postcode) ? ', ' : ''}${state}${state && postcode ? ' ' : ''}${postcode}`.trim();
                } else {
                    siteArea = "Non-Australian Site";
                }
            }
            // Parse AFSS due date from site Public Notes
            if (siteRes.data?.PublicNotes) {
                const notesText = siteRes.data.PublicNotes.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&');
                // Match: "AFSS DUE DATE - 20th of June 2026" or "AFSS DUE - 20/06/2026" or "AFSS DUE DATE 20 June 2026"
                const afssMatch = notesText.match(/AFSS\s+DUE(?:\s+DATE)?\s*[-:]?\s*(\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i);
                if (afssMatch) {
                    const raw = afssMatch[1].replace(/(?:st|nd|rd|th)\s+of\s+/i, ' ').replace(/(?:st|nd|rd|th)\s+/i, ' ').trim();
                    const parsed = new Date(raw);
                    if (!isNaN(parsed)) afssFromNotes = parsed.toLocaleDateString('en-AU');
                }
            }
        } catch (e) {}
    }

    // 2. Contact Parse
    // Strip HTML tags and extract plain text from a potentially HTML-encoded simPRO field
    const stripHtml = (val) => {
        if (!val) return "";
        return val.toString()
            .replace(/<[^>]+>/g, ' ')       // complete tags: <span style="...">
            .replace(/^[^<>]*">\s*/gm, '')  // partial tag remnants at line start: 10pt;">
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/\s+/g, ' ')
            .trim();
    };
    // For phone: strip HTML remnants AND any "Phone Number:" label simPRO embeds
    const cleanPhone = (val) => {
        if (!val) return "";
        let v = val.toString()
            .replace(/<[^>]+>/g, ' ')
            .replace(/^[^<>]*">\s*/gm, '')  // strip partial tag ending e.g. 10pt;">
            .replace(/Phone\s*Number\s*[:\-]?\s*/i, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        // Last resort: if value still has non-phone junk, extract the digit sequence
        if (v && !/^[\d\+\(]/.test(v)) {
            const digits = v.match(/[\d][\d\s\-\(\)]{5,}/);
            if (digits) v = digits[0].trim();
        }
        return v;
    };

    let contactSource = jobData.Contact?.Name ? "simpro_direct" : "not_found";
    const desc = jobData.Description || "";
    const nameMatch = desc.match(/Name:\s*([^<\n\r]+)/i);
    const phoneMatch = desc.match(/Phone[^:]*:\s*([^<\n\r]+)/i);
    const emailMatch = desc.match(/Email:\s*([^<\n\r]+)/i);

    let contactName = stripHtml(jobData.Contact?.Name) || (nameMatch ? (contactSource = "description", nameMatch[1].trim()) : "");
    let contactPhone = cleanPhone(jobData.Contact?.Phone) || (phoneMatch ? (contactSource = "description", cleanPhone(phoneMatch[1])) : "");
    let contactEmail = stripHtml(jobData.Contact?.Email) || (emailMatch ? (contactSource = "description", emailMatch[1].trim()) : "");

    if (!contactName && jobData.Site?.ID) {
        try {
            const scRes = await getSimpro(`/api/v1.0/companies/${COMPANY_ID}/sites/${jobData.Site.ID}/contacts/`);
            if (scRes.data && scRes.data.length > 0) {
                // Filter out internal-note entries: timestamps, asterisks, "DO NOT CALL", very long strings
                const isInternalNote = (name) => !name || name.length > 80
                    || /\d{1,2}:\d{2}\s+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/.test(name)
                    || /^\*/.test(name.trim())
                    || /do not call/i.test(name);

                const validContacts = scRes.data
                    .map(c => {
                        const n = `${c.GivenName || ''} ${c.FamilyName || ''}`.trim();
                        const p = cleanPhone(c.Phone || c.Mobile || "");
                        return { name: n, phone: p };
                    })
                    .filter(c => c.name && !isInternalNote(c.name));

                if (validContacts.length > 0) {
                    // Join ALL valid contacts so every name and phone is visible
                    contactName = validContacts.map(c => c.name).join(' / ');
                    if (!contactPhone) contactPhone = validContacts.map(c => c.phone).filter(Boolean).join(' / ');
                    contactSource = "site_contacts";
                }
            }
        } catch (e) {}
    }

    // 3. Customer Info (Improved Individual Handling)
    let clientName = jobData.Customer?.CompanyName || jobData.Customer?.Name || "Client Not Found";
    if (jobData.Customer?.ID) {
        try {
            // simPRO has no /customers/{id}; the route is typed (companies|individuals)
            const custType = (jobData.Customer.Type || '').toLowerCase() === 'individual' ? 'individuals' : 'companies';
            const custRes = await getSimpro(`/api/v1.0/companies/${COMPANY_ID}/customers/${custType}/${jobData.Customer.ID}`);
            const cust = custRes.data;
            if (cust.CompanyName) {
                clientName = cust.CompanyName;
            } else if (cust.GivenName || cust.FamilyName) {
                clientName = `${cust.GivenName || ''} ${cust.FamilyName || ''}`.trim();
            } else {
                clientName = cust.Name || clientName;
            }
        } catch (e) {}
    }

    // 4. Site-Wide Aggregation (Filtered by Customer to prevent cross-account confusion)
    const siteId = jobData.Site ? jobData.Site.ID : null;
    const customerId = jobData.Customer ? jobData.Customer.ID : null;
    const outstandingWorks = [];

    if (siteId) {
        try {
            let siteJobsUrl = `/api/v1.0/companies/${COMPANY_ID}/jobs/?Site.ID=${siteId}&pageSize=50`;
            if (customerId) siteJobsUrl += `&Customer.ID=${customerId}`;

            const jobsRes = await getSimpro(siteJobsUrl);
            if (jobsRes.data && jobsRes.data.length > 0) {
                // Optimize: Fetch all job details in parallel to speed up the report
                const jobDetails = await Promise.all(jobsRes.data.map(async (j) => {
                    try {
                        const detailRes = await getSimpro(`/api/v1.0/companies/${COMPANY_ID}/jobs/${j.ID}`);
                        const dj = detailRes.data;

                        // STRICT STATUS FILTER: Whitelist ONLY Pending and Progress
                        if (dj.Stage) {
                            const st = dj.Stage.toLowerCase();
                            if (!(st.includes('pending') || st.includes('progress'))) {
                                return null;
                            }
                        }

                        // Use only Description — Notes is internal staff notes (e.g. "14:32 01/06/2026 Geffrey Go"), not scope of work
                        const rawDesc = (dj.Description || "");

                        // Fetch sections — used for Issue description fallback and Equipment Type
                        let sectionDesc = "";
                        let sectionCostCenterName = "";
                        let sectionCostCenterDesc = "";
                        let _sectionId = null;
                        let _costCenterId = null;
                        try {
                            const secRes = await getSimpro(`/api/v1.0/companies/${COMPANY_ID}/jobs/${j.ID}/sections/`);
                            if (secRes.data?.[0]) {
                                _sectionId = secRes.data[0].ID;
                                sectionDesc = secRes.data[0].Description || "";
                                const ccRes = await getSimpro(`/api/v1.0/companies/${COMPANY_ID}/jobs/${j.ID}/sections/${_sectionId}/costCenters/`);
                                if (ccRes.data?.[0]) {
                                    _costCenterId = ccRes.data[0].ID;
                                    sectionCostCenterName = ccRes.data[0].Name || ccRes.data[0].CostCenter?.Name || "";
                                    sectionCostCenterDesc = ccRes.data[0].Description || ccRes.data[0].CostCenter?.Description || "";
                                }
                            }
                        } catch (e) {}

                        // Filter out scheduling-label names/descriptions like "JUNE WEEK 4"
                        const schedulingLabelRe = /^(JAN|FEB|MAR|APR|MAY|JUN|JUNE|JUL|JULY|AUG|SEP|OCT|NOV|DEC)\s+WEEK\s+\d+/i;
                        const isSchedulingContent = (text) => !!text && schedulingLabelRe.test(text.trim()) && !text.includes('\n');
                        const isSchedulingName = dj.Name && schedulingLabelRe.test(dj.Name.trim());
                        // Returns true when the ENTIRE text is a bare service-type label (single line)
                        const isServiceLabelText = (text) => !!text && /^(weekly|monthly|annual|bi-?annual|quarterly|daily)\s+(service|maintenance|inspection|test|check)\s*$/i.test(text.trim());
                        // Returns true when text has NO real content — every line is a known boilerplate pattern
                        const boilerplateLinePatterns = [
                            /^(weekly|monthly|annual|bi-?annual|quarterly|daily)\s+(service|maintenance|inspection|test|check)/i,
                            /^techs attending/i, /^attendance confirmed by/i,
                            /^name:\s*$/i, /^phone/i, /^email:\s*$/i,
                            /^site contacts?:\s*$/i, /^contact:\s*$/i,
                            /^scheduled\s+(time|date):\s*$/i, /^osa name:\s*$/i,
                            /^access instructions/i, /^parking instructions/i,
                            /^materials.*:\s*$/i, /^scope:\s*$/i, /^signage:\s*$/i,
                            /^deliverables:\s*$/i, /^redmen fire protection scope of works/i,
                            /^(qualified\s+)?technician[s\/]*\s+to attend site/i,
                            /^\d{1,2}:\d{2}\s+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/,
                            /^[•\-\*]+\s*$/, /^\d+\s*x\s+/i,
                        ];
                        const isAllBoilerplate = (text) => {
                            if (!text) return true;
                            const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
                            return lines.length === 0 || lines.every(l => boilerplateLinePatterns.some(re => re.test(l)));
                        };
                        const cleanedRawDesc = cleanDescriptionForClient(rawDesc);
                        const cleanedSectionDesc = cleanDescriptionForClient(sectionDesc);
                        const cleanedCostCenterDesc = cleanDescriptionForClient(sectionCostCenterDesc);
                        const notesDesc = cleanDescriptionForClient(dj.Notes || "");
                        const staffDesc = fullDescriptionForStaff(rawDesc);
                        // Build primary description — skip entries that are entirely boilerplate
                        const primaryDesc = (!isSchedulingContent(cleanedRawDesc) && !isAllBoilerplate(cleanedRawDesc) ? cleanedRawDesc : null)
                            || (!isSchedulingContent(cleanedSectionDesc) && !isAllBoilerplate(cleanedSectionDesc) ? cleanedSectionDesc : null)
                            || (!isSchedulingContent(cleanedCostCenterDesc) && !isAllBoilerplate(cleanedCostCenterDesc) ? cleanedCostCenterDesc : null)
                            || (!isAllBoilerplate(staffDesc) ? staffDesc : null);

                        // Option B: if still no real description, fetch section line items as last resort
                        let lineItemsDesc = null;
                        if ((!primaryDesc || isAllBoilerplate(primaryDesc)) && !notesDesc && _sectionId && _costCenterId) {
                            try {
                                const itemsRes = await getSimpro(`/api/v1.0/companies/${COMPANY_ID}/jobs/${j.ID}/sections/${_sectionId}/costCenters/${_costCenterId}/items/?columns=ID,Name,Description`);
                                if (itemsRes.data && itemsRes.data.length > 0) {
                                    const tasks = itemsRes.data
                                        .map(item => (item.Description || item.Name || "").trim())
                                        .filter(n => n && !/^\d+$/.test(n) && n.length > 2)
                                        .slice(0, 6);
                                    if (tasks.length > 0) lineItemsDesc = tasks.join('\n');
                                }
                            } catch (e) {}
                        }

                        const combinedParts = [primaryDesc, lineItemsDesc, notesDesc].filter(Boolean);
                        const isServiceLabel = isServiceLabelText((dj.Name || "").trim());
                        const descFormatted = (combinedParts.length > 0 ? combinedParts.join('\n') : null)
                            || (!isSchedulingName && !isServiceLabel && dj.Name && !/^\d+$/.test(dj.Name) && dj.Name.trim().includes(' ') ? dj.Name : null)
                            || "Qualified technician to attend site to carry out the following works:";

                        // Determine a professional [STATUS] for the client POV
                        let displayStatus = 'PENDING';
                        if (dj.Stage) {
                            const stage = dj.Stage.toLowerCase();
                            if (stage.includes('progress')) displayStatus = 'IN PROGRESS';
                            if (stage.includes('complete')) displayStatus = 'COMPLETED';
                        }
                        if (rawDesc.toLowerCase().includes('scheduled for')) displayStatus = 'SCHEDULED';


                        let sq = dj.Quote ? dj.Quote.ID : "";

                        // Equipment Type — reuse already-fetched section data
                        let rawEq = (dj.Service?.Name || dj.Name || "").trim();
                        let eqType = /^\d+$/.test(rawEq) ? "" : rawEq;

                        if (!eqType || eqType.toLowerCase().includes("general")) {
                            if (sectionCostCenterName) {
                                eqType = sectionCostCenterName.replace(/\s*(?:Division|Sales|Income|Division Income|Center)\s*$/i, "").trim();
                            }
                        }
                        if (!eqType) eqType = rawEq || "Service Job";

                        // Matches (simplified for speed)
                        const darnMatch = (dj.Description || "").match(/DARN\W*(?:form|no|number|#|id)*\W*([A-Z0-9-]*\d+[A-Z0-9-]*)/i);
                        const quoteMatch = (dj.Description || "").match(/Quote\W*(?:form|no|number|#|id)*\W*([A-Z0-9-]*\d+[A-Z0-9-]*)/i);

                        return {
                            Date: dj.DateIssued ? new Date(dj.DateIssued).toLocaleDateString('en-AU') : "",
                            EquipmentType: eqType,
                            Issue: descFormatted,
                            DisplayStatus: displayStatus,
                            Lead: dj.Lead ? `#${dj.Lead.ID}` : "",
                            DARN: darnMatch ? darnMatch[1] : "",
                            Quote: dj.Quote ? `#${dj.Quote.ID}` : (quoteMatch ? `#${quoteMatch[1]}` : ""),
                            Job: j.ID ? `#${j.ID}` : "",
                            Comment: "",
                            Status: displayStatus
                        };
                    } catch (e) { return null; }
                }));

                outstandingWorks.push(...jobDetails.filter(Boolean));
            }

            // Sort by Status Hierarchy: 1. IN PROGRESS, 2. PENDING
            outstandingWorks.sort((a, b) => {
                const getPriority = (status) => {
                    const s = (status || "").toLowerCase();
                    if (s === 'in progress') return 1;
                    if (s === 'pending') return 2;
                    return 3;
                };

                const pA = getPriority(a.Status);
                const pB = getPriority(b.Status);

                if (pA !== pB) return pA - pB;

                // Secondary sort: Newest Job/Quote ID first
                const idA = parseInt((a.Job || a.Quote || "0").replace(/\D/g, ''));
                const idB = parseInt((b.Job || b.Quote || "0").replace(/\D/g, ''));
                return idB - idA;
            });
        } catch (err) {
            console.error(`Aggregation error: ${err.message}`);
        }
    }

    // --- Dynamic Asset Date Discovery (Improved for Portfolio Accuracy) ---
    let liveSixMo = { Month: "", Year: "", rawDate: null, Source: "—" };
    let liveTwelveMo = { Month: "", Year: "", rawDate: null, Source: "—" };

    if (siteId) {
        try {
            const custAssetsRes = await getSimpro(`/api/v1.0/companies/${COMPANY_ID}/customerAssets/?Site.ID=${siteId}&pageSize=100`);

            if (custAssetsRes.data && custAssetsRes.data.length > 0) {
                for (const asset of custAssetsRes.data) {
                    if (!asset.ServiceLevels) continue;

                    for (const sl of asset.ServiceLevels) {
                        const dateStr = sl.ServiceDate || sl.NextDate || "";
                        if (!dateStr) continue;

                        const slName = (sl.Name || "").toLowerCase();
                        const slDate = new Date(dateStr);
                        if (isNaN(slDate.getTime())) continue;

                        const isAnnual = slName.includes("annual") || slName.includes("12 month") || slName.includes("yearly") || slName.includes("12month");
                        const is6Mo = slName.includes("6 month") || slName.includes("6month") || slName.includes("bi-annual") || slName.includes("half year") || slName.includes("semi-annual");

                        if (isAnnual) {
                            if (!liveTwelveMo.rawDate || slDate < liveTwelveMo.rawDate) {
                                liveTwelveMo.rawDate = slDate;
                                liveTwelveMo.Month = slDate.toLocaleString('default', { month: 'long' });
                                liveTwelveMo.Year = slDate.getFullYear().toString();
                                liveTwelveMo.Source = "Live Asset";
                            }
                        } else if (is6Mo) {
                            if (!liveSixMo.rawDate || slDate < liveSixMo.rawDate) {
                                liveSixMo.rawDate = slDate;
                                liveSixMo.Month = slDate.toLocaleString('default', { month: 'long' });
                                liveSixMo.Year = slDate.getFullYear().toString();
                                liveSixMo.Source = "Live Asset";
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error(`[ASSET DISCOVERY ERROR] Site #${siteId}: ${e.message}`);
        }
    }

    // FALLBACK: If live dates are still empty, use the current Job's date as a reference
    const jobType = (jobData.Name || "").toLowerCase().includes('12 monthly') ? "12 Monthly" : "6 Monthly";
    const jobRefDate = jobData.DateIssued ? new Date(jobData.DateIssued) : new Date();

    if (!liveSixMo.Month) {
        liveSixMo.Month = "—";
        liveSixMo.Year = "—";
        liveSixMo.Source = "Not found in assets";
    }
    if (!liveTwelveMo.Month) {
        liveTwelveMo.Month = "—";
        liveTwelveMo.Year = "—";
        liveTwelveMo.Source = "Not found in assets";
    }

    const result = {
        JobID: parseInt(jobId),
        Site: siteName,
        SiteArea: siteArea,
        SiteContact: { Name: contactName || clientName, Phone: contactPhone, Email: contactEmail, Source: contactSource },
        Client: clientName,
        DateCompleted: new Date().toLocaleDateString('en-AU'),
        DateCallMade: jobData.DateIssued ? new Date(jobData.DateIssued).toLocaleDateString('en-AU') : "Not Issued",
        AFSSDue: afssFromNotes || "No AFSS Due",
        ServiceDue: {
            Type: jobType,
            Month: jobRefDate.toLocaleString('default', { month: 'long' }),
            Year: jobRefDate.getFullYear(),
            LiveSixMo: liveSixMo,
            LiveTwelveMo: liveTwelveMo
        },
        OutstandingWorks: outstandingWorks,
        SiteID: siteId
    };

    // 5. Initiate Background Asset Sync (Do not await, keep it fast for the user)
    if (jobData.DateIssued && siteId) {
        syncAssetDates(siteId, jobData.DateIssued, jobType).catch(e => console.error("AutoSync catch:", e));
    }

    _jobCache.set(_cacheKey, { t: Date.now(), data: result });
    return result;
};
