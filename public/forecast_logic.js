
let savedOverrides = [];
try {
    const saved = localStorage.getItem('forecastManualIncludes');
    if (saved) {
        savedOverrides = JSON.parse(saved);
    }
} catch (e) {
    console.error("Error loading manual includes from localStorage", e);
}
let globalForecastData = { members: [], monthlyPlans: [], months: [], manualIncludeOverrides: new Set(savedOverrides) };

window.saveDummyCustomName = function (accountId, name, entryDate = null) {
    try {
        let data = JSON.parse(localStorage.getItem('dummyCustomData') || '{}');
        const oldEntryDate = data[accountId] ? data[accountId].entryDate : '';
        data[accountId] = {
            name: name,
            entryDate: entryDate !== null ? entryDate : oldEntryDate
        };
        localStorage.setItem('dummyCustomData', JSON.stringify(data));

        // Also keep sync with old key for generic lookups (like in headers)
        let names = JSON.parse(localStorage.getItem('dummyCustomNames') || '{}');
        names[accountId] = name;
        localStorage.setItem('dummyCustomNames', JSON.stringify(names));
    } catch (e) { console.error('Error saving dummy custom data', e); }
};

window.getDummyCustomName = function (accountId) {
    try {
        let data = JSON.parse(localStorage.getItem('dummyCustomData') || '{}');
        if (data[accountId] && data[accountId].name) return data[accountId].name;

        // Fallback to old structure
        let names = JSON.parse(localStorage.getItem('dummyCustomNames') || '{}');
        return names[accountId] || '';
    } catch (e) { return ''; }
};

window.getDummyEntryDate = function (accountId) {
    try {
        let data = JSON.parse(localStorage.getItem('dummyCustomData') || '{}');
        return (data[accountId] && data[accountId].entryDate) ? data[accountId].entryDate : '';
    } catch (e) { return ''; }
};

async function loadTeamForecast(members, startMonthDate = new Date()) {
    const container = document.getElementById('teamForecastContainer');
    if (!container) return;

    container.innerHTML = '<div style="text-align:center; padding: 2rem;">⏳ Cargando proyecciones detalladas...</div>';
    document.getElementById('teamForecastCard').style.display = 'block';
    const summaryDashboardCard = document.getElementById('teamSummaryDashboardCard');
    if (summaryDashboardCard) summaryDashboardCard.style.display = 'block';

    // Update the input to reflect the date
    const monthInput = document.getElementById('forecastStartMonth');
    if (monthInput) {
        const y = startMonthDate.getFullYear();
        const m = String(startMonthDate.getMonth() + 1).padStart(2, '0');
        monthInput.value = `${y}-${m}`;
    }

    try {
        const now = startMonthDate;
        const months = [];
        for (let i = 0; i < 3; i++) {
            const startDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
            const endDate = new Date(now.getFullYear(), now.getMonth() + i + 1, 0);

            // Adjust offset to local midnight to avoid timezone issues when converting to ISO string
            const startStr = startDate.toLocaleDateString('en-CA'); // 'YYYY-MM-DD' local time
            const endStr = endDate.toLocaleDateString('en-CA');

            months.push({
                date: startDate,
                label: startDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }),
                key: startStr.slice(0, 7),
                startStr,
                endStr
            });
        }

        const realAccountIds = members.filter(m => !m.isDummy).map(m => m.accountId);
        const genericResourceIds = members.filter(m => m.isDummy).map(m => m.accountId);

        const promises = months.map(monthObj => {
            return fetch('/api/plans/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: monthObj.startStr,
                    to: monthObj.endStr,
                    accountIds: realAccountIds,
                    genericResourceIds: genericResourceIds
                })
            }).then(r => r.json()).catch(e => []);
        });

        const allMonthlyPlans = await Promise.all(promises);

        // Store Global Data
        globalForecastData.members = members;
        globalForecastData.monthlyPlans = allMonthlyPlans;
        globalForecastData.months = months;

        // Initial Render
        renderTeamForecastTable();
        renderTeamSummaryFilters(); // NEW: Add buttons
        renderTeamSummaryTable();   // NEW: Pass 'All' as default if needed


    } catch (e) {
        console.error("Error loading team forecast:", e);
        container.innerHTML = `<div style="color:red; padding:1rem; text-align:center;">Error cargando proyecciones: ${e.message} <br> ${e.stack}</div>`;
    }
}

function renderTeamForecastTable() {
    const container = document.getElementById('teamForecastContainer');
    if (!container || globalForecastData.members.length === 0) return;

    // Save current expanded state of teams
    const expandedTeams = new Set();
    const currentRows = container.querySelectorAll('tr[class^="team-row-forecast-"]');
    currentRows.forEach(row => {
        if (row.style.display !== 'none') {
            const classMatch = Array.from(row.classList).find(c => c.startsWith('team-row-forecast-'));
            if (classMatch) {
                const groupId = classMatch.replace('team-row-forecast-', '');
                expandedTeams.add(groupId);
            }
        }
    });

    // Prepare filtered members: All real users + Dummys with planning
    const showFacturable = document.getElementById('cbFacturable') ? document.getElementById('cbFacturable').checked : true;
    const showInterno = document.getElementById('cbInterno') ? document.getElementById('cbInterno').checked : true;
    const showPipeline = document.getElementById('cbPipeline') ? document.getElementById('cbPipeline').checked : true;
    const showOperacional = document.getElementById('cbOperacional') ? document.getElementById('cbOperacional').checked : true;
    const months = globalForecastData.months;

    const filteredMembers = globalForecastData.members.filter(m => {
        if (!m.isDummy) return true; // Always show real users

        // Calculate total hours for dummys
        let totalStatsForMember = 0;
        months.forEach((monthObj, monthIndex) => {
            const allMonthlyPlans = globalForecastData.monthlyPlans[monthIndex] || [];
            const userMonthlyPlans = allMonthlyPlans.filter(p => String(p.assigneeAccountId) === String(m.accountId));
            const stats = calculateMonthlyStats(userMonthlyPlans, monthObj.date, m, monthObj.key);

            if (showFacturable) totalStatsForMember += stats.facturable;
            if (showPipeline) totalStatsForMember += stats.pipeline;
            if (showInterno) totalStatsForMember += stats.interno;
            if (showOperacional) totalStatsForMember += stats.operacional;
        });

        return totalStatsForMember > 0;
    });

    if (filteredMembers.length === 0) {
        container.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-sub);">No hay datos de planificación para los filtros seleccionados.</div>';
        return;
    }

    let html = `
            <table style="width:100%; border-collapse: collapse; font-size: 0.85rem;">
                <thead>
                    <tr style="background: #f8fafc; border-bottom: 2px solid var(--border);">
                        <th style="padding: 10px; text-align: left;"></th>
                        ${months.map(m => `<th style="padding: 10px; text-align: center;">${m.label}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
        `;

    let currentTeamGroup = null;

    filteredMembers.forEach((m, index) => {
        if (m.teamName !== currentTeamGroup) {
            currentTeamGroup = m.teamName;
            const safeGroupId = (currentTeamGroup || 'otros').replace(/[^a-zA-Z0-9]/g, '-');
            html += `
                <tr style="background-color: #e5e7eb; border-bottom: 1px solid #d1d5db; cursor: pointer;" onclick="toggleTeamRowVisibility('team-row-forecast', '${safeGroupId}', 'icon-forecast-${safeGroupId}')">
                    <td colspan="${months.length + 1}" style="padding: 10px; font-weight: bold; text-transform: uppercase; color: #1f2937; font-size: 0.95rem;">
                        <span id="icon-forecast-${safeGroupId}" style="display:inline-block; width:20px; text-align:center;">▶</span> ${currentTeamGroup || 'Otros'}
                    </td>
                </tr>
            `;
        }

        const avatar = m.avatarUrl ? `<img src="${m.avatarUrl}" class="member-avatar" style="width:24px;height:24px;margin-right:8px;vertical-align:middle;border-radius:50%;">` : '';
        const nameDisplay = `<div style="font-weight:600;">${m.displayName}</div><div style="font-size:0.75rem;color:var(--text-sub);">${m.role}</div>`;

        const safeGroupId = (currentTeamGroup || 'otros').replace(/[^a-zA-Z0-9]/g, '-');
        const safeName = m.displayName.replace(/'/g, "\\'");

        // Check if group should be expanded
        const isExpanded = expandedTeams.has(safeGroupId);
        const displayStyle = isExpanded ? 'table-row' : 'none';

        const isDummyStr = m.isDummy ? 'true' : 'false';

        html += `<tr class="team-row-forecast-${safeGroupId}" style="border-bottom: 1px solid #f1f5f9; display: ${displayStyle};">
                        <td style="padding: 10px; padding-left: 20px; cursor: pointer;" onclick="verDetalleUsuario('${m.accountId}', '${safeName}', null, ${m.availability || 100}, ${isDummyStr})">
                            <div style="display:flex; align-items:center;">
                                ${avatar} 
                                <div style="line-height: 1.2;">
                                    <div style="font-weight:600;">${window.getDummyCustomName(m.accountId) || m.displayName}</div>
                                    <div style="font-size:0.75rem;color:var(--text-sub);">${m.isDummy && window.getDummyCustomName(m.accountId) ? m.displayName : m.role}</div>
                                </div>
                            </div>
                        </td>`;

        // For each month
        months.forEach((monthObj, monthIndex) => {
            // Get plans for this user in this exact month calculation
            const allMonthlyPlans = globalForecastData.monthlyPlans[monthIndex] || [];
            const userMonthlyPlans = allMonthlyPlans.filter(p => String(p.assigneeAccountId) === String(m.accountId));

            // Calculate metrics for this user + month
            const stats = calculateMonthlyStats(userMonthlyPlans, monthObj.date, m, monthObj.key);

            // Apply Filters
            if (!showFacturable) stats.facturable = 0;
            if (!showPipeline) stats.pipeline = 0;
            if (!showInterno) stats.interno = 0;
            if (!showOperacional) stats.operacional = 0;

            html += `<td style="padding: 10px; vertical-align: top;">${renderMonthCell(stats)}</td>`;
        });

        html += `</tr>`;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;

    // Restore icons for expanded
    expandedTeams.forEach(groupId => {
        const icon = document.getElementById(`icon-forecast-${groupId}`);
        if (icon) icon.innerHTML = '▼';
    });
}


let currentSummaryTeam = 'All';
let summaryChartInstance = null;

function renderTeamSummaryFilters() {
    const filterContainer = document.getElementById('teamSummaryFilters');
    if (!filterContainer) return;

    // Ordered list from user
    const customOrder = ['OPE-PMO', 'OPE-FI', 'OPE-TES', 'OPE-CO&ING', 'OPE-LOG', 'OPE-DES', 'OPE-CX'];
    const detectedTeams = [...new Set(globalForecastData.members.map(m => m.teamName || 'Otros'))];

    // Sort based on customOrder
    const teams = detectedTeams.sort((a, b) => {
        const indexA = customOrder.indexOf(a);
        const indexB = customOrder.indexOf(b);
        if (indexA === -1 && indexB === -1) return a.localeCompare(b);
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
    });

    let html = `
        <button onclick="setSummaryTeam('All')" class="btn-filter-summary ${currentSummaryTeam === 'All' ? 'active' : ''}" 
                style="padding: 6px 16px; border-radius: 20px; border: 1px solid #e2e8f0; background: ${currentSummaryTeam === 'All' ? '#059669' : 'white'}; color: ${currentSummaryTeam === 'All' ? 'white' : '#64748b'}; font-weight: 700; font-size: 0.8rem; cursor: pointer; transition: all 0.2s; text-transform: none;">
            Todos los Equipos
        </button>
    `;

    teams.forEach(team => {
        const isActive = currentSummaryTeam === team;
        html += `
            <button onclick="setSummaryTeam('${team.replace(/'/g, "\\'")}')" class="btn-filter-summary ${isActive ? 'active' : ''}" 
                    style="padding: 6px 16px; border-radius: 20px; border: 1px solid #e2e8f0; background: ${isActive ? '#059669' : 'white'}; color: ${isActive ? 'white' : '#64748b'}; font-weight: 700; font-size: 0.8rem; cursor: pointer; transition: all 0.2s; text-transform: uppercase;">
                ${team}
            </button>
        `;
    });

    filterContainer.innerHTML = html;
}

function setSummaryTeam(team) {
    currentSummaryTeam = team;
    renderTeamSummaryFilters();
    renderTeamSummaryTable();
}

function renderTeamSummaryTable() {
    const container = document.getElementById('teamSummaryTableContainer');
    if (!container || globalForecastData.members.length === 0) return;

    const months = globalForecastData.months;
    const teamFilter = currentSummaryTeam;

    // Filter members for calculation
    const members = teamFilter === 'All'
        ? globalForecastData.members
        : globalForecastData.members.filter(m => (m.teamName || 'Otros') === teamFilter);

    const statusMsg = document.getElementById('summaryLoadStatus');
    if (statusMsg) statusMsg.style.display = 'none';

    // 1. Initialize Aggregation
    let globalStats = months.map(() => ({ available: 0, facturable: 0, pipeline: 0, interno: 0, operacional: 0 }));

    members.forEach(m => {
        months.forEach((monthObj, monthIndex) => {
            const allMonthlyPlans = globalForecastData.monthlyPlans[monthIndex] || [];
            const userMonthlyPlans = allMonthlyPlans.filter(p => String(p.assigneeAccountId) === String(m.accountId));
            const stats = calculateMonthlyStats(userMonthlyPlans, monthObj.date, m, monthObj.key);

            globalStats[monthIndex].available += stats.available;
            globalStats[monthIndex].facturable += stats.facturable;
            globalStats[monthIndex].pipeline += stats.pipeline;
            globalStats[monthIndex].interno += stats.interno;
            globalStats[monthIndex].operacional += stats.operacional;
        });
    });

    // 2. Build Cumulative Metrics Table (Styled like OPE table)
    const numFormat = (n) => typeof n === 'number' && !isNaN(n) ? n.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '0';

    let html = `
        <div class="table-wrapper" style="border: 2px solid #000; border-radius: 12px; overflow: hidden; background: #fff;">
            <table style="width:100%; border-collapse: collapse; font-size: 0.95rem; text-align: center; font-family: 'Outfit', sans-serif;">
                <tbody>
                    <!-- Row: Meses Labels -->
                    <tr style="background: #e2e8f0; color: #1e293b; border-bottom: 2px solid #000;">
                        <td style="padding: 15px; border-right: 2px solid #000; border-bottom: 2px solid #000; background: #e2e8f0; width: 250px;"></td>
                        ${months.map(m => `<td style="padding: 15px; font-weight: 700; text-transform: uppercase; font-size: 0.9rem; letter-spacing: 0.5px; border-right: 2px solid #000; border-bottom: 2px solid #000; background: #e2e8f0;">${m.label}</td>`).join('')}
                        <td style="width: 80px; border-left: 2px solid #000; border-bottom: 2px solid #000; background: #e2e8f0; font-weight: 700;">OBJ.</td>
                    </tr>
                    
                    <!-- Horas Requeridas Row -->
                    <tr style="border-bottom: 2px solid #000;">
                        <td style="padding: 15px; text-align: left; font-weight: 600; color: #334155; border-right: 2px solid #000; border-bottom: 2px solid #000; background: #f8fafc; font-size: 0.95rem;">Horas Requeridas</td>
                        ${months.map((_, idx) => {
        return `<td style="padding: 15px; font-weight: 600; font-size: 1.1rem; color: #334155; border-right: 2px solid #000; border-bottom: 2px solid #000; background: #f8fafc;">${numFormat(globalStats[idx].available)}</td>`;
    }).join('')}
                        <td style="padding: 15px; background: #f8fafc; border-left: 2px solid #000; border-bottom: 2px solid #000;"></td>
                    </tr>

                    <!-- Facturable Row -->
                    <tr style="border-bottom: 2px solid #000;">
                        <td style="padding: 20px 15px; text-align: left; font-weight: 700; color: #065f46; border-right: 2px solid #000; border-bottom: 2px solid #000; background: #ecfdf5; font-size: 1.05rem;">Facturable (%)</td>
                        ${months.map((_, idx) => {
        const stats = globalStats[idx];
        const pct = stats.available > 0 ? (stats.facturable / stats.available) * 100 : 0;
        return `<td style="padding: 20px 15px; font-weight: 800; font-size: 1.35rem; color: #064e3b; border-right: 2px solid #000; border-bottom: 2px solid #000; background: #ecfdf5;">${numFormat(pct)}%</td>`;
    }).join('')}
                        <td style="padding: 20px 15px; background: #ecfdf5; font-weight: 800; color: #059669; font-size: 1.15rem; vertical-align: middle; border-left: 2px solid #000; border-bottom: 2px solid #000;">75%</td>
                    </tr>

                    <!-- Facturable (Horas) Row -->
                    <tr style="border-bottom: 2px solid #000;">
                        <td style="padding: 15px; text-align: left; font-weight: 600; color: #065f46; border-right: 2px solid #000; border-bottom: 2px solid #000; background: #f0fdf4; font-size: 0.95rem;">Facturable (Horas)</td>
                        ${months.map((_, idx) => {
        return `<td style="padding: 15px; font-weight: 600; font-size: 1.1rem; color: #064e3b; border-right: 2px solid #000; border-bottom: 2px solid #000; background: #f0fdf4;">${numFormat(globalStats[idx].facturable)}</td>`;
    }).join('')}
                        <td style="padding: 15px; background: #f0fdf4; border-left: 2px solid #000; border-bottom: 2px solid #000;"></td>
                    </tr>
                    
                    <!-- Pipeline Row -->
                    <tr style="border-bottom: 2px solid #000;">
                        <td style="padding: 20px 15px; text-align: left; font-weight: 700; color: #1e3a8a; border-right: 2px solid #000; border-bottom: 2px solid #000; background: #bfdbfe; font-size: 1.05rem;">Pipeline/ Facturable (%)</td>
                        ${months.map((_, idx) => {
        const stats = globalStats[idx];
        const total = stats.facturable + stats.pipeline;
        const pct = stats.available > 0 ? (total / stats.available) * 100 : 0;
        return `<td style="padding: 20px 15px; font-weight: 800; font-size: 1.35rem; color: #1e3a8a; border-right: 2px solid #000; border-bottom: 2px solid #000; background: #bfdbfe;">${numFormat(pct)}%</td>`;
    }).join('')}
                        <td style="padding: 20px 15px; background: #bfdbfe; font-weight: 800; color: #1e3a8a; font-size: 1.15rem; vertical-align: middle; border-left: 2px solid #000; border-bottom: 2px solid #000;">75%</td>
                    </tr>

                    <!-- Pipeline/ Facturable (Horas) Row -->
                    <tr style="border-bottom: 2px solid #000;">
                        <td style="padding: 15px; text-align: left; font-weight: 600; color: #1e3a8a; border-right: 2px solid #000; border-bottom: 2px solid #000; background: #eff6ff; font-size: 0.95rem;">Pipeline/ Facturable (Horas)</td>
                        ${months.map((_, idx) => {
        const stats = globalStats[idx];
        const total = stats.facturable + stats.pipeline;
        return `<td style="padding: 15px; font-weight: 600; font-size: 1.1rem; color: #1e3a8a; border-right: 2px solid #000; border-bottom: 2px solid #000; background: #eff6ff;">${numFormat(total)}</td>`;
    }).join('')}
                        <td style="padding: 15px; background: #eff6ff; border-left: 2px solid #000; border-bottom: 2px solid #000;"></td>
                    </tr>

                    <!-- Total Row -->
                    <tr style="border-bottom: 2px solid #000;">
                        <td style="padding: 20px 15px; text-align: left; font-weight: 700; color: #92400e; border-right: 2px solid #000; background: #fffbeb; font-size: 1.05rem;">Pipeline/ Fact./ Interno (%)</td>
                        ${months.map((_, idx) => {
        const stats = globalStats[idx];
        const total = stats.facturable + stats.pipeline + stats.interno;
        const pct = stats.available > 0 ? (total / stats.available) * 100 : 0;
        return `<td style="padding: 20px 15px; font-weight: 900; font-size: 1.5rem; color: #92400e; border-right: 2px solid #000; background: #fffbeb;">${numFormat(pct)}%</td>`;
    }).join('')}
                        <td style="padding: 20px 15px; background: #fffbeb; font-weight: 900; color: #92400e; font-size: 1.25rem; vertical-align: middle; border-left: 2px solid #000;">85%</td>
                    </tr>

                    <!-- Pipeline/ Fact./ Interno (Horas) Row -->
                    <tr>
                        <td style="padding: 15px; text-align: left; font-weight: 600; color: #92400e; border-right: 2px solid #000; background: #fff7ed; font-size: 0.95rem;">Pipeline/ Fact./ Interno (Horas)</td>
                        ${months.map((_, idx) => {
        const stats = globalStats[idx];
        const total = stats.facturable + stats.pipeline + stats.interno;
        return `<td style="padding: 15px; font-weight: 600; font-size: 1.1rem; color: #92400e; border-right: 2px solid #000; background: #fff7ed;">${numFormat(total)}</td>`;
    }).join('')}
                        <td style="padding: 15px; background: #fff7ed; border-left: 2px solid #000;"></td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;

    // 3. Initialize Chart
    setTimeout(() => {
        const ctx = document.getElementById('summaryForecastChart');
        if (!ctx) return;

        const chartMonths = months.map(m => m.label);
        const dataFacturable = months.map((_, idx) => {
            const stats = globalStats[idx];
            return stats.available > 0 ? ((stats.facturable / stats.available) * 100) : 0;
        });
        const dataCapFact = months.map((_, idx) => {
            const stats = globalStats[idx];
            return stats.available > 0 ? (((stats.facturable + stats.pipeline) / stats.available) * 100) : 0;
        });
        const dataCapFactInt = months.map((_, idx) => {
            const stats = globalStats[idx];
            return stats.available > 0 ? (((stats.facturable + stats.pipeline + stats.interno) / stats.available) * 100) : 0;
        });

        if (summaryChartInstance) {
            summaryChartInstance.destroy();
        }

        summaryChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartMonths,
                datasets: [
                    {
                        label: 'Facturable (%)',
                        data: dataFacturable,
                        borderColor: '#059669',
                        backgroundColor: '#10b981',
                        borderWidth: 4,
                        tension: 0.3,
                        pointRadius: 6,
                        pointHoverRadius: 8,
                        pointBackgroundColor: '#fff',
                        pointBorderWidth: 3
                    },
                    {
                        label: 'Pipeline/ Facturable (%)',
                        data: dataCapFact,
                        borderColor: '#3b82f6',
                        backgroundColor: '#60a5fa',
                        borderWidth: 4,
                        tension: 0.3,
                        pointRadius: 6,
                        pointHoverRadius: 8,
                        pointBackgroundColor: '#fff',
                        pointBorderWidth: 3
                    },
                    {
                        label: 'Pipeline/ Facturable/ Interno (%)',
                        data: dataCapFactInt,
                        borderColor: '#f59e0b',
                        backgroundColor: '#fbbf24',
                        borderWidth: 4,
                        tension: 0.3,
                        pointRadius: 6,
                        pointHoverRadius: 8,
                        pointBackgroundColor: '#fff',
                        pointBorderWidth: 3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        grid: { color: '#f1f5f9' },
                        ticks: {
                            callback: value => value + '%',
                            font: { family: 'Inter', weight: 600 }
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { font: { family: 'Inter', weight: 600 } }
                    }
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { boxWidth: 12, padding: 25, font: { family: 'Outfit', size: 13, weight: 600 } }
                    },
                    tooltip: {
                        backgroundColor: '#1e293b',
                        padding: 12,
                        titleFont: { family: 'Outfit', size: 14 },
                        bodyFont: { family: 'Inter', size: 13 },
                        callbacks: {
                            label: context => ` ${context.dataset.label}: ${context.parsed.y.toFixed(1)}%`
                        }
                    }
                }
            }
        });
    }, 100);
}

// Helper to calculate stats for a specific month
function calculateMonthlyStats(plans, monthDate, member, monthKey = null) {
    // Calculate Capacity for this month
    const y = monthDate.getFullYear();
    const m = monthDate.getMonth();
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0);

    // Set to noon to avoid timezone shift when using toISOString()
    start.setHours(12, 0, 0, 0);
    end.setHours(12, 0, 0, 0);

    const name = member.displayName ? member.displayName.toLowerCase() : '';
    const capacityPercent = member.availability || 100;

    const isFreelance = name.includes('leandro') || name.includes('victor castro') || name.includes('monica') || name.includes('ricardo metola');
    const isGloria = name.includes('gloria buendia');

    // Calc Available Hours
    let totalAvailableSeconds = 0;
    const secsMonThu = 8.5 * 3600;
    const secsFri = 6 * 3600;
    const secsFreelance = 8 * 3600;
    const secsGloria = 7 * 3600;

    let loop = new Date(start);
    while (loop <= end) {
        const day = loop.getDay();
        const dStr = loop.toISOString().split('T')[0];
        if (day !== 0 && day !== 6 && (typeof HOLIDAYS === 'undefined' || !HOLIDAYS.includes(dStr))) {
            let daily = 0;
            if (isFreelance) {
                daily = secsFreelance;
            } else if (isGloria) {
                daily = secsGloria;
            } else {
                daily = (day === 5) ? secsFri : secsMonThu;
            }
            totalAvailableSeconds += daily; // Base capacity
        }
        loop.setDate(loop.getDate() + 1);
    }
    // Apply User FTE %
    totalAvailableSeconds = totalAvailableSeconds * (capacityPercent / 100);
    const availableHours = totalAvailableSeconds / 3600;

    const cats = { 'Facturable': 0, 'Pipeline': 0, 'Interno': 0, 'Operacional': 0 };
    const activeProjects = new Set();
    const pipelineProjects = new Set();

    if (plans) {
        plans.forEach(p => {
            // Since we queried Tempo for exact scope boundaries, we just use totalSeconds directly!
            const secs = p.totalSeconds || 0;
            if (secs > 0) {
                // Classify
                const pName = p.project ? (p.project.name || '') : '';
                const pKey = p.project ? (p.project.key || '') : '';

                // Fields from backend
                const iSummary = p.issueSummary ? p.issueSummary.toUpperCase() : '';
                const iKey = p.issueKey ? p.issueKey.toUpperCase() : '';

                let cat = 'Facturable';

                const n = pName.toUpperCase();
                const k = pKey.toUpperCase();

                const isInterno = n.includes('VACACION') || k.startsWith('VAC') || iSummary.includes('VACACION') ||
                    n === 'ABSENCE' || k.startsWith('AUS') || iSummary.includes('AUSENCIA') ||
                    iSummary.includes('BAJA') || iSummary.includes('PERMISO') || iSummary.includes('ABSENCE') ||
                    k === 'IN' || n.includes('INTERNO') || iSummary.includes('GESTION') ||
                    iSummary.includes('GESTIÓN') || iSummary.includes('REUNION') || iSummary.includes('OPERACIONAL');

                const isPreventa = n.includes('PREVENTA') || iSummary.includes('PREVENTA');

                if (!isInterno && !isPreventa) {
                    const identifier = pKey || pName || iKey || iSummary;
                    if (identifier) {
                        activeProjects.add(identifier);
                        if (n.includes('PIPE') || iSummary.includes('PIPE')) {
                            pipelineProjects.add(identifier);
                        }
                    }
                }

                if (pName.toUpperCase().includes('PIPE')) {
                    cat = 'Pipeline';
                } else if (isInterno && (n.includes('VACACION') || k.startsWith('VAC') || iSummary.includes('VACACION') || n === 'ABSENCE' || k.startsWith('AUS') || iSummary.includes('AUSENCIA') || iSummary.includes('BAJA') || iSummary.includes('PERMISO') || iSummary.includes('ABSENCE'))) {
                    cat = 'Interno';
                } else if (isInterno) {
                    cat = 'Operacional';
                }

                cats[cat] += secs;
            }
        });
    }
    const totalPlannedSeconds = cats['Facturable'] + cats['Pipeline'] + cats['Interno'] + cats['Operacional'];

    let isOverrideOn = false;
    if (monthKey && globalForecastData.manualIncludeOverrides) {
        if (globalForecastData.manualIncludeOverrides.has(String(member.accountId) + '_' + monthKey)) {
            isOverrideOn = true;
        }
    }

    return {
        available: (totalPlannedSeconds === 0 && !isOverrideOn) ? 0 : availableHours,
        totalPlannedSeconds: totalPlannedSeconds,
        isOverrideOn: isOverrideOn,
        memberAccountId: member.accountId,
        monthKey: monthKey,
        facturable: cats['Facturable'] / 3600,
        pipeline: cats['Pipeline'] / 3600,
        interno: cats['Interno'] / 3600,
        operacional: cats['Operacional'] / 3600,
        projectCount: activeProjects.size,
        pipelineCount: pipelineProjects.size
    };
}

window.toggleManualInclude = function (accountId, monthKey) {
    if (!globalForecastData.manualIncludeOverrides) {
        globalForecastData.manualIncludeOverrides = new Set();
    }
    const key = String(accountId) + '_' + monthKey;
    if (globalForecastData.manualIncludeOverrides.has(key)) {
        globalForecastData.manualIncludeOverrides.delete(key);
    } else {
        globalForecastData.manualIncludeOverrides.add(key);
    }

    try {
        localStorage.setItem('forecastManualIncludes', JSON.stringify(Array.from(globalForecastData.manualIncludeOverrides)));
    } catch (e) {
        console.error("Error saving manual includes to localStorage", e);
    }

    renderTeamForecastTable();
    renderTeamSummaryTable();
};

function renderMonthCell(stats) {
    const isZeroPlanning = stats.totalPlannedSeconds === 0;

    if (isZeroPlanning && stats.monthKey && stats.memberAccountId) {
        if (stats.isOverrideOn) {
            return `
                <div style="text-align:center; padding: 4px;">
                    <div style="font-size:0.85rem; font-weight:bold; color:#10b981; margin-bottom:4px;">Req: ${stats.available.toFixed(1)}h</div>
                    <button onclick="window.toggleManualInclude('${stats.memberAccountId}', '${stats.monthKey}')" style="font-size: 0.75rem; padding: 2px 6px; background:#fca5a5; color:#7f1d1d; border:1px solid #f87171; border-radius:4px; cursor:pointer;" title="Dejar de requerir horas">
                        No Requerir
                    </button>
                </div>
            `;
        } else {
            return `
                <div style="text-align:center;">
                    <span style="color:#ccc; display:block; margin-bottom:4px;">-</span>
                    <button onclick="window.toggleManualInclude('${stats.memberAccountId}', '${stats.monthKey}')" style="font-size: 0.75rem; padding: 2px 6px; background:#bbf7d0; color:#166534; border:1px solid #86efac; border-radius:4px; cursor:pointer;" title="Requerir horas a pesar de no tener planificación">
                        Sí Requerir
                    </button>
                </div>
            `;
        }
    }

    if (stats.available === 0 && !stats.isOverrideOn) return '<span style="color:#ccc;">-</span>';

    const totalPlanned = stats.facturable + stats.pipeline + stats.interno + stats.operacional;
    const occupancy = stats.available > 0 ? (totalPlanned / stats.available) * 100 : 0;

    // Color for Total Occupancy
    let color = '#ef4444'; // Red > 100
    if (occupancy < 75) color = '#f59e0b'; // Yellow
    else if (occupancy <= 100) color = '#10b981'; // Green

    // Bars
    // Calculate raw percentages based on total available
    const pFact = stats.available > 0 ? (stats.facturable / stats.available) * 100 : 0;
    const pPipe = stats.available > 0 ? (stats.pipeline / stats.available) * 100 : 0;
    const pInt = stats.available > 0 ? (stats.interno / stats.available) * 100 : 0;
    const pOpe = stats.available > 0 ? (stats.operacional / stats.available) * 100 : 0;

    let boxBg = '#f1f5f9';
    let boxText = '#475569';
    if (stats.projectCount === 0) {
        boxBg = '#ffedd5'; // orange-100
        boxText = '#c2410c'; // orange-700
    } else if (stats.projectCount === 1) {
        boxBg = '#fef9c3'; // yellow-100
        boxText = '#a16207'; // yellow-700
    } else if (stats.projectCount === 2) {
        boxBg = '#dcfce7'; // green-100
        boxText = '#166534'; // green-800
    } else if (stats.projectCount > 2) {
        boxBg = '#fee2e2'; // red-100
        boxText = '#991b1b'; // red-800
    }

    let text = `${stats.projectCount} ${stats.projectCount === 1 ? 'proy.' : 'proys.'}`;
    if (stats.pipelineCount > 0) {
        text += ` (${stats.pipelineCount} pipe)`;
    }
    let projectHtml = `<div style="font-size: 0.7rem; background: ${boxBg}; color: ${boxText}; padding: 2px 5px; border-radius: 12px; font-weight: 700; white-space: nowrap;" title="Proyectos facturables/pipeline activos">${text}</div>`;

    return `
                <div style="margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <div style="font-weight: 600; color: ${color}; font-size: 0.9rem;">
                        ${parseFloat(occupancy.toFixed(1))}% <span style="font-size:0.7rem; color:#666; font-weight:400;">(${parseFloat(totalPlanned.toFixed(2))}/${parseFloat(stats.available.toFixed(2))}h)</span>
                    </div>
                    ${projectHtml}
                </div>
                <div style="display:flex; height:6px; background:#e5e7eb; border-radius:3px; overflow:hidden; width: 100%;">
                    <div style="width:${Math.min(pFact, 100)}%; background:#10b981;" title="Facturable: ${stats.facturable.toFixed(1)}h"></div>
                    <div style="width:${Math.min(pInt, 100)}%; background:#6b7280;" title="Interno: ${stats.interno.toFixed(1)}h"></div>
                    <div style="width:${Math.min(pOpe, 100)}%; background:#f59e0b;" title="Operacional: ${stats.operacional.toFixed(1)}h"></div>
                    <div style="width:${Math.min(pPipe, 100)}%; background:#3b82f6;" title="Pipeline: ${stats.pipeline.toFixed(1)}h"></div>
                </div>
                <div style="display:flex; gap: 10px; font-size: 0.85rem; font-weight: 600; margin-top: 4px; flex-wrap: wrap;">
                    ${stats.facturable > 0 ? `<span style="color:#059669;">F:${parseFloat(pFact.toFixed(1))}%</span>` : ''}
                    ${stats.interno > 0 ? `<span style="color:#6b7280;">I:${parseFloat(pInt.toFixed(1))}%</span>` : ''}
                    ${stats.operacional > 0 ? `<span style="color:#d97706;">O:${parseFloat(pOpe.toFixed(1))}%</span>` : ''}
                    ${stats.pipeline > 0 ? `<span style="color:#2563eb;">P:${parseFloat(pPipe.toFixed(1))}%</span>` : ''}
                </div>
            `;
}

// --- PDF EXPORT LOGIC ---
async function exportSummaryToPDF() {
    const { jsPDF } = window.jspdf;
    const btn = document.querySelector('button[onclick="exportSummaryToPDF()"]');
    const originalBtnHtml = btn.innerHTML;

    try {
        btn.innerHTML = '⌛ Generando...';
        btn.disabled = true;

        const doc = new jsPDF('p', 'mm', 'a4'); // Portrait
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 10;

        // 1. Header (Logo Small Left, Title Center, Time Right/Top)
        const now = new Date();
        const dateStr = now.toLocaleDateString('es-ES') + ' ' + now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

        const logoUrl = 'images/nuevo-logo-altim.png';
        try {
            const logoImg = await loadImage(logoUrl);
            const ratio = logoImg.width / logoImg.height;
            doc.addImage(logoImg, 'PNG', margin, 5, 12 * ratio, 12); // Small logo
        } catch (e) { }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text('INFORME DE PLANIFICACIÓN Y OCUPACIÓN', pageWidth / 2, 12, { align: 'center' });

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(`Generado: ${dateStr}`, pageWidth - margin, 8, { align: 'right' });

        // 2. Capture Global View (Table + Chart) Side-by-Side
        const originalTeam = currentSummaryTeam;
        if (originalTeam !== 'All') {
            await setSummaryTeam('All');
            // Sufficient delay for chart and table rendering
            await new Promise(r => setTimeout(r, 450));
        }

        const tableContainer = document.getElementById('teamSummaryTableContainer');
        const chartContainer = document.getElementById('teamSummaryChartContainer');

        // Scale 1.5 is enough for A4 portrait
        const tableImg = await html2canvas(tableContainer, { scale: 1.5 });
        const chartImg = await html2canvas(chartContainer, { scale: 1.5 });

        let currentY = 22; // More space below logo/title
        const fullWidth = pageWidth - (margin * 2);

        // Global Table (A bit smaller)
        const tableRatio = tableImg.height / tableImg.width;
        const globalTableHeight = (fullWidth * 0.9) * tableRatio; // 90% width
        doc.addImage(tableImg, 'PNG', margin + (fullWidth * 0.05), currentY, fullWidth * 0.9, globalTableHeight);
        currentY += globalTableHeight + 6;

        // Global Chart (A bit smaller)
        const chartRatio = chartImg.height / chartImg.width;
        const globalChartHeight = Math.min((fullWidth * 0.9) * chartRatio, 55);
        doc.addImage(chartImg, 'PNG', margin + (fullWidth * 0.05), currentY, fullWidth * 0.9, globalChartHeight);
        currentY += globalChartHeight + 8;

        // 3. Team Breakdowns (Grid)
        const customOrder = ['OPE-PMO', 'OPE-FI', 'OPE-TES', 'OPE-CO&ING', 'OPE-LOG', 'OPE-DES', 'OPE-CX'];
        const detectedTeams = [...new Set(globalForecastData.members.map(m => m.teamName || 'Otros'))];
        const teams = detectedTeams.sort((a, b) => {
            const indexA = customOrder.indexOf(a);
            const indexB = customOrder.indexOf(b);
            if (indexA === -1 && indexB === -1) return a.localeCompare(b);
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
        });

        const tempContainer = document.getElementById('pdfExportTemp');
        tempContainer.style.width = "1050px"; // Safety width to avoid clipping borders
        tempContainer.style.background = "white";
        tempContainer.style.padding = "10px";

        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('PLANIFICACIÓN POR EQUIPOS', margin, currentY - 2);

        const colWidth = (pageWidth - (margin * 3)) / 2;

        for (let i = 0; i < teams.length; i++) {
            const teamName = teams[i];
            const teamMembers = globalForecastData.members.filter(m => (m.teamName || 'Otros') === teamName);
            const teamStats = calculateTeamAggregatedStats(teamMembers);

            // Render very compact HTML for PDF grid
            tempContainer.innerHTML = buildCompactTeamTable(teamName, teamStats);

            const teamTableImg = await html2canvas(tempContainer, { scale: 1.5 });
            const ratio = teamTableImg.height / teamTableImg.width;
            const targetHeight = colWidth * ratio;

            const colSize = colWidth;
            let xPos = 0;
            let rowY = 0;

            // Center last team if it's OPE-CX and is odd one out
            if (i === teams.length - 1 && teamName === 'OPE-CX' && i % 2 === 0) {
                xPos = (pageWidth - colWidth) / 2;
                rowY = currentY + (Math.floor(i / 2) * (targetHeight + 4));
            } else {
                const col = i % 2;
                const row = Math.floor(i / 2);
                xPos = margin + (col * (colWidth + margin));
                rowY = currentY + (row * (targetHeight + 4));
            }

            doc.addImage(teamTableImg, 'PNG', xPos, rowY, colWidth, targetHeight);
        }

        // Restore UI
        if (originalTeam !== 'All') setSummaryTeam(originalTeam);

        doc.save(`Informe_OPE_Global_${now.toISOString().split('T')[0]}.pdf`);

    } catch (err) {
        console.error("PDF Export Error:", err);
        alert("Error al generar el PDF.");
    } finally {
        btn.innerHTML = originalBtnHtml;
        btn.disabled = false;
    }
}

// Helper to build a VERY compact table for the PDF grid
function buildCompactTeamTable(teamName, globalStats) {
    const months = globalForecastData.months;
    const numFormat = (n) => typeof n === 'number' && !isNaN(n) ? n.toFixed(1) : '0';

    return `
        <div style="background: white; width: 1000px; font-family: 'Outfit', sans-serif; padding: 15px; border: 2px solid #000; box-sizing: border-box; margin: 0;">
            <div style="font-weight: 700; color: #1e293b; margin-bottom: 6px; font-size: 1.5rem; display: flex; align-items: center; gap: 8px;">
                <span style="background:#059669; width:4px; height:20px; border-radius:3px;"></span>
                ${teamName}
            </div>
            <table style="width:100%; border-collapse: collapse; text-align: center; border: 2px solid #000; font-size: 1.15rem; box-sizing: border-box;">
                <thead>
                    <tr style="background: #e2e8f0; border-bottom: 2px solid #000;">
                        <th style="padding: 10px; border: 2px solid #000; text-align: left; width: 220px; font-weight: 700; background: #e2e8f0;">CATEGORÍA</th>
                        ${months.map(m => `<th style="padding: 10px; border: 2px solid #000; font-weight: 700; background: #e2e8f0;">${m.label.substring(0, 3).toUpperCase()}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    <tr style="border-bottom: 2px solid #000;">
                        <td style="padding: 10px; text-align: left; font-weight: 600; background: #f8fafc; border: 2px solid #000; color: #334155;">Horas Requeridas</td>
                        ${months.map((_, idx) => `<td style="padding: 10px; font-weight: 600; background: #f8fafc; border: 2px solid #000; color: #334155;">${numFormat(globalStats[idx].available)}</td>`).join('')}
                    </tr>
                    <tr style="border-bottom: 2px solid #000;">
                        <td style="padding: 12px; text-align: left; font-weight: 700; background: #ecfdf5; border: 2px solid #000; color: #064e3b;">Facturable (%)</td>
                        ${months.map((_, idx) => {
        const pct = globalStats[idx].available > 0 ? (globalStats[idx].facturable / globalStats[idx].available) * 100 : 0;
        return `<td style="padding: 12px; font-weight: 800; background: #ecfdf5; border: 2px solid #000; color: #064e3b;">${numFormat(pct)}%</td>`;
    }).join('')}
                    </tr>
                    <tr style="border-bottom: 2px solid #000;">
                        <td style="padding: 10px; text-align: left; font-weight: 600; background: #f0fdf4; border: 2px solid #000; color: #064e3b;">Facturable (h)</td>
                        ${months.map((_, idx) => `<td style="padding: 10px; font-weight: 600; background: #f0fdf4; border: 2px solid #000; color: #064e3b;">${numFormat(globalStats[idx].facturable)}</td>`).join('')}
                    </tr>
                    <tr style="border-bottom: 2px solid #000;">
                        <td style="padding: 12px; text-align: left; font-weight: 700; background: #bfdbfe; border: 2px solid #000; color: #1e3a8a;">Pipe+Fact (%)</td>
                        ${months.map((_, idx) => {
        const total = globalStats[idx].facturable + globalStats[idx].pipeline;
        const pct = globalStats[idx].available > 0 ? (total / globalStats[idx].available) * 100 : 0;
        return `<td style="padding: 12px; font-weight: 800; background: #bfdbfe; border: 2px solid #000; color: #1e3a8a;">${numFormat(pct)}%</td>`;
    }).join('')}
                    </tr>
                    <tr style="border-bottom: 2px solid #000;">
                        <td style="padding: 10px; text-align: left; font-weight: 600; background: #eff6ff; border: 2px solid #000; color: #1e3a8a;">Pipe+Fact (h)</td>
                        ${months.map((_, idx) => `<td style="padding: 10px; font-weight: 600; background: #eff6ff; border: 2px solid #000; color: #1e3a8a;">${numFormat(globalStats[idx].facturable + globalStats[idx].pipeline)}</td>`).join('')}
                    </tr>
                    <tr style="border-bottom: 2px solid #000;">
                        <td style="padding: 12px; text-align: left; font-weight: 700; background: #fffbeb; border: 2px solid #000; color: #92400e;">P+F+I (%)</td>
                        ${months.map((_, idx) => {
        const total = globalStats[idx].facturable + globalStats[idx].pipeline + globalStats[idx].interno;
        const pct = globalStats[idx].available > 0 ? (total / globalStats[idx].available) * 100 : 0;
        return `<td style="padding: 12px; font-weight: 800; background: #fffbeb; border: 2px solid #000; color: #92400e;">${numFormat(pct)}%</td>`;
    }).join('')}
                    </tr>
                    <tr>
                        <td style="padding: 10px; text-align: left; font-weight: 600; background: #fff7ed; border: 2px solid #000; color: #92400e;">P+F+I (h)</td>
                        ${months.map((_, idx) => `<td style="padding: 10px; font-weight: 600; background: #fff7ed; border: 2px solid #000; color: #92400e;">${numFormat(globalStats[idx].facturable + globalStats[idx].pipeline + globalStats[idx].interno)}</td>`).join('')}
                    </tr>
                </tbody>
            </table>
        </div>
        `;
}

// Helper to load image
function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(e);
        img.src = url;
    });
}

// Helper to agg stats for a specific team
function calculateTeamAggregatedStats(members) {
    const months = globalForecastData.months;
    let stats = months.map(() => ({ available: 0, facturable: 0, pipeline: 0, interno: 0, operacional: 0 }));

    members.forEach(m => {
        months.forEach((monthObj, monthIndex) => {
            const allMonthlyPlans = globalForecastData.monthlyPlans[monthIndex] || [];
            const userMonthlyPlans = allMonthlyPlans.filter(p => String(p.assigneeAccountId) === String(m.accountId));
            const s = calculateMonthlyStats(userMonthlyPlans, monthObj.date, m, monthObj.key);

            stats[monthIndex].available += s.available;
            stats[monthIndex].facturable += s.facturable;
            stats[monthIndex].pipeline += s.pipeline;
            stats[monthIndex].interno += s.interno;
            stats[monthIndex].operacional += s.operacional;
        });
    });
    return stats;
}

window.updateForecastStartMonth = function () {
    const monthInput = document.getElementById('forecastStartMonth');
    if (!monthInput || !monthInput.value) return;

    // Parse the value "YYYY-MM"
    const [year, month] = monthInput.value.split('-');
    const startDate = new Date(year, parseInt(month) - 1, 1);

    // Call loadTeamForecast with current members and the new date
    if (globalForecastData && globalForecastData.members && globalForecastData.members.length > 0) {
        loadTeamForecast(globalForecastData.members, startDate);
    }
};
