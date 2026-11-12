        const $ = id => document.getElementById(id);

        function getOverdueText(latestActivity) {
            if (!latestActivity) return '';
            const diff = Date.now() - latestActivity;
            const daysTotal = Math.floor(diff / (1000 * 60 * 60 * 24));
            if (daysTotal < 1) return 'LAST SEEN TODAY';
            
            const months = Math.floor(daysTotal / 30);
            const days = daysTotal % 30;
            
            let parts = [];
            if (months > 0) parts.push(`${months} month${months > 1 ? 's' : ''}`);
            if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
            
            return 'OVERDUE ' + parts.join(' ');
        }

        async function initSchedules() {
            try {
                const res = await fetch('/api/schedules/today');
                const data = await res.json();
                const select = $('schedule-select');
                if (data.schedules && data.schedules.length > 0) {
                    select.innerHTML = '<option value="">-- Select Recent Job --</option>' +
                        data.schedules.map(j => `<option value="${j.jobId}">${j.client} (${j.jobId})</option>`).join('');
                } else {
                    select.innerHTML = '<option value="">No jobs scheduled for today</option>';
                }
            } catch (err) {
                console.error("Failed to load schedules:", err);
                $('schedule-select').innerHTML = '<option value="">Error loading jobs</option>';
            }
        }
        const setVal = (id, val) => {
            const el = $(id);
            if (el) el.innerHTML = val || '<span class="placeholder-text">—</span>';
        };

        function badgeHtml(status) {
            const s = (status || '').toUpperCase();

            // Premium Dashboard Palette
            const styles = {
                'COMPLETED': 'background:#DCFCE7; color:#166534; border:1px solid #86EFAC;',
                'DONE': 'background:#DCFCE7; color:#166534; border:1px solid #86EFAC;',
                'PENDING': 'background:#FEF3C7; color:#92400E; border:1px solid #FDE68A;',
                'IN PROGRESS': 'background:#E0F2FE; color:#0369A1; border:1px solid #7DD3FC;',
                'PROGRESS': 'background:#E0F2FE; color:#0369A1; border:1px solid #7DD3FC;',
                'SCHEDULED': 'background:#F5F3FF; color:#5B21B6; border:1px solid #DDD6FE;',
                'QUOTED': 'background:#F0FDF4; color:#166534; border:1px solid #BBF7D0;'
            };

            const style = styles[s] || 'background:#F3F4F6; color:#4B5563; border:1px solid #E5E7EB;';
            const icon = {
                'COMPLETED': '', 'DONE': '', 'PENDING': '',
                'IN PROGRESS': '', 'PROGRESS': '', 'SCHEDULED': '', 'QUOTED': ''
            }[s] || '';

            return `<span class="status-badge" style="padding: 4px 10px; border-radius: 999px; font-weight: 700; font-size: 0.68rem; letter-spacing: 0.04em; display: inline-flex; align-items: center; white-space: nowrap; ${style}">${icon}${s}</span>`;
        }

        function escHtml(s) {
            return String(s == null ? '—' : s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }

        function summarizeIssue(text) {
            if (!text || !text.trim()) return '—';
            const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
            if (!lines.length) return '—';
            const skip = [
                // Attendance / scheduling headers
                /^techs attending/i,
                /^attendance confirmed by/i,
                /^please\s+(call|contact|ring|phone)\s+/i,
                /^scheduled\s+(time|date):/i,
                /^osa name:/i,
                /^number of (technician|hour)/i,
                // Contact / location labels
                /^name:/i,
                /^phone/i,
                /^email:/i,
                /^contact:/i,
                /^site contacts?:/i,
                /^site:/i,
                /^address:/i,
                /^access instructions/i,
                /^parking instructions/i,
                // Materials / tools
                /^materials\s*(\/|&|and)\s*(specialty\s+)?tools/i,
                /^materials\s*location:/i,
                // Commercial metadata
                /^quote number:/i,
                /^sell price:/i,
                /^quoted by:/i,
                /^requested by:/i,
                /^labour:/i,
                /^parts:/i,
                /^job type:/i,
                /^priority:/i,
                // Internal timestamps  e.g. "14:32 01/06/2026"
                /^\d{1,2}:\d{2}\s+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/,
                // Checklist / completion lines — not defects
                /^[xX]\s+/,
                /^\d+\s*x\s+/i,
                /^technician attended site/i,
                /^completed repairs/i,
                /^parts used/i,
                /^spoke to\s+/i,
                /^schedule confirmed/i,
                /^-\s*[a-z]/i,
                // Asset ID lines → handled separately below after skip
                // Scope / boilerplate headers
                /^redmen fire protection scope of works/i,
                /^(qualified\s+)?technician[s\/]*\s+to attend site/i,
                /^(weekly|monthly|annual|bi-?annual|quarterly|daily)\s+(service|maintenance|inspection|test|check)/i,
                /^scope of works:?\s*$/i,
                /^description:\s*$/i,
                // Bare category headers with nothing after colon e.g. "WATER:", "FIRE:"
                /^[A-Z][A-Z\s\/&]{0,25}:\s*$/,
                /^\*+$/,
                /^—+$/,
                // Bare mixed-case scope labels
                /^scope:?\s*$/i,
                /^signage:?\s*$/i,
                /^deliverables:?\s*$/i,
                // Scope-of-works boilerplate body text
                /^our proposal will assist/i,
                /^the building .* (diagrams?|plans?) (are|is) to be/i,
                /^and will indicate/i,
                /^to finalise the above/i,
                /^total\s+(cost\s+for|.*diagrams?)/i,
                // Bullet-point list items (•)
                /^[•]\s*/,
            ];
            const firstLine = lines.find(l => !skip.some(p => p.test(l)));
            if (!firstLine) return '—';
            // Asset ID lines → show "[Level] Service"
            const assetMatch = firstLine.match(/^Asset ID \d+\s*-\s*Asset Type\s+.+?\s*-\s*Service Level\s+(\S+)/i);
            if (assetMatch) return assetMatch[1].trim() + ' Service';
            // Strip leading boilerplate phrases so the real issue comes through
            const stripped = firstLine
                .replace(/^(qualified\s+)?technician to attend site and investigate\s+(the\s+)?/i, '')
                .replace(/^(qualified\s+)?technician to attend site\s+/i, '')
                .replace(/^(the\s+)?(qualified\s+)?technician[s]?\s+will\s+\w+\s+(the\s+|a\s+|an\s+)?/i, '')
                .replace(/^to re.?attend\s+(to\s+)?/i, '')
                .replace(/^to attend\s+(to\s+)?/i, '')
                .replace(/^note:\s*/i, '')
                .replace(/^and\s+/i, '')
                .replace(/^to\s+/i, '')
                // Strip prepositional tails that pad length without adding keyword value
                .replace(/\s+(shown\s+(on|in)|against\s+the|per\s+the|to\s+match|to\s+verify|using\s+the|from\s+the|at\s+the).*/i, '')
                .trim();
            const sentence = stripped.match(/^(.+?[.!?])(?:\s|$)/);
            const phrase = (sentence ? sentence[1] : stripped) || firstLine;
            const cleaned = phrase.replace(/^[•\-\*]+\s*/, '').replace(/[.!?]$/, '').trim();
            const summary = cleaned;
            return summary.charAt(0).toUpperCase() + summary.slice(1);
        }

        function toggleIssue(btn) {
            const full = btn.closest('.issue-row').nextElementSibling;
            const isHidden = full.style.display === 'none' || full.style.display === '';
            full.style.display = isHidden ? 'block' : 'none';
            btn.textContent = isHidden ? '−' : '+';
        }

        function renderForm(data) {
            setVal('f-date', data.DateCompleted || 'Pending');
            setVal('f-call-date', data.DateCallMade || 'Not Issued');
            setVal('f-client', data.Client);
            setVal('f-site', data.Site);
            setVal('f-site-area', data.SiteArea);
            setVal('f-contact', data.SiteContact?.Name);
            setVal('f-phone', data.SiteContact?.Phone);
            // FORCING testing email to prevent accidental client sends during setup
            const simproEmail = 'jonathangalicia1897@gmail.com';
            setVal('f-email', simproEmail);
            $('f-email').dataset.originalEmail = simproEmail.trim();
            setVal('f-afss', data.AFSSDue);
            setVal('f-jobid', data.JobID);
            setVal('f-footer-job', data.JobID);
            
            // Site metadata for enhanced reporting
            $('f-site').dataset.siteId = data.SiteID || '';
            $('f-site').dataset.siteName = data.Site || 'Unknown Site';
            
            // 6-Monthly Display (Strictly Live)
            const sixMonth = data.ServiceDue?.LiveSixMo?.Month || "";
            const sixYear = data.ServiceDue?.LiveSixMo?.Year || "";
            setVal('f-6mo', sixMonth ? '6 Monthly' : '—');
            setVal('f-6mo-month', sixMonth);
            setVal('f-6mo-year', sixYear);

            // 12-Monthly Display (Strictly Live)
            const twelveMonth = data.ServiceDue?.LiveTwelveMo?.Month || "";
            const twelveYear = data.ServiceDue?.LiveTwelveMo?.Year || "";
            
            setVal('f-12mo', twelveMonth ? '12 Monthly' : '—');
            setVal('f-12mo-month', twelveMonth);
            setVal('f-12mo-year', twelveYear);

            const tbody = $('f-works-body');
            tbody.innerHTML = '';
            const works = data.OutstandingWorks || [];

            if (works.length > 0) {
                works.forEach(w => {
                    const tr = document.createElement('tr');
                    const displayStatus = w.DisplayStatus || w.Status || 'PENDING';
                    tr.innerHTML = `
                    <td class="col-date-status">
                        <div style="font-weight:600; margin-bottom:5px;">${w.Date || '—'}</div>
                        ${badgeHtml(displayStatus)}
                    </td>
                    <td>${w.EquipmentType || '—'}</td>
                    <td style="padding: 6px 14px;">${(() => {
                        const issueText = w.Issue || '—';
                        const summary = summarizeIssue(issueText);
                        const issueLines = issueText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
                        const fullHtml = issueLines.map(l => escHtml(l)).join('<br>');
                        const needsExpand = issueLines.length > 1 || summary !== issueText.trim();
                        if (!needsExpand) {
                            return '<div class="issue-row"><span class="issue-summary">' + escHtml(summary) + '</span></div>';
                        }
                        return '<div class="issue-row">'
                            + '<span class="issue-summary">' + escHtml(summary) + '</span>'
                            + '<button class="issue-expand-btn" onclick="toggleIssue(this)" title="Show full details">+</button>'
                            + '</div>'
                            + '<div class="issue-full-text">' + fullHtml + '</div>';
                    })()}</td>
                    <td style="white-space:nowrap">${w.Lead || '—'}</td>
                    <td style="white-space:nowrap">${w.DARN || '—'}</td>
                    <td style="white-space:nowrap">${w.Quote || '—'}</td>
                    <td style="white-space:nowrap">${w.Job || '—'}</td>
                    <td>${w.Responsibility || '—'}</td>
                    <td>${w.Comment || '—'}</td>
                `;
                    tbody.appendChild(tr);
                });
            }

            // ---- Job Overview (scannable summary; screen only) ----
            try {
                const ov = $('job-overview');
                if (ov) {
                    const setText = (id, v) => { const e = $(id); if (e) e.textContent = v; };
                    setText('jo-client', data.Client || '—');
                    const siteLine = [data.Site, data.SiteArea].filter(x => x && x !== 'N/A').join('  ·  ');
                    setText('jo-site', siteLine || '—');
                    setText('jo-jobid', '#' + (data.JobID || '—'));
                    const deEnt = s => (s || '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
                    const contact = [deEnt(data.SiteContact?.Name), deEnt(data.SiteContact?.Phone)].filter(Boolean).join('  ·  ');
                    { var _jc = $('jo-contact'); if (_jc) _jc.innerHTML = contact ? (LC.user + '<span>' + escHtml(contact) + '</span>') : ''; }

                    setText('jo-6mo', sixMonth ? (sixMonth + (sixYear ? ' ' + sixYear : '')) : '—');
                    setText('jo-12mo', twelveMonth ? (twelveMonth + (twelveYear ? ' ' + twelveYear : '')) : '—');

                    const afss = data.AFSSDue || '—';
                    setText('jo-afss', afss);
                    let overdueAfss = false;
                    const m = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/.exec(afss || '');
                    if (m) { overdueAfss = new Date(+m[3], +m[2] - 1, +m[1]) < new Date(); }
                    const afssTile = $('jo-afss-tile');
                    if (afssTile) afssTile.classList.toggle('is-overdue', overdueAfss);
                    setText('jo-afss-sub', overdueAfss ? '⚠ Overdue' : (m ? 'Upcoming' : ''));

                    let pend = 0, prog = 0;
                    works.forEach(w => {
                        const s = (w.DisplayStatus || w.Status || '').toLowerCase();
                        if (s.includes('progress')) prog++; else pend++;
                    });
                    setText('jo-count', String(works.length));
                    setText('jo-count-sub', works.length ? (pend + ' pending · ' + prog + ' in progress') : 'None outstanding');

                    window._ovWorks = works;
                    renderOverviewWorks();
                    ov.style.display = 'block';
                    document.body.classList.add('drawer-open');
                    const bs = $('btn-summary'); if (bs) bs.style.display = '';
                }
                const je = $('job-empty'); if (je) je.style.display = 'none';
            } catch (e) { console.warn('[overview] render skipped:', e); }
        }

        // --- History Logic ---
        $('btn-history').addEventListener('click', async () => {
            $('history-modal-overlay').classList.add('visible');
            const tbody = $('history-list-body');
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">Loading history...</td></tr>';

            try {
                const adminHeaders = window.FPOWS_KEY ? { 'x-admin-key': window.FPOWS_KEY } : {};
                const res = await fetch('/api/logs', { headers: adminHeaders });
                const data = await res.json();

                if (data.logs && data.logs.length > 0) {
                    tbody.innerHTML = '';
                    data.logs.forEach(log => {
                        const tr = document.createElement('tr');
                        const ts = new Date(log.timestamp).toLocaleString('en-AU', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit'
                        });

                        tr.innerHTML = `
                        <tr style="position:relative;">
                            <td style="font-family:monospace">${ts}</td>
                            <td style="font-weight:700">#${log.jobId || 'N/A'}</td>
                            <td style="color:#e63946">${log.client || '—'}</td>
                            <td style="font-size: 0.72rem; line-height: 1.4; color: #444; padding:10px; display:flex; justify-content:space-between; align-items:center;">
                                <div>
                                    <div style="margin-bottom: 4px;"><strong>Client:</strong> ${log.clientEmail || log.to || '—'}</div>
                                    <div><strong>Manager:</strong> ${log.managerEmail || '—'}</div>
                                </div>
                                <button onclick="deleteHistoryItem('${log.timestamp}')" style="background:none; border:none; color:#e63946; cursor:pointer; font-size:16px; margin-left:10px;" title="Delete Record">${LC.trash}</button>
                            </td>
                        </tr>
                    `;
                        tbody.appendChild(tr);
                    });
                } else {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:#999;">No history found yet.</td></tr>';
                }
            } catch (e) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:red;">Failed to load history.</td></tr>';
            }
        });

        $('btn-history-close').addEventListener('click', () => {
            $('history-modal-overlay').classList.remove('visible');
        });

        // --- Customer Search Logic ---
        $('btn-search-customers').addEventListener('click', () => {
            $('customer-modal-overlay').classList.add('visible');
            $('cs-input').value = '';
            $('cs-input').focus();
            fetchCustomers('', true);
        });

        $('btn-cs-close').addEventListener('click', () => {
            $('customer-modal-overlay').classList.remove('visible');
        });

        $('btn-cs-refresh').addEventListener('click', () => {
            fetchCustomers($('cs-input').value.trim(), true);
        });

        async function fetchCustomers(q, forceRefresh) {
            $('cs-status').innerHTML = q ? 'Searching…' : 'Fetching latest from simPRO&hellip;';
            try {
                let url = '/api/customers/search?q=' + encodeURIComponent(q);
                if (forceRefresh) url += '&force=1';
                const res = await fetch(url);
                const data = await res.json();
                const resultsBox = $('cs-results');
                const updatedAt = data.cacheTime ? new Date(data.cacheTime).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
                const freshTag = updatedAt ? ` &nbsp;·&nbsp; <span class="cs-live">&#x2714; Live · ${updatedAt}</span>` : '';
                if (data.results && data.results.length > 0) {
                    resultsBox.style.display = 'block';
                    $('cs-status').innerHTML = q ? `Found ${data.results.length} result(s)${freshTag}` : `${data.results.length} recent customers · type to search${freshTag}`;
                    let rows = data.results;
                    if (typeof railOverdueOnly !== 'undefined' && railOverdueOnly) rows = rows.filter(c => c.overdue);
                    const sortFn = (a, b) => {
                        const mode = (typeof railSort !== 'undefined') ? railSort : 'recent';
                        if (mode === 'name') return (a.name || '').localeCompare(b.name || '');
                        if (mode === 'overdue') return (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || (b.latestActivity || 0) - (a.latestActivity || 0);
                        return (b.latestActivity || 0) - (a.latestActivity || 0); // recent
                    };
                    const majors = rows.filter(c => c.priority).sort(sortFn);
                    const regulars = rows.filter(c => !c.priority).sort(sortFn);

                    const chip = (txt, cls) => `<span class="chip ${cls || ''}">${txt}</span>`;
                    const renderItem = (c) => {
                        const tags = (c.priority && c.priorityTags && c.priorityTags.length)
                            ? c.priorityTags.map(t => chip(LC.tag + escHtml(t), 'chip-tag')).join('') : '';
                        const overdue = c.overdue ? chip(getOverdueText(c.latestActivity), 'chip-overdue') : '';
                        const loc = chip(LC.mapPin + (c.postcode || 'N/A'), 'chip-loc');
                        const typeLabel = c.type === 'Individual' ? 'Individual' : 'Company';
                        return `
                        <div class="cust-block">
                            <button type="button" class="cust-row" onclick="drillIntoCustomer('${c.id}', this)">
                                <span class="cust-chevron" aria-hidden="true">${LC.chevronRight}</span>
                                <span class="cust-body">
                                    <span class="cust-name">${c.name}</span>
                                    <span class="cust-sub"><span class="cust-id">ID ${c.id}</span>${loc}${overdue}${tags}</span>
                                </span>
                                <span class="cust-type">${typeLabel}</span>
                            </button>
                        </div>`;
                    };

                    let finalHtml = '';
                    if (majors.length > 0) {
                        finalHtml += `
                            <div class="cust-section">
                                <div class="cust-section-head cust-section-major"><span>${LC.star} Major customers</span><span class="cust-count">${majors.length}</span></div>
                                ${majors.map(renderItem).join('')}
                            </div>`;
                    }
                    if (regulars.length > 0) {
                        finalHtml += `
                            <div class="cust-section">
                                <div class="cust-section-head"><span>Regular clients</span><span class="cust-count">${regulars.length}</span></div>
                                ${regulars.map(renderItem).join('')}
                            </div>`;
                    }
                    resultsBox.innerHTML = finalHtml;
                } else {
                    resultsBox.style.display = 'none';
                    $('cs-status').innerHTML = 'No customers found.' + freshTag;
                }
            } catch (err) {
                $('cs-status').innerHTML = 'Error loading customers.';
            }
        }

        let csTimeout;
        $('cs-input').addEventListener('input', (e) => {
            clearTimeout(csTimeout);
            const q = e.target.value.trim();
            if (q.length > 0 && q.length < 2) {
                $('cs-results').style.display = 'none';
                $('cs-status').textContent = 'Type at least 2 characters…';
                return;
            }
            csTimeout = setTimeout(() => fetchCustomers(q), 400);
        });

        async function loadCustomerJobs(custId, rowElem) {
            let container = rowElem.nextElementSibling;
            const chevron = rowElem.querySelector('.cust-chevron');

            if (container && container.classList.contains('customer-jobs-inline')) {
                const hidden = container.style.display === 'none';
                container.style.display = hidden ? 'flex' : 'none';
                if (chevron) chevron.textContent = hidden ? '▾' : '▸';
                return;
            }

            if (chevron) chevron.textContent = '▾';
            container = document.createElement('div');
            container.className = 'customer-jobs-inline';
            container.innerHTML = '<div class="jobs-status">Loading jobs…</div>';
            rowElem.parentNode.insertBefore(container, rowElem.nextSibling);

            try {
                const res = await fetch('/api/customers/' + custId + '/jobs');
                const data = await res.json();
                if (data.jobs && data.jobs.length > 0) {
                    container.innerHTML = data.jobs.map(j => {
                        const sl = (j.stage || '').toLowerCase();
                        let bcls = 'b-pending';
                        if (sl.includes('progress')) bcls = 'b-progress';
                        else if (sl.includes('completed') || sl.includes('invoiced')) bcls = 'b-done';
                        return `
                        <button type="button" class="job-row" onclick="selectJobFromSearch('${j.id}')">
                            <span class="job-badge ${bcls}">${j.stage}</span>
                            <span class="job-body">
                                <span class="job-line1"><span class="job-name">${j.name}</span><span class="job-id">#${j.id}</span></span>
                                <span class="job-line2">📍 ${j.site} &nbsp;·&nbsp; 📅 ${j.date}</span>
                            </span>
                            <span class="job-go" aria-hidden="true">→</span>
                        </button>`;
                    }).join('');
                } else {
                    container.innerHTML = '<div class="jobs-status">No active or pending jobs found.</div>';
                }
            } catch (err) {
                container.innerHTML = '<div class="jobs-status jobs-error">Error loading jobs.</div>';
            }
        }

        function selectJobFromSearch(jobId) {
            $('customer-modal-overlay').classList.remove('visible');
            $('job-id-input').value = jobId;
            fetchJob();
        }

        async function deleteHistoryItem(timestamp) {
            if (!confirm("Are you sure you want to delete this record?")) return;
            try {
                const adminHeaders = window.FPOWS_KEY ? { 'Content-Type': 'application/json', 'x-admin-key': window.FPOWS_KEY } : { 'Content-Type': 'application/json' };
                const res = await fetch('/api/delete-history', {
                    method: 'POST',
                    headers: adminHeaders,
                    body: JSON.stringify({ timestamp })
                });
                const result = await res.json();
                if (result.success) {
                    // Refresh list by clicking history button again
                    $('btn-history').click();
                } else {
                    alert("Error: " + result.error);
                }
            } catch (err) {
                console.error("Delete failed:", err);
            }
        }


        // Show error banner
        function showError(msg) {
            const banner = $('error-banner');
            banner.textContent = msg;
            banner.style.display = 'block';
            setTimeout(() => banner.style.display = 'none', 6000);
        }

        // Core fetch function
        async function fetchJob(force) {
            const jobId = $('job-id-input').value.trim();
            if (!jobId) { showError('Please enter a Job ID.'); return; }

            $('loading-overlay').style.display = 'flex';
            $('loading-text').textContent = 'Fetching Job #' + jobId + ' from simPRO...';
            $('status-pill').className = 'status-pill pill-loading';
            $('status-pill').textContent = 'Loading...';

            try {
                const res = await fetch('/api/job/' + jobId + (force ? '?force=1' : ''));
                const data = await res.json();
                if (!res.ok || data.error) throw new Error(data.error || 'HTTP ' + res.status);

                renderForm(data);
                $('status-pill').className = 'status-pill pill-done';
                $('status-pill').textContent = 'Job #' + jobId + ' loaded';
                
                $('btn-publish').style.display = '';
                $('btn-print').style.display = '';

                const works = data.OutstandingWorks || [];
                $('agent-insights').innerHTML = '<div class="insight-card"><h4>📋 Job #' + jobId + '</h4><p>' + (data.Client || 'Unknown') + ' — ' + (data.Site || 'Unknown') + '</p></div><div class="insight-card"><h4>🔧 Outstanding Works</h4><p>' + works.length + ' item(s) found</p></div><div class="insight-card"><h4>📅 AFSS Due</h4><p>' + (data.AFSSDue || 'Not set') + '</p></div>';

                speak('Job #' + jobId + ' loaded! Client: ' + data.Client + '. ' + works.length + ' outstanding works found.', 'Want me to verify the data?', 'fetch');

                // Start live presence tracking for this job
                startPresence(jobId);
            } catch (err) {
                console.error("Fetch error:", err);
                showError('Failed to load Job #' + jobId + ': ' + err.message);
                $('status-pill').className = 'status-pill pill-error';
                $('status-pill').textContent = 'Error loading job';
            } finally {
                $('loading-overlay').style.display = 'none';
            }
        }

        // Auto-fetch if a dropdown item is picked
        $('schedule-select').addEventListener('change', (e) => {
            const val = e.target.value;
            if (val) {
                $('job-id-input').value = val;
                fetchJob();
            }
        });

        // Global helper for chatbot speech
        function speak(res, followUp, intent) {
            if (window.__chatbot) {
                window.__chatbot.handleSpeak(res, followUp, intent);
            } else {
                console.warn("Chatbot not initialized for speak:", res);
            }
        }

        $('btn-fetch').addEventListener('click', function () { fetchJob(true); });
        $('job-id-input').addEventListener('keydown', e => { if (e.key === 'Enter') fetchJob(); });
        $('btn-print').addEventListener('click', () => window.print());
        $('btn-publish').addEventListener('click', () => publishJob(false));

        // Manual Email Publisher (Scrapes the current DOM state)
        // window.__chatbotSendManagerOnly = true means chatbot triggered — send to manager only, not client
        async function publishJob(managerOnly = false) {
            const jobId = $('f-jobid').textContent.trim();
            const clientName = $('f-client').textContent.trim();
            if (!jobId || jobId === '—') { showError('No job loaded to save.'); return; }

            $('status-pill').className = 'status-pill pill-loading';
            $('status-pill').textContent = 'Saving & Sending...';
            $('btn-publish').disabled = true;

            try {
                // Read metadata from labels
                const site = $('f-site').textContent.trim();
                const siteArea = $('f-site-area').textContent.trim();
                const contact = $('f-contact').textContent.trim();
                const p = $('f-phone').textContent.trim();
                const e = $('f-email').textContent.trim();
                const phoneText = (p && p !== '—') ? p : '';
                const emailText = (e && e !== '—') ? e : '';
                let phoneEmail = '—';
                if (phoneText && emailText) phoneEmail = `${phoneText} / ${emailText}`;
                else if (phoneText) phoneEmail = phoneText;
                else if (emailText) phoneEmail = emailText;

                const serviceType = $('f-6mo').textContent.trim();
                const serviceMonthYear = $('f-6mo-month').textContent.trim() + ' / ' + $('f-6mo-year').textContent.trim();
                const afss = $('f-afss').textContent.trim();

                const redFirst = (text) => text.split(' ').map(word => `<span style="color:#e63946">${word[0]}</span>${word.slice(1)}`).join(' ');

                const headerHtml = `
                <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-bottom:2px solid #222; margin-bottom:10px;">
                    <tr>
                        <td style="padding:15px; vertical-align: middle;">
                            <img src="cid:redmen-logo" alt="REDMEN Logo" style="height: 100px; width: auto; display: block;">
                        </td>
                        <td align="right" style="padding:15px; font-size:11px; line-height:1.4; color:#555;">
                            <b>Labrobin Pty Ltd</b><br>T/A Redmen Fire Protection<br>ABN 72 079 715 867<br>Phone: 1300 733 836<br>Email: info@redmen.com.au
                        </td>
                    </tr>
                </table>
                <div style="padding: 20px; background: #fafafa; border-left: 5px solid #e63946; margin: 15px 0; font-family: Arial, sans-serif; color: #444; line-height: 1.6; font-size: 13px;">
                    To our valued client, please see below your Fire Protection Outstanding Status Report which provides a snapshot of the current situation of your fire protection systems and equipment onsite. Please feel free to reach out to your Portfolio Manager should you require any clarification or information.
                    <br><br>
                    Kind regards,<br>
                    <strong>Customer Experience Agent</strong>
                </div>
                <div style="text-align:center; padding:15px; font-family:Arial, sans-serif;">
                    <h1 style="font-size:22px; margin:0; text-transform:uppercase; letter-spacing:0.5px; font-weight:800; color:#1a1a1a;">
                        ${redFirst('FIRE PROTECTION OUTSTANDING WORKS STATUS')}
                    </h1>
                    <div style="font-size:16px; margin-top:5px; font-weight:700; color:#444;">
                        CALL SHEET - <span style="color:#e63946">FPOWS</span>
                    </div>
                </div>
                <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border:1px solid #ddd; margin-bottom:20px; font-size:12px; font-family:Arial, sans-serif;">
                    <tr>
                        <td width="33%" style="padding:10px; border-right:1px solid #ddd; border-bottom:1px solid #ddd;">
                            <div style="font-size:9px; color:#888; text-transform:uppercase;">Date Form Completed</div>
                            <div style="font-weight:700;">${$('f-date').textContent.trim()}</div>
                        </td>
                        <td width="33%" style="padding:10px; border-right:1px solid #ddd; border-bottom:1px solid #ddd;">
                            <div style="font-size:9px; color:#888; text-transform:uppercase;">Client</div>
                            <div style="font-weight:700;">${clientName}</div>
                        </td>
                        <td width="34%" style="padding:10px; border-bottom:1px solid #ddd;">
                            <div style="font-size:9px; color:#888; text-transform:uppercase;">Site</div>
                            <div style="font-weight:700;">${site}</div>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:10px; border-right:1px solid #ddd; border-bottom:1px solid #ddd;">
                            <div style="font-size:9px; color:#888; text-transform:uppercase;">Date Call Made</div>
                            <div style="font-weight:700;">${$('f-call-date').textContent.trim()}</div>
                        </td>
                        <td style="padding:10px; border-right:1px solid #ddd; border-bottom:1px solid #ddd;">
                            <div style="font-size:9px; color:#888; text-transform:uppercase;">Site Contact</div>
                            <div style="font-weight:700;">${contact}</div>
                        </td>
                        <td style="padding:10px; border-bottom:1px solid #ddd;">
                            <div style="font-size:9px; color:#888; text-transform:uppercase;">Phone # / Email</div>
                            <div style="font-weight:700;">${phoneEmail}</div>
                        </td>
                    </tr>
                    <tr>
                         <td colspan="3" style="padding:10px; border-bottom:1px solid #ddd;">
                            <div style="font-size:9px; color:#888; text-transform:uppercase;">Geographical Area</div>
                            <div style="font-weight:700;">${siteArea}</div>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:10px; border-right:1px solid #ddd;">
                            <div style="font-size:9px; color:#888; text-transform:uppercase;">Service Due</div>
                            <div style="font-weight:700;">${serviceType}</div>
                        </td>
                        <td style="padding:10px; border-right:1px solid #ddd;">
                            <div style="font-size:9px; color:#888; text-transform:uppercase;">Month / Year</div>
                            <div style="font-weight:700;">${serviceMonthYear}</div>
                        </td>
                        <td style="padding:10px;">
                            <div style="font-size:9px; color:#888; text-transform:uppercase;">Form # (Job ID)</div>
                            <div style="font-weight:700;">${jobId}</div>
                        </td>
                    </tr>
                </table>
            `;

                // Scrape Outstanding Works
                let worksHtml = "";
                const worksRows = Array.from($('f-works-body').rows);
                worksRows.forEach(row => {
                    const cells = Array.from(row.cells);
                    if (cells.length < 9) return;
                    const hasText = cells.some(c => c.textContent.trim() !== "");
                    if (!hasText) return;

                    worksHtml += `<tr>`;
                    [0, 1, 2, 3, 4, 5, 6, 7, 8].forEach(idx => {
                        // Use innerHTML for Date+Status cell (0), Issue (2), Comment (8) to preserve formatting
                        const val = (idx === 0 || idx === 2 || idx === 8) ? cells[idx].innerHTML.trim() : cells[idx].textContent.trim();
                        const padding = (idx === 2) ? '20px 14px' : '10px 14px';
                        worksHtml += `<td style="padding:${padding}; border:1px solid #ddd; font-size:11px; vertical-align:top;">${val || '—'}</td>`;
                    });
                    worksHtml += `</tr>`;
                });

                // Scrape Recommendations
                let recsHtml = "";
                const recRows = Array.from($('rec-table').querySelector('tbody').rows);
                recRows.forEach(row => {
                    const cells = Array.from(row.cells);
                    if (cells.length < 6) return;
                    const hasText = cells.some(c => c.textContent.trim() !== "");
                    if (!hasText) return;

                    recsHtml += `<tr>`;
                    [0, 1, 2, 3, 4, 5].forEach(idx => {
                        // Use innerHTML for cells that may have formatting (Issue/Comment)
                        // Increased padding for the Issue cell to 20px for better vertical spacing
                        const val = (idx === 2 || idx === 4) ? cells[idx].innerHTML.trim() : cells[idx].textContent.trim();
                        const padding = (idx === 2) ? '20px 14px' : '10px 14px';
                        recsHtml += `<td style="padding:${padding}; border:1px solid #ddd; font-size:11px; vertical-align:top;">${val || '—'}</td>`;
                    });
                    recsHtml += `</tr>`;
                });

                const emailHtml = `
                <html><body style="font-family: Arial, sans-serif; background-color:#f6f6f6; padding:20px; margin:0;">
                <div style="max-width:1050px; margin:0 auto; background:white; padding:30px; border-radius:8px; box-shadow:0 3px 10px rgba(0,0,0,0.1);">
                    <p style="font-size:11px; color:#888; text-align:center; margin-bottom:20px;">This FPOWS Call Sheet was generated and approved via REDMEN Automation.</p>
                    ${headerHtml}
                    <h3 style="font-size:14px; margin:20px 0 10px; text-transform:uppercase;">Outstanding Works</h3>
                    <table width="100%" style="border-collapse:collapse; margin-bottom:25px;">
                        <thead>
                            <tr style="background:#2c2c2c; color:white; font-size:10px; text-transform:uppercase;">
                                <th style="padding:8px; border:1px solid #333; text-align:left;">Date</th>
                                <th style="padding:8px; border:1px solid #333; text-align:left;">Equipment</th>
                                <th style="padding:8px; border:1px solid #333; text-align:left;">Issue</th>
                                <th style="padding:8px; border:1px solid #333; text-align:left;">Lead #</th>
                                <th style="padding:8px; border:1px solid #333; text-align:left;">DARN #</th>
                                <th style="padding:8px; border:1px solid #333; text-align:left;">Quote #</th>
                                <th style="padding:8px; border:1px solid #333; text-align:left;">Job #</th>
                                <th style="padding:8px; border:1px solid #333; text-align:left;">Responsibility</th>
                                <th style="padding:8px; border:1px solid #333; text-align:left;">Comment</th>
                            </tr>
                        </thead>
                        <tbody>${worksHtml || '<tr><td colspan="9" style="padding:20px; text-align:center; color:#999;">No works listed.</td></tr>'}</tbody>
                    </table>
                    
                    <h3 style="font-size:14px; margin:20px 0 10px; text-transform:uppercase;">Recommendations Made to Client</h3>
                    <table width="100%" style="border-collapse:collapse; margin-bottom:25px;">
                        <thead>
                            <tr style="background:#2c2c2c; color:white; font-size:10px; text-transform:uppercase;">
                                <th style="padding:8px; border:1px solid #333; text-align:left;">Date</th>
                                <th style="padding:8px; border:1px solid #333; text-align:left;">Equipment Type</th>
                                <th style="padding:8px; border:1px solid #333; text-align:left;">Issue</th>
                                <th style="padding:8px; border:1px solid #333; text-align:left;">Responsibility</th>
                                <th style="padding:8px; border:1px solid #333; text-align:left;">Comment</th>
                                <th style="padding:8px; border:1px solid #333; text-align:left;">Status</th>
                            </tr>
                        </thead>
                        <tbody>${recsHtml || '<tr><td colspan="6" style="padding:20px; text-align:center; color:#999;">No recommendations listed.</td></tr>'}</tbody>
                    </table>

                    <div style="text-align:center; font-size:11px; color:#aaa; border-top:1px solid #eee; padding-top:20px;">
                        Sent via FPOWS Automation · REDMEN Fire Protection · 1300 733 836
                    </div>
                </div>
                </body></html>
            `;
                // managerOnly = true (chatbot send) → manager only. false (button) → client + manager
                let actualClient = managerOnly ? null : (emailText || null);

                console.log(`[DEBUG] Attempting to dispatch email for Job #${jobId}. Payload length: ${emailHtml.length}`);

                const res = await fetch('/api/send-email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jobId: jobId,
                        clientName: clientName,
                        recipientEmail: actualClient,
                        managerEmail: null, // server CCs MANAGER_EMAIL
                        subject: `FPOWS Call Sheet - Job #${jobId} - ${clientName}`,
                        htmlContent: emailHtml,
                        siteId: $('f-site').dataset.siteId || '',
                        siteName: $('f-site').dataset.siteName || ''
                    })
                });

                if (!res.ok) {
                    const errorText = await res.text();
                    throw new Error(`Server Error (${res.status}): ${errorText || res.statusText}`);
                }

                const result = await res.json();
                if (result.success) {
                    $('status-pill').className = 'status-pill pill-done';
                    $('status-pill').textContent = `Job #${jobId} Saved & Sent!`;
                    speak(`Done! Job #${jobId} sent to ${managerOnly ? 'the manager' : `${actualClient} and the manager`}.`, "What's next?", "done");

                    // Add to history list UI immediately
                    initSchedules();
                } else {
                    throw new Error(result.error);
                }
            } catch (err) {
                console.error("DEBUG: Send Failure Details:", err);
                $('status-pill').className = 'status-pill pill-error';
                $('status-pill').textContent = `Sending Error`;

                if (err.name === 'TypeError' && err.message.toLowerCase().includes('fetch')) {
                    showError("Connection Failed: Ensure the server (yarn dev) is running and you have a stable network.");
                } else {
                    showError("Dispatch Failed: " + err.message);
                }
            } finally {
                $('btn-publish').disabled = false;
            }
        }

        /* --- Chatbot Logic --- */
        class FPOWSChatbot {
            constructor() {
                window.__chatbot = this;
                this.trigger = $('chat-trigger');
                this.window = $('chat-window');
                this.close = $('chat-close');
                this.input = $('chat-input');
                this.send = $('chat-send');
                this.messages = $('chat-messages');
                this.context = { lastIntent: null, lastJobId: null };
                this.init();
            }

            init() {
                this.trigger.onclick = () => this.toggle(true);
                this.close.onclick = () => this.toggle(false);
                this.send.onclick = () => this.handleUserMessage();
                this.input.onkeydown = (e) => { if (e.key === 'Enter') this.handleUserMessage(); };
            }

            toggle(show) {
                this.window.style.display = show ? 'flex' : 'none';
                if (show) this.input.focus();
            }

            async handleUserMessage() {
                const text = this.input.value.trim();
                if (!text) return;

                this.addMessage(text, 'user');
                this.input.value = '';
                this.input.disabled = true;
                this.send.disabled = true;

                const typingBubble = this.showTyping();
                await this.processResponse(text, typingBubble);

                this.input.disabled = false;
                this.send.disabled = false;
                this.input.focus();
            }

            showTyping() {
                const div = document.createElement('div');
                div.className = 'typing-indicator';
                div.innerHTML = '<span></span><span></span><span></span>';
                this.messages.appendChild(div);
                this.messages.scrollTop = this.messages.scrollHeight;
                return div;
            }

            addMessage(text, side) {
                const div = document.createElement('div');
                div.className = `msg msg-${side}`;
                div.innerHTML = text;
                this.messages.appendChild(div);
                this.messages.scrollTop = this.messages.scrollHeight;
            }

            extractJobId(text) {
                // Explicit "job 420433" or "#420433" — highest priority
                const explicit = text.match(/(?:job\s*#?\s*|#)(\d{4,})/i);
                if (explicit) return explicit[1];
                // Bare number only (whole input is just digits)
                const bare = text.match(/^(\d{4,})$/);
                if (bare) return bare[1];
                // Number embedded in sentence — only if it does NOT look like a phone number
                // Phone numbers: start with 0, +, or are 10-11 digits starting with 04/02/03/07/08
                const embedded = text.match(/\b(\d{5,})\b/);
                if (embedded) {
                    const n = embedded[1];
                    const isPhone = n.length >= 9 || n.startsWith('0') || n.startsWith('04') || n.startsWith('61');
                    if (!isPhone) return n;
                }
                return null;
            }

            async fetchJobForChat(jobId) {
                try {
                    const res = await fetch(`/api/job/${jobId}`);
                    const data = await res.json();
                    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);

                    // Also load it into the main form
                    renderForm(data);
                    $('job-id-input').value = jobId;
                    $('status-pill').className = 'status-pill pill-done';
                    $('status-pill').textContent = `Job #${jobId} loaded`;
                    
                    $('btn-publish').style.display = '';
                    $('btn-print').style.display = '';

                    // Update right sidebar insights
                    const works = data.OutstandingWorks || [];
                    $('agent-insights').innerHTML = '<div class="insight-card"><h4>📋 Job #' + jobId + '</h4><p>' + (data.Client || 'Unknown') + ' — ' + (data.Site || 'Unknown') + '</p></div><div class="insight-card"><h4>🔧 Outstanding Works</h4><p>' + works.length + ' item(s) found</p></div><div class="insight-card"><h4>📅 AFSS Due</h4><p>' + (data.AFSSDue || 'Not set') + '</p></div>';

                    // Start live presence tracking for this job
                    startPresence(jobId);
                    // Conversational summary — no data dumps
                    const contact = data.SiteContact || {};
                    const worksCount = works.length;
                    const hasPhone = contact.Phone && contact.Phone !== '—';
                    const hasEmail = contact.Email && contact.Email !== '—';
                    const warnings = [];
                    if (!hasPhone) warnings.push('no phone number on file');
                    if (!hasEmail) warnings.push('no email on file');

                    let summary = `Got it! Job #${jobId} is loaded — `;
                    summary += `${data.Client || 'the client'} over at ${data.Site || 'the site'}`;
                    if (data.SiteArea) summary += ` (${data.SiteArea})`;
                    summary += `.`;

                    if (contact.Name) summary += ` Your contact is ${contact.Name}`;
                    if (hasPhone) summary += ` on ${contact.Phone}`;
                    if (hasEmail) summary += `, email ${contact.Email}`;
                    if (contact.Name) summary += `.`;

                    if (warnings.length) summary += ` Just a heads-up — ${warnings.join(' and ')}.`;

                    if (data.AFSSDue) summary += ` AFSS is due ${data.AFSSDue}.`;

                    if (worksCount === 0) {
                        summary += ` No outstanding works at the moment.`;
                    } else {
                        summary += ` There ${worksCount === 1 ? 'is' : 'are'} <strong>${worksCount}</strong> outstanding work item${worksCount === 1 ? '' : 's'} on this job.`;
                    }

                    summary += `<br><br>Everything's in the form — want me to check anything, or are you ready to send?`;
                    return summary;
                } catch (err) {
                    return `Failed to fetch Job #${jobId}: ${err.message}. Please verify the Job ID and try again.`;
                }
            }

            normalizeInput(text) {
                return text.toLowerCase()
                    .replace(/[.,!]/g, '') // Keep question marks for query detection
                    .replace(/\bi'm\b/g, 'i am')
                    .replace(/\bcan't\b/g, 'cannot')
                    .replace(/\bdon't\b/g, 'do not')
                    .replace(/\bwont\b/g, 'will not')
                    .replace(/\bwon't\b/g, 'will not')
                    .trim();
            }

            getFieldValue(id) {
                const el = $(id);
                if (!el) return null;
                const val = el.textContent.trim();
                return (val === '—' || val === '') ? null : val;
            }

            async processResponse(input, typingBubble) {
                const rawQ = input;
                const q = this.normalizeInput(input);
                const isQuestion = rawQ.includes('?');
                const delay = ms => new Promise(r => setTimeout(r, ms));

                // Universal "Thinking" time for every chat interaction
                await delay(1100 + Math.random() * 700);

                // 1. Check for Job ID (Highest Priority)
                const jobId = this.extractJobId(rawQ);
                if (jobId) {
                    this.context.lastJobId = jobId;
                    const summary = await this.fetchJobForChat(jobId);
                    typingBubble.remove();
                    this.addMessage(summary, 'bot');
                    this.context.lastIntent = 'fetch';
                    return;
                }

                let res = "";
                let followUp = "";
                let intentMatched = null;

                // HELPER: Respond and exit
                const speak = (content, next, intent) => {
                    res = content;
                    followUp = next;
                    intentMatched = intent;
                };

                // 2. Field edit intent — "change/update/set/add/put [field] to/as [value]"
                const editMatch = rawQ.match(/(?:change|update|set|edit|fix|correct|also|make|add|put|enter|insert|use)\s+(?:the\s+)?(\w[\w\s]*?)\s+(?:to|as|=|is)\s+(.+)/i)
                    || rawQ.match(/(?:add|put|enter|insert)\s+(?:the\s+)?(\w[\w\s]*?)\s+(?:number\s+)?(\d[\d\s\-\+]{5,})/i);
                if (editMatch) {
                    const fieldHint = editMatch[1].toLowerCase().trim();
                    const newValue  = editMatch[2].trim();
                    const fieldMap = [
                        [['phone','phone number','mobile','contact number','ph'],            'f-phone'],
                        [['email','email address','mail'],                                    'f-email'],
                        [['contact','site contact','person','contact name'],                  'f-contact'],
                        [['afss','afss due','afss date','due date','afss due date'],          'f-afss'],
                        [['call date','date call made','date call'],                          'f-call-date'],
                        [['date form','date completed','form date','date form completed'],    'f-date'],
                        [['client','client name','company','company name'],                   'f-client'],
                        [['site name','site'],                                                'f-site'],
                        [['area','geographical area','geo area','location','suburb','city'],  'f-site-area'],
                        [['6 monthly','6mo','six monthly','6 month service'],                 'f-6mo'],
                        [['service month','6mo month','monthly month'],                       'f-6mo-month'],
                        [['service year','6mo year','monthly year'],                          'f-6mo-year'],
                        [['12 monthly','12mo','annual','twelve monthly','annual service'],     'f-12mo'],
                        [['12mo month','annual month'],                                       'f-12mo-month'],
                        [['12mo year','annual year'],                                         'f-12mo-year'],
                    ];
                    const match = fieldMap.find(([keys]) => keys.some(k => fieldHint.includes(k)));
                    const elId = match ? match[1] : null;
                    if (elId && $(elId)) {
                        const oldValue = $(elId).textContent.trim();
                        $(elId).textContent = newValue;
                        speak(`Done — <strong>${fieldHint}</strong> changed to <strong>${newValue}</strong>.`,
                            "Form updated. Send when ready.", "edit");
                    } else {
                        const editable = 'phone, email, contact, site, client, area, AFSS due, call date, service month/year';
                        speak(`I didn't recognise that field. I can edit: ${editable}.`, "Try again with one of those.", "edit_unknown");
                    }
                    typingBubble.remove();
                    this.addMessage(`${res} ${followUp}`, 'bot');
                    this.context.lastIntent = intentMatched;
                    this.input.disabled = false;
                    this.send.disabled = false;
                    this.input.focus();
                    return;
                }

                // 3. Send intent — must run before question handler so "can you send" doesn't trigger verify
                const sendKeywords = /\b(send|dispatch|publish|send it)\b/;
                if (q.match(sendKeywords)) {
                    const btnPublish = $('btn-publish');
                    if (!btnPublish || btnPublish.style.display === 'none') {
                        speak("No job loaded yet — give me a job number first.", "", "error");
                    } else {
                        const toManager = q.match(/manager|\bmarc\b/);
                        speak(
                            toManager ? "Sending to the manager now!" : "On it — triggering the email now!",
                            "Keep an eye on the status bar.",
                            "send"
                        );
                        typingBubble.remove();
                        this.addMessage(`${res} ${followUp}`, 'bot');
                        this.context.lastIntent = 'send';
                        this.input.disabled = false;
                        this.send.disabled = false;
                        this.input.focus();
                        setTimeout(() => publishJob(true), 500);
                        return;
                    }
                }

                // 3. Latest job query — "what is the latest job", "what date is the latest change"
                if (q.match(/latest\s+(job|data|job\s*number|job\s*id|change|update|modification)|most\s+recent\s+job|newest\s+job|last\s+job|what\s+date.*latest|when.*latest|date.*latest/)) {
                    // parse optional "on/for/from/of [X]" qualifier — detect major/regular category keywords
                    const qualifierRaw = rawQ.match(/(?:\bon\b|\bfor\b|\bfrom\b|\bof\b|\babout\b)\s+(.+?)(?:\?|$)/i)?.[1]?.trim() || '';
                    const ql = qualifierRaw.toLowerCase();
                    let latestUrl = '/api/latest-job';
                    let filterLabel = '';
                    if (ql.includes('major')) {
                        latestUrl = '/api/latest-job?category=major';
                        filterLabel = 'major clients';
                    } else if (ql.includes('regular')) {
                        latestUrl = '/api/latest-job?category=regular';
                        filterLabel = 'regular clients';
                    } else if (qualifierRaw) {
                        latestUrl = `/api/latest-job?customer=${encodeURIComponent(qualifierRaw)}`;
                        filterLabel = qualifierRaw;
                    }
                    speak("One sec — checking simPRO...", "", "latest_job");
                    typingBubble.remove();
                    this.addMessage(`${res} ${followUp}`, 'bot');
                    const loadingBubble = this.showTyping();
                    try {
                        const resp = await fetch(latestUrl);
                        const data = await resp.json();
                        if (data.jobId) {
                            const modDate = data.modified
                                ? new Date(data.modified).toLocaleDateString('en-AU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
                                : null;
                            const labelHtml = filterLabel ? ` among <em>${filterLabel}</em>` : '';
                            res = `Latest active job${labelHtml} is <strong>#${data.jobId}</strong> — ${data.client} at ${data.site}.`;
                            if (modDate) res += ` Last modified <strong>${modDate}</strong>.`;
                            followUp = `Say "retrieve ${data.jobId}" to load it.`;
                            this.context.latestJobId = data.jobId;
                        } else {
                            const labelText = filterLabel ? ` among ${filterLabel}` : '';
                            res = `No active jobs found${labelText}.`;
                            followUp = "";
                        }
                    } catch(e) {
                        res = "Couldn't reach the server — try again in a moment.";
                    }
                    loadingBubble.remove();
                    this.addMessage(`${res} ${followUp}`, 'bot');
                    this.context.lastIntent = 'latest_job';
                    this.input.disabled = false;
                    this.send.disabled = false;
                    this.input.focus();
                    return;
                }

                // 4. Questions
                // Works/status queries are checked first so a "?" doesn't hijack them into the verify block
                const worksKeywords = /outstanding|works|issue|how many|equipment|in.?progress|pending|status/;
                const queryKeywords = /verify|audit|check|is (it|this|that) (correct|right|accurate|good|ok|ok\?)|\?|accurate\?|correct\?|right\?|confirm\?|up.?to.?date|fresh/;
                if (!q.match(worksKeywords) && (isQuestion || q.match(/^(is|can|does|will|could)\b/) || q.match(queryKeywords))) {
                    const currentJob = this.getFieldValue('f-jobid');
                    if (currentJob) {
                        const client = this.getFieldValue('f-client');
                        const site = this.getFieldValue('f-site');
                        const contact = this.getFieldValue('f-contact');
                        const phone = this.getFieldValue('f-phone');
                        const email = this.getFieldValue('f-email');
                        const afss = this.getFieldValue('f-afss');
                        const sMonth = this.getFieldValue('f-6mo-month');
                        const sYear = this.getFieldValue('f-6mo-year');
                        const warnings = [];
                        if (!phone) warnings.push('phone number is missing');
                        if (!email) warnings.push('no email address on record');

                        // Detect "latest data" type questions
                        const isLatestQ = q.match(/latest|up.?to.?date|fresh|current|from simpro/);

                        if (isLatestQ) {
                            res = `Yep, that's live data straight from simPRO — fetched it fresh when the job loaded.`;
                            if (warnings.length) res += ` Everything checks out except ${warnings.join(' and ')}.`;
                            else res += ` Everything on the form looks good to me.`;
                            followUp = `Want me to go over anything specific, or are you ready to send?`;
                        } else {
                            res = `Checked Job #${currentJob} — `;
                            if (client) res += `${client}`;
                            if (site) res += ` at ${site}`;
                            res += `.`;
                            if (contact) res += ` Contact is ${contact}`;
                            if (phone) res += ` (${phone})`;
                            if (email) res += `, ${email}`;
                            if (contact) res += `.`;
                            if (afss) res += ` AFSS due ${afss}.`;
                            if (sMonth && sYear) res += ` 6-monthly service was ${sMonth} ${sYear}.`;
                            if (warnings.length) {
                                res += `<br><br>One thing to flag — ${warnings.join(' and ')}.`;
                                followUp = `Everything else looks good. Want to fix that before sending, or shall we go ahead?`;
                            } else {
                                followUp = `All looking good to me. Ready to send when you are!`;
                            }
                        }
                        intentMatched = 'verify';
                    } else {
                        speak("No job loaded yet — drop a job number and I'll check it over for you.", "", "error");
                    }
                }

                // 3. Negations
                else if (q.match(/\b(no|nope|nah|not yet|not ready|will not|do not|don't|stop|wait|hold on|cancel)\b/) || q.match(/not (correct|good|right|ready|accurate)/)) {
                    if (this.context.lastIntent === 'confirm' || this.context.lastIntent === 'verify') {
                        speak("No worries, I've paused the dispatch. Which field needs fixing?", "", "negate");
                    } else {
                        speak("Got it, no problem!", "Just let me know when you're ready.", "negate");
                    }
                }

                // 4. Affirmations
                else if (q.match(/\b(yes|yeah|yep|yup|sure|absolutely|confirmed|correct|right|do it|go for it|ready)\b/) ||
                    q.match(/looks (good|correct|accurate|right)|details (are|seem) (good|correct|accurate|right)|everything (is|seems) (good|correct|accurate|right)|i think.*(correct|good|accurate|right)|it is (correct|good|accurate|right)/)
                ) {
                    if (this.context.lastIntent === 'query_works') {
                        // Describe each work item conversationally
                        const worksBody = $('f-works-body');
                        const rows = worksBody ? Array.from(worksBody.rows) : [];
                        if (rows.length === 0) {
                            speak("Hmm, I can't see any work items right now — try reloading the job.", "", "error");
                        } else {
                            let detail = `Here's a rundown of the ${rows.length} item${rows.length === 1 ? '' : 's'}:<br><br>`;
                            rows.forEach((row, i) => {
                                const cells = Array.from(row.cells);
                                const statusText = (cells[0]?.textContent || '').trim().replace(/[^\w\s]/g, '').trim();
                                const equipment = cells[1]?.textContent.trim() || 'Unknown equipment';
                                const issue = cells[2]?.textContent.trim().replace(/\s+/g, ' ').substring(0, 80) || 'No issue noted';
                                const jobNum = cells[6]?.textContent.trim() || '—';
                                const date = cells[0]?.querySelector ? null : null;
                                // Get date from first line of cell[0] before the badge
                                const dateText = (cells[0]?.textContent || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '—';
                                detail += `<strong>${i + 1}. ${equipment}</strong> (${statusText}) — ${issue}${issue.length >= 80 ? '...' : ''}`;
                                if (jobNum !== '—') detail += ` | Job #${jobNum}`;
                                detail += `<br>`;
                            });
                            speak(detail, "Let me know if you want to send the call sheet or have any questions.", "works_detail");
                        }
                    } else if (this.context.lastIntent === 'verify' || this.context.lastIntent === 'fetch') {
                        speak("Great, the form's ready to go!", "Hit <strong>Save and Sent to Email</strong> when you're ready, or just tell me to send it.", "confirm");
                    } else {
                        speak("Sure thing!", "What would you like to do?", "affirm");
                    }
                }

                // 5. Specific Data Queries
                else if (q.match(/site|address|location|where/)) {
                    const site = this.getFieldValue('f-site');
                    if (site) speak(`The site is <strong>${site}</strong>.`, "Want the contact details too?", "query_site");
                    else speak("No site loaded yet — drop a job number and I'll grab it.", "", "error");
                }
                else if (q.match(/contact|who is the|name/)) {
                    const contact = this.getFieldValue('f-contact');
                    if (contact) speak(`Contact on this job is <strong>${contact}</strong>.`, "Want their phone or email as well?", "query_contact");
                    else speak("No contact found for this job. You might need to check simPRO.", "", "error");
                }
                else if (q.match(/phone|call|number/)) {
                    const phone = this.getFieldValue('f-phone');
                    if (phone) speak(`Phone number is <strong>${phone}</strong>.`, "Want me to check the email too?", "query_phone");
                    else speak("No phone number on this one — worth updating it in simPRO if you have it.", "", "error");
                }
                else if (q.match(/email|mail/)) {
                    const email = this.getFieldValue('f-email');
                    if (email) speak(`Email on file is <strong>${email}</strong>.`, "Does that look right?", "query_email");
                    else speak("No email address found — you'll need to add it in simPRO before sending.", "", "error");
                }
                else if (q.match(/afss|due|expiry|date/)) {
                    const afss = this.getFieldValue('f-afss');
                    if (afss) speak(`AFSS is due <strong>${afss}</strong>.`, "", "query_afss");
                    else speak("No AFSS date on this job — double check the Job ID.", "", "error");
                }

                // 5a. Portfolio-wide status query
                else if (q.match(/all jobs|all of them|portfolio|across all|every job|entire|all in.?progress|all pending|all customers/)) {
                    speak("Give me a sec — pulling the full portfolio...", "", "portfolio");
                    typingBubble.remove();
                    this.addMessage(`${res} ${followUp}`, 'bot');
                    res = ""; followUp = "";
                    const loadingBubble = this.showTyping();
                    try {
                        const adminHeaders = window.FPOWS_KEY ? { 'x-admin-key': window.FPOWS_KEY } : {};
                        const resp = await fetch('/api/customers/search?force=1', { headers: adminHeaders });
                        const data = await resp.json();
                        const customers = data.results || [];
                        if (customers.length === 0) {
                            res = "No active jobs found in the portfolio right now.";
                        } else {
                            const overdue = customers.filter(c => c.overdue).length;
                            const priority = customers.filter(c => c.priority).length;
                            const wantIP = q.match(/in.?progress/);
                            const wantPend = q.match(/pending/) && !wantIP;
                            if (wantIP || wantPend) {
                                const label = wantIP ? 'in progress' : 'pending';
                                res = `Across the portfolio there ${customers.length === 1 ? 'is' : 'are'} <strong>${customers.length}</strong> active customer${customers.length === 1 ? '' : 's'}`;
                                if (overdue > 0) res += `, <strong>${overdue}</strong> overdue`;
                                res += `.<br><br>To see ${label} work items for a specific job, load the job and ask — e.g. <em>"419128 show only in progress"</em>.`;
                            } else {
                                res = `Portfolio has <strong>${customers.length}</strong> active customer${customers.length === 1 ? '' : 's'}`;
                                if (overdue > 0) res += `, <strong>${overdue}</strong> overdue`;
                                if (priority > 0) res += `, <strong>${priority}</strong> tagged for testing`;
                                res += `.`;
                                followUp = `Load a job number and ask me to filter by status.`;
                            }
                        }
                    } catch(e) {
                        res = "Couldn't reach the server right now — try again in a moment.";
                    }
                    loadingBubble.remove();
                    this.addMessage(`${res} ${followUp}`, 'bot');
                    this.context.lastIntent = 'portfolio';
                    this.input.disabled = false;
                    this.send.disabled = false;
                    this.input.focus();
                    return;
                }

                // 5b. Outstanding works queries for current job (including status breakdown and filtering)
                else if (q.match(/outstanding|works|issue|how many|equipment|in.?progress|pending|status/)) {
                    const worksBody = $('f-works-body');
                    const allRows = worksBody ? Array.from(worksBody.rows) : [];

                    // Detect if user wants a specific status filter
                    const wantInProgress = q.match(/in.?progress/);
                    const wantPending = q.match(/\bpending\b/) && !wantInProgress;
                    const wantCompleted = q.match(/complet/);
                    const filterStatus = wantInProgress ? 'IN PROGRESS' : wantPending ? 'PENDING' : wantCompleted ? 'COMPLETED' : null;

                    // Parse all rows with their status
                    const parsed = allRows.map(row => {
                        const cells = Array.from(row.cells);
                        const cellText = (cells[0]?.textContent || '').toUpperCase();
                        let status = 'PENDING';
                        if (cellText.includes('IN PROGRESS') || cellText.includes('PROGRESS')) status = 'IN PROGRESS';
                        else if (cellText.includes('COMPLETED') || cellText.includes('DONE')) status = 'COMPLETED';
                        else if (cellText.includes('QUOTED')) status = 'QUOTED';
                        else if (cellText.includes('SCHEDULED')) status = 'SCHEDULED';
                        const dateText = (cells[0]?.textContent || '').trim().split('\n').map(s => s.trim()).filter(Boolean)[0] || '—';
                        return {
                            status,
                            date: dateText,
                            equipment: cells[1]?.textContent.trim() || 'Unknown equipment',
                            issue: (cells[2]?.textContent.trim().replace(/\s+/g, ' ') || 'No issue noted').substring(0, 80),
                            job: cells[6]?.textContent.trim() || '—'
                        };
                    });

                    if (parsed.length === 0) {
                        speak("All clear — no outstanding works on this job.", "", "error");
                    } else if (filterStatus) {
                        // Show only filtered items
                        const filtered = parsed.filter(r => r.status === filterStatus);
                        if (filtered.length === 0) {
                            speak(`No ${filterStatus.toLowerCase()} items on this job.`, "", "query_works");
                        } else {
                            let detail = `Here ${filtered.length === 1 ? 'is' : 'are'} the <strong>${filtered.length}</strong> ${filterStatus.toLowerCase()} item${filtered.length === 1 ? '' : 's'}:<br><br>`;
                            filtered.forEach((r, i) => {
                                detail += `<strong>${i + 1}. ${r.equipment}</strong>`;
                                if (r.date && r.date !== '—') detail += ` — ${r.date}`;
                                detail += `<br>${r.issue}${r.issue.length >= 80 ? '...' : ''}`;
                                if (r.job !== '—') detail += ` <span style="opacity:0.6">(Job #${r.job})</span>`;
                                detail += `<br><br>`;
                            });
                            speak(detail.trim(), "Need anything else on this job?", "query_works");
                        }
                    } else {
                        // General count + breakdown
                        const statusCounts = {};
                        parsed.forEach(r => { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1; });
                        const breakdown = Object.entries(statusCounts).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(', ');
                        speak(`There ${parsed.length === 1 ? 'is' : 'are'} <strong>${parsed.length}</strong> work item${parsed.length === 1 ? '' : 's'} on this job — ${breakdown}.`, "Want me to show the details?", "query_works");
                    }
                }

                // 6. General Intents
                else if (q.includes("how are you") || /\bhi\b|\bhello\b|\bgday\b/.test(q)) {
                    const greetings = ["Hey! Ready to help.", "Hi there! What are we working on?", "G'day! What do you need?"];
                    speak(greetings[Math.floor(Math.random() * greetings.length)], "Give me a job number or ask me anything about the current job.", "greeting");
                }
                else if (q.match(/thank|thanks|appreciate|ty\b/)) {
                    const replies = ["No worries!", "Happy to help!", "Anytime!"];
                    speak(replies[Math.floor(Math.random() * replies.length)], "Let me know if there's anything else.", "gratitude");
                }
                else if (q.match(/\bbye\b|goodbye|done|finished/)) {
                    speak("See you later!", "Have a good one.", "exit");
                }
                else if (q.match(/current|loaded|this job|active|walk|detail|about|tell me/)) {
                    const currentJob = this.getFieldValue('f-jobid');
                    if (currentJob) {
                        speak(`Currently on Job #${currentJob} — <strong>${this.getFieldValue('f-client')}</strong> at <strong>${this.getFieldValue('f-site')}</strong>.`,
                            "Want me to check over the details?", "walkthrough");
                    } else {
                        speak("Nothing loaded yet — give me a job number to start.", "", "error");
                    }
                }
                else if (q.includes("print") || q.includes("save")) {
                    speak("To print or save as PDF, just hit the <strong>Print</strong> button up top.", "", "print");
                }
                else if (q.includes("help") || q.includes("what can you do") || q.includes("who are you")) {
                    speak("I'm FRED — Field Resource Enquiry Dispatch! I can pull up job data from simPRO, check over the details, tell you about outstanding works, or send the call sheet — just ask.", "Try giving me a job number to get started.", "help");
                }
                else {
                    const fallbacks = [
                        "Hmm, not quite sure what you mean — could you rephrase that?",
                        "I didn't catch that one. Try a job number, or ask me to check the details.",
                        "Not sure about that one! You can give me a job number or ask me to verify the current job."
                    ];
                    speak(fallbacks[Math.floor(Math.random() * fallbacks.length)], "", "unknown");
                }

                this.context.lastIntent = intentMatched;
                typingBubble.remove();
                this.addMessage(`${res} ${followUp}`, 'bot');
            }
        }

        document.addEventListener("DOMContentLoaded", () => {
            initSchedules();
            new FPOWSChatbot();
            initPresence();
        });

        // Add handleSpeak to the class
        FPOWSChatbot.prototype.handleSpeak = function (res, followUp, intent) {
            this.context.lastIntent = intent;
            this.addMessage(`${res} <br><br><em>${followUp}</em>`, 'bot');
        };

        // --- Live Presence System ---
        let _presenceUser = (window.FPOWS_USER && window.FPOWS_USER.name) || localStorage.getItem('fpows_username') || '';
        let _presenceInterval = null;
        let _presencePollInterval = null;
        let _currentViewingJobId = null;

        function initPresence() {
            if (!_presenceUser) {
                _presenceUser = prompt('Enter your display name for the FPOWS dashboard:');
                if (_presenceUser) {
                    _presenceUser = _presenceUser.trim();
                    localStorage.setItem('fpows_username', _presenceUser);
                }
            }
        }

        function getInitials(name) {
            return name.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);
        }

        function startPresence(jobId) {
            if (_presenceInterval) clearInterval(_presenceInterval);
            if (_presencePollInterval) clearInterval(_presencePollInterval);
            
            // Leave previous job
            if (_currentViewingJobId && _presenceUser) {
                fetch('/api/presence/leave', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ jobId: _currentViewingJobId, userName: _presenceUser }) });
            }
            _currentViewingJobId = String(jobId);
            if (!_presenceUser) return;

            // Heartbeat every 5 seconds
            const heartbeat = () => fetch('/api/presence/heartbeat', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ jobId: _currentViewingJobId, userName: _presenceUser }) });
            heartbeat();
            _presenceInterval = setInterval(heartbeat, 5000);

            // Poll viewers every 5 seconds
            const pollViewers = async () => {
                try {
                    const res = await fetch('/api/presence/' + _currentViewingJobId);
                    const data = await res.json();
                    renderPresence(data.viewers || []);
                } catch(e) {}
            };
            pollViewers();
            _presencePollInterval = setInterval(pollViewers, 5000);
        }

        function renderPresence(viewers) {
            const bar = $('presence-bar');
            if (!viewers || viewers.length === 0) {
                bar.style.display = 'none';
                return;
            }
            bar.style.display = 'flex';
            bar.innerHTML = '<span class="presence-label">' + LC.eye + ' Viewing:</span>' +
                viewers.map(v => `<div class="presence-avatar" style="background:${v.color}">${getInitials(v.name)}<span class="pulse-dot"></span><span class="tooltip">${v.name}</span></div>`).join('');
        }

        // Leave on page close
        window.addEventListener('beforeunload', () => {
            if (_currentViewingJobId && _presenceUser) {
                navigator.sendBeacon('/api/presence/leave', JSON.stringify({ jobId: _currentViewingJobId, userName: _presenceUser }));
            }
        });

/* ── Theme toggle (light / dark) — redesign 2026 ── */
(function () {
    var root = document.documentElement;
    var KEY = 'fpows-theme';
    try { var saved = localStorage.getItem(KEY); if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved); } catch (e) {}
    function isDark() {
        var cur = root.getAttribute('data-theme');
        return cur === 'dark' || (!cur && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    }
    function paintIcon() {
        var btn = document.getElementById('btn-theme');
        if (!btn) return;
        var ico = btn.querySelector('.theme-ico');
        if (ico) ico.textContent = isDark() ? '☀️' : '🌙';
    }
    document.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('#btn-theme') : null;
        if (!btn) return;
        var next = isDark() ? 'light' : 'dark';
        root.setAttribute('data-theme', next);
        try { localStorage.setItem(KEY, next); } catch (e2) {}
        paintIcon();
    });
    paintIcon();
})();

/* ── Job Overview: expand / collapse long issue text ── */
function toggleOvIssue(btn) {
    const issue = btn.previousElementSibling;
    if (!issue) return;
    const nowClamped = issue.classList.toggle('clamped');
    btn.textContent = nowClamped ? 'Show more' : 'Show less';
}

/* ── Master-detail: populate the customer rail on load ── */
window.addEventListener('load', function () {
    try { if (typeof fetchCustomers === 'function') fetchCustomers('', true); }
    catch (e) { console.warn('[rail] init:', e); }
});

/* ── Rail: sort + overdue filter ── */
var railSort = 'recent';
var railOverdueOnly = false;
window.addEventListener('load', function () {
    var sel = document.getElementById('rail-sort');
    var ov = document.getElementById('rail-overdue-only');
    var reRun = function () {
        var q = (document.getElementById('cs-input') || {}).value || '';
        if (typeof fetchCustomers === 'function') fetchCustomers(q.trim());
    };
    if (sel) sel.addEventListener('change', function () { railSort = sel.value; reRun(); });
    if (ov) ov.addEventListener('change', function () { railOverdueOnly = ov.checked; reRun(); });
});

/* ── Lucide inline icons (no external dependency) ── */
var LC = {
  chevronDown: '<svg class="lc" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  chevronUp:   '<svg class="lc" viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg>',
  copy:        '<svg class="lc" viewBox="0 0 24 24"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  check:       '<svg class="lc" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  chevronRight: '<svg class="lc" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
  chevronLeft:  '<svg class="lc lc-xs" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  mapPin:      '<svg class="lc lc-xs" viewBox="0 0 24 24"><path d="M20 10c0 4.4-8 12-8 12s-8-7.6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
  calendar:    '<svg class="lc lc-xs" viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/></svg>',
  tag:         '<svg class="lc lc-xs" viewBox="0 0 24 24"><path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
  star:        '<svg class="lc lc-xs" viewBox="0 0 24 24"><path d="m12 2 3 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.9 21l1.2-6.8-5-4.9 6.9-1z"/></svg>',
  user:        '<svg class="lc lc-xs" viewBox="0 0 24 24"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  eye:         '<svg class="lc lc-xs" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  trash:       '<svg class="lc lc-xs" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>'
};

/* ── Job Overview: sort + status filter for outstanding works ── */
window._ovWorks = window._ovWorks || [];
window._ovSort = 'status';
window._ovFilter = 'all';
function renderOverviewWorks() {
  var jw = document.getElementById('jo-works'); if (!jw) return;
  var all = window._ovWorks || [];
  var sort = window._ovSort || 'status';
  var filter = window._ovFilter || 'all';
  var statusOf = function (w) { return (w.DisplayStatus || w.Status || 'PENDING').toLowerCase(); };
  var parseD = function (d) { var m = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/.exec(d || ''); return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : 0; };
  var rank = function (w) { var s = statusOf(w); if (s.indexOf('progress') >= 0) return 0; if (s.indexOf('complete') >= 0) return 2; return 1; };
  if (all.length === 0) { jw.innerHTML = '<div class="jo-empty">' + LC.check + ' No outstanding works for this site.</div>'; return; }
  var list = all.filter(function (w) {
    var s = statusOf(w);
    if (filter === 'pending') return s.indexOf('progress') < 0 && s.indexOf('complete') < 0;
    if (filter === 'progress') return s.indexOf('progress') >= 0;
    return true;
  });
  list.sort(function (a, b) {
    if (sort === 'date') return parseD(b.Date) - parseD(a.Date);
    if (sort === 'equipment') return (a.EquipmentType || '').localeCompare(b.EquipmentType || '');
    return rank(a) - rank(b) || parseD(b.Date) - parseD(a.Date);
  });
  if (list.length === 0) { jw.innerHTML = '<div class="jo-empty jo-empty-muted">No works match this filter.</div>'; return; }
  jw.innerHTML = list.map(function (w) {
    var s = statusOf(w);
    var bc = 'b-pending', label = 'Pending';
    if (s.indexOf('progress') >= 0) { bc = 'b-progress'; label = 'In Progress'; }
    else if (s.indexOf('complete') >= 0) { bc = 'b-done'; label = 'Completed'; }
    var lines = (w.Issue || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var fullIssue = lines.length ? lines.map(escHtml).join('<br>') : '—';
    var isLong = lines.length > 2 || (w.Issue || '').length > 170;
    var sev = bc === 'b-progress' ? 'sev-progress' : (bc === 'b-done' ? 'sev-done' : 'sev-pending');
    return '<div class="jo-work ' + sev + '">'
      + '<span class="job-badge ' + bc + '">' + label + '</span>'
      + '<div class="jo-work-body">'
      + '<div class="jo-work-top"><span class="jo-work-eq">' + escHtml(w.EquipmentType || 'Works') + '</span>'
      + (w.Job ? '<span class="jo-work-id">' + escHtml(w.Job) + '</span>' : '') + '</div>'
      + '<div class="jo-work-issue' + (isLong ? ' clamped' : '') + '">' + fullIssue + '</div>'
      + (isLong ? '<button type="button" class="jo-more" onclick="toggleOvIssue(this)">' + LC.chevronDown + '<span>Show more</span></button>' : '')
      + '</div></div>';
  }).join('');
}

window.addEventListener('load', function () {
  var sortSel = document.getElementById('ov-sort');
  if (sortSel) sortSel.addEventListener('change', function () { window._ovSort = sortSel.value; renderOverviewWorks(); });
  var fil = document.getElementById('ov-filter');
  if (fil) fil.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-f]') : null; if (!b) return;
    fil.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
    b.setAttribute('aria-pressed', 'true');
    window._ovFilter = b.getAttribute('data-f'); renderOverviewWorks();
  });
  var copyBtn = document.getElementById('jo-copy');
  if (copyBtn) copyBtn.addEventListener('click', copyJobId);
});

/* ── Toast notifications ── */
function fpowsToast(msg) {
  var wrap = document.getElementById('toast-wrap'); if (!wrap) return;
  var t = document.createElement('div'); t.className = 'toast'; t.innerHTML = LC.check + '<span>' + msg + '</span>';
  wrap.appendChild(t);
  requestAnimationFrame(function () { t.classList.add('show'); });
  setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 260); }, 2200);
}

/* ── Copy job number ── */
function copyJobId() {
  var el = document.getElementById('jo-jobid');
  var txt = (el ? el.textContent : '').replace('#', '').trim();
  if (!txt || txt === '—') return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(function () { fpowsToast('Copied job ' + txt); }).catch(function () { fpowsToast('Job ' + txt); });
  } else { fpowsToast('Job ' + txt); }
}

/* ── Rail drill-down (customers → jobs) with breadcrumb ── */
function jobBadgeClass(stage) {
  var sl = (stage || '').toLowerCase();
  if (sl.indexOf('progress') >= 0) return 'b-progress';
  if (sl.indexOf('completed') >= 0 || sl.indexOf('invoiced') >= 0) return 'b-done';
  return 'b-pending';
}
function renderJobRow(j) {
  var bc = jobBadgeClass(j.stage);
  var sev = bc === 'b-progress' ? 'sev-progress' : (bc === 'b-done' ? 'sev-done' : 'sev-pending');
  return '<button type="button" class="job-row ' + sev + '" onclick="selectJobFromSearch(\'' + j.id + '\')">'
    + '<span class="job-badge ' + bc + '">' + escHtml(j.stage || '') + '</span>'
    + '<span class="job-body"><span class="job-line1"><span class="job-name">' + escHtml(j.name || ('Job #' + j.id)) + '</span><span class="job-id">#' + j.id + '</span></span>'
    + '<span class="job-line2">' + LC.mapPin + ' ' + escHtml(j.site || '') + ' &nbsp;·&nbsp; ' + LC.calendar + ' ' + escHtml(j.date || '') + '</span></span>'
    + '<span class="job-go" aria-hidden="true">' + LC.chevronRight + '</span></button>';
}
function drillIntoCustomer(id, rowEl) {
  var box = document.getElementById('cs-results'); if (!box) return;
  window._railBackHtml = box.innerHTML;
  var nameEl = rowEl && rowEl.querySelector ? rowEl.querySelector('.cust-name') : null;
  var name = nameEl ? nameEl.textContent : 'Customer';
  box.innerHTML = '<div class="rail-crumb"><button type="button" class="crumb-back" onclick="railBack()">' + LC.chevronLeft + '<span>Customers</span></button></div>'
    + '<div class="rail-cust-hdr">' + escHtml(name) + '</div>'
    + '<div class="jobs-panel"><div class="jobs-status">Loading jobs…</div></div>';
  var panel = box.querySelector('.jobs-panel');
  fetch('/api/customers/' + id + '/jobs').then(function (r) { return r.json(); }).then(function (data) {
    if (data.jobs && data.jobs.length) { panel.innerHTML = data.jobs.map(renderJobRow).join(''); }
    else panel.innerHTML = '<div class="jobs-status">No active or pending jobs found.</div>';
  }).catch(function () { panel.innerHTML = '<div class="jobs-status jobs-error">Error loading jobs.</div>'; });
}
function railBack() {
  var box = document.getElementById('cs-results');
  if (box && window._railBackHtml != null) { box.innerHTML = window._railBackHtml; }
}

/* ── Overview drawer (open/close) — delegated so it always works ── */
document.addEventListener('click', function (e) {
  var t = e.target && e.target.closest ? e.target.closest('#jo-close, #btn-summary') : null;
  if (!t) return;
  e.preventDefault();
  if (t.id === 'jo-close') document.body.classList.remove('drawer-open');
  else document.body.classList.toggle('drawer-open');
});
// Close the drawer on Escape
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') document.body.classList.remove('drawer-open');
});
