// simPRO API client: a single GET helper with a concurrency cap (so bursts
// don't blow past the API rate limit) and rate-limit (429) retry/backoff.
import axios from 'axios';
import { SIMPRO_BASE_URL, SIMPRO_ACCESS_TOKEN } from '../config.js';

// ── Concurrency limiter ──────────────────────────────────────────────────
// Never let more than N simPRO requests be in flight at once. This throttles
// bursts (e.g. fetchFpowData's parallel job-detail lookups, or the daily
// report scanning the whole portfolio) so we stay under simPRO's rate limit.
const MAX_CONCURRENT = parseInt(process.env.SIMPRO_MAX_CONCURRENT || '5', 10);
let _active = 0;
const _waiters = [];
function _acquire() {
    return new Promise(resolve => {
        if (_active < MAX_CONCURRENT) { _active++; resolve(); }
        else _waiters.push(resolve);
    });
}
function _release() {
    const next = _waiters.shift();
    if (next) next();               // hand the freed slot to a waiter (active unchanged)
    else _active = Math.max(0, _active - 1);
}

export const getSimpro = async (path, retries = 3, delayMs = 1500, _held = false) => {
    if (!SIMPRO_BASE_URL) throw new Error("SIMPRO_BASE_URL not configured");
    if (!_held) await _acquire();   // wait for a free slot (retries keep their slot)
    const rawUrl = `${SIMPRO_BASE_URL.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
    console.log(`[simPRO FETCH] URL: ${rawUrl}`);
    try {
        const validatedUrl = new URL(rawUrl).toString();
        const response = await axios.get(validatedUrl, {
            headers: {
                'Authorization': `Bearer ${SIMPRO_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 15000
        });
        console.log(`[simPRO SUCCESS] ${path} -> ${response.status}`);
        return response;
    } catch (urlErr) {
        if (urlErr.response && urlErr.response.status === 429 && retries > 0) {
            console.warn(`[simPRO RATE LIMIT] 429 on ${path}. Retrying in ${delayMs}ms...`);
            await new Promise(res => setTimeout(res, delayMs));
            // keep holding the slot through the backoff so we don't burst on retry
            return await getSimpro(path, retries - 1, delayMs * 2, true);
        }
        console.error(`[simPRO ERROR] ${path} -> ${urlErr.message}`);
        throw urlErr;
    } finally {
        if (!_held) _release();
    }
};

// Fetch every page of a simPRO list endpoint and return the concatenated rows.
// simPRO caps pageSize at 250 and reports the page count in `Result-Pages`.
export const getSimproAll = async (path, pageSize = 250) => {
    const sep = path.includes('?') ? '&' : '?';
    const pageUrl = (page) => `${path}${sep}pageSize=${pageSize}&page=${page}`;
    const first = await getSimpro(pageUrl(1));
    const pages = parseInt(first.headers?.['result-pages'] || '1', 10) || 1;
    const rest = await Promise.all(
        Array.from({ length: pages - 1 }, (_, i) => getSimpro(pageUrl(i + 2)))
    );
    return [first, ...rest].flatMap(r => r.data || []);
};
