const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs'); // Hashing for passwords
require('dotenv').config(); // Load environment variables
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Ignore self-signed certs

const app = express();
const PORT = process.env.PORT || 3000;

console.log("MANAGER DE OPERACIONES - Backend Version: Supabase Auth");

app.use(cors());
app.use(express.json());
// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// Specific raw body parser for upload endpoint to handle any file type
app.use('/api/upload', express.raw({ type: '*/*', limit: '50mb' }));

// --- FILE UPLOAD ENDPOINT (No Dependencies) ---
app.post('/api/upload', (req, res) => {
    try {
        const filename = req.query.filename || `upload_${Date.now()}.pdf`;
        const filePath = path.join(__dirname, '../public/uploads', filename);

        // Write buffered raw body directly to file
        fs.writeFile(filePath, req.body, (err) => {
            if (err) {
                console.error("File write error:", err);
                return res.status(500).json({ error: 'File save failed' });
            }
            res.json({
                success: true,
                url: `/uploads/${filename}`,
                filename: filename
            });
        });

    } catch (e) {
        console.error("Upload error:", e);
        res.status(500).json({ error: e.message });
    }
});

// ================= CONFIGURACIÓN =================
const TEMPO_TOKEN = process.env.TEMPO_TOKEN;
const JIRA_DOMAIN = process.env.JIRA_DOMAIN;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
// =================================================

const authJira = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
const jiraHeader = { 'Authorization': `Basic ${authJira}` };

// Holidays (Madrid/Spain 2020-2026) - Synced with Frontend
// Database Connection
const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Initialize DB Tables Automatically
async function initTables() {
    if (!process.env.DATABASE_URL) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) DEFAULT '1234',
                apps_access JSONB DEFAULT '{}'::jsonb
            )
        `);
        console.log("Tabla de 'usuarios' verificada/creada adecuadamente.");
    } catch (e) {
        console.error("Error creating tables:", e.message);
    }
}
initTables();

// Fallback Hardcoded Holidays (Madrid 2020-2027) - Used if DB fails
const DEFAULT_HOLIDAYS = [
    '2020-01-01', '2020-01-06', '2020-04-09', '2020-04-10', '2020-05-01', '2020-05-02', '2020-05-15', '2020-08-15', '2020-10-12', '2020-11-01', '2020-11-09', '2020-12-06', '2020-12-08', '2020-12-25',
    '2021-01-01', '2021-01-06', '2021-04-01', '2021-04-02', '2021-05-01', '2021-05-02', '2021-05-03', '2021-05-15', '2021-08-15', '2021-10-12', '2021-11-01', '2021-11-09', '2021-12-06', '2021-12-08', '2021-12-25',
    '2022-01-01', '2022-01-06', '2022-04-14', '2022-04-15', '2022-05-01', '2022-05-02', '2022-05-15', '2022-07-25', '2022-08-15', '2022-10-12', '2022-11-01', '2022-11-09', '2022-12-06', '2022-12-08', '2022-12-26',
    '2023-01-01', '2023-01-06', '2023-03-20', '2023-04-06', '2023-04-07', '2023-05-01', '2023-05-02', '2023-05-15', '2023-08-15', '2023-10-12', '2023-11-01', '2023-11-09', '2023-12-06', '2023-12-08', '2023-12-25',
    '2024-01-01', '2024-01-06', '2024-03-28', '2024-03-29', '2024-05-01', '2024-05-02', '2024-05-15', '2024-07-25', '2024-08-15', '2024-10-12', '2024-11-01', '2024-12-06', '2024-12-09', '2024-12-25',
    '2025-01-01', '2025-01-06', '2025-04-17', '2025-04-18', '2025-05-01', '2025-05-02', '2025-05-15', '2025-07-25', '2025-08-15', '2025-11-01', '2025-11-10', '2025-12-06', '2025-12-08', '2025-12-25',
    '2026-01-01', '2026-01-06', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-02', '2026-05-15', '2026-07-25', '2026-08-15', '2026-10-12', '2026-11-01', '2026-11-09', '2026-12-06', '2026-12-08', '2026-12-25',
    '2027-01-01', '2027-01-06', '2027-03-25', '2027-03-26', '2027-05-01', '2027-05-03', '2027-08-16', '2027-10-12', '2027-11-01', '2027-12-06', '2027-12-08', '2027-12-25'
];

// Helper to fetch holidays
async function getActiveHolidays() {
    if (!process.env.DATABASE_URL) return new Set(DEFAULT_HOLIDAYS);
    try {
        const res = await pool.query('SELECT date FROM holidays WHERE is_active = true');
        const dbHolidays = res.rows.map(r => {
            const d = new Date(r.date);
            return d.toISOString().split('T')[0];
        });
        return new Set([...DEFAULT_HOLIDAYS, ...dbHolidays]); // Merge for safety or just return DB
    } catch (e) {
        console.error('Error fetching holidays from DB:', e.message);
        return new Set(DEFAULT_HOLIDAYS);
    }
}

// 0. Configuration Endpoints
app.get('/api/holidays', async (req, res) => {
    try {
        if (!process.env.DATABASE_URL) {
            return res.json(DEFAULT_HOLIDAYS.map(d => ({ date: d, is_active: true })));
        }

        let result = await pool.query('SELECT * FROM holidays ORDER BY date ASC');

        // Auto-seed if empty
        if (result.rows.length === 0) {
            console.log('DB empty. Seeding default holidays...');
            for (const d of DEFAULT_HOLIDAYS) {
                await pool.query(`INSERT INTO holidays (date, name, is_active) VALUES ($1, 'Festivo Madrid', true) ON CONFLICT DO NOTHING`, [d]);
            }
            result = await pool.query('SELECT * FROM holidays ORDER BY date ASC');
        }

        const formatted = result.rows.map(r => ({
            ...r,
            date: new Date(r.date).toISOString().split('T')[0]
        }));
        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).send('Error fetching holidays');
    }
});

app.post('/api/holidays/toggle', async (req, res) => {
    try {
        const { date, is_active } = req.body;
        if (!process.env.DATABASE_URL) return res.status(503).send('Database not configured');

        await pool.query(`
            INSERT INTO holidays (date, name, is_active)
            VALUES ($1, 'Custom Holiday', $2)
            ON CONFLICT (date) DO UPDATE SET is_active = $2
        `, [date, is_active]);

        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).send('Error updating holiday');
    }
});


// --- ENDPOINTS: GESTOR DE USUARIOS (CSV BASED) ---
const CSV_FILE = path.join(__dirname, '../usuarios.csv');

function readUsuarios() {
    if (!fs.existsSync(CSV_FILE)) return [];
    const data = fs.readFileSync(CSV_FILE, 'utf8');
    const lines = data.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length <= 1) return []; // Only header

    const users = [];
    for (let i = 1; i < lines.length; i++) {
        const [id, name, email, password, apps] = lines[i].split(',');
        const appsArr = apps ? apps.split('|') : [];
        users.push({
            id: parseInt(id),
            name,
            email,
            password,
            apps_access: {
                accOpe: appsArr.includes('ope'),
                accProj: appsArr.includes('teams'),
                accConf: appsArr.includes('config')
            }
        });
    }
    return users;
}

function writeUsuarios(users) {
    let content = 'id,name,email,password,apps\n';
    users.forEach(u => {
        const apps = [];
        if (u.apps_access.accOpe) apps.push('ope');
        if (u.apps_access.accProj) apps.push('teams');
        if (u.apps_access.accConf) apps.push('config');
        content += `${u.id},${u.name},${u.email},${u.password},${apps.join('|')}\n`;
    });
    fs.writeFileSync(CSV_FILE, content, 'utf8');
}

app.get('/api/usuarios', (req, res) => {
    try {
        const users = readUsuarios();
        // Remove password before sending to frontend
        const safeUsers = users.map(({ password, ...rest }) => rest);
        res.json(safeUsers);
    } catch (e) {
        console.error(e);
        res.status(500).send('Error fetching users from CSV');
    }
});

app.post('/api/usuarios', (req, res) => {
    try {
        const { name, email, password, accOpe, accProj, accConf } = req.body;
        const users = readUsuarios();
        const newUser = {
            id: Date.now(),
            name,
            email,
            password: password || '1234', // Default password if empty
            apps_access: { accOpe, accProj, accConf }
        };
        users.push(newUser);
        writeUsuarios(users);
        const { password: _, ...safeUser } = newUser;
        res.json(safeUser);
    } catch (e) {
        console.error(e);
        res.status(500).send('Error creating user in CSV');
    }
});

app.put('/api/usuarios/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { name, email, password, accOpe, accProj, accConf } = req.body;
        const users = readUsuarios();
        const index = users.findIndex(u => u.id === id);

        if (index === -1) return res.status(404).send('User not found');

        users[index].name = name;
        users[index].email = email;
        if (password && password.trim() !== '') {
            users[index].password = password; // Only update if provided
        }
        users[index].apps_access = { accOpe, accProj, accConf };

        writeUsuarios(users);
        const { password: _, ...safeUser } = users[index];
        res.json(safeUser);
    } catch (e) {
        console.error(e);
        res.status(500).send('Error updating user in CSV');
    }
});

app.delete('/api/usuarios/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const users = readUsuarios();
        const newUsers = users.filter(u => u.id !== id);
        writeUsuarios(newUsers);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).send('Error deleting user in CSV');
    }
});

app.post('/api/login', (req, res) => {
    try {
        const { email, password } = req.body;
        const users = readUsuarios();

        const user = users.find(u => u.email === email && u.password === password);
        if (user) {
            const apps = [];
            if (user.apps_access.accOpe) apps.push('ope');
            if (user.apps_access.accProj) apps.push('teams');
            if (user.apps_access.accConf) apps.push('config');

            return res.json({
                success: true,
                email: user.email,
                name: user.name, // Added name
                apps: apps
            });
        }
        return res.status(401).json({ success: false, error: 'Credenciales incorrectas' });
    } catch (e) {
        console.error("Login error:", e);
        return res.status(500).json({ success: false, error: 'Internal error' });
    }
});

// 1. Obtener proyectos de tipo Software y en estado IN PROGRESS (Prefijo OPE)
app.get('/api/proyectos', async (req, res) => {
    try {
        console.log("Fetching all projects...");
        let allProjects = [];
        let isLast = false;
        let startAt = 0;
        const maxResults = 100;

        // A. Fetch All Jira Projects
        while (!isLast) {
            const response = await axios.get(`${JIRA_DOMAIN}/rest/api/3/project/search?type=software&maxResults=${maxResults}&startAt=${startAt}`, { headers: jiraHeader });
            const values = response.data.values;
            allProjects = allProjects.concat(values);

            isLast = response.data.isLast;
            startAt += values.length;

            if (startAt > 2000) isLast = true;
        }

        let projects = allProjects.filter(p =>
            p.projectTypeKey === 'software' &&
            !p.archived
        );

        console.log(`Found ${projects.length} active software projects. Fetching Tempo Plans to filter...`);

        // B. Fetch All Tempo Plans to identify Active Projects
        const planProjectKeys = new Set();
        const searchUrl = 'https://api.tempo.io/4/plans/search';
        // Broad range to catch relevant plans
        const fromDate = '2024-01-01';
        const toDate = '2027-12-31';

        let allPlans = [];
        let offset = 0;
        let morePlans = true;

        // Fetch plans in batches
        while (morePlans) {
            try {
                const response = await axios.post(searchUrl, {
                    from: fromDate,
                    to: toDate,
                    offset: offset,
                    limit: 1000 // Max limit
                }, { headers: { 'Authorization': `Bearer ${TEMPO_TOKEN}` } });

                const results = response.data.results;
                allPlans = allPlans.concat(results);

                if (results.length < 1000) {
                    morePlans = false;
                } else {
                    offset += 1000;
                }
            } catch (err) {
                console.error('Error fetching plans for filtering:', err.message);
                morePlans = false;
            }
        }

        console.log(`Fetched ${allPlans.length} plans. Resolving projects...`);

        // C. Extract Project Info from Plans
        const issueIds = new Set();

        allPlans.forEach(p => {
            if (p.planItem.type === 'PROJECT') {
                // If we have Project ID, we might need to map it to Key. 
                // But we have `projects` array with IDs.
                // Let's store IDs too?
                // The `projects` list has .id (string) and .key
                // We'll filter by both.
            } else if (p.planItem.type === 'ISSUE') {
                issueIds.add(p.planItem.id);
            }
        });

        // Resolve Issues to Projects
        if (issueIds.size > 0) {
            const ids = Array.from(issueIds);
            const CHUNK_SIZE = 100; // Safe for JQL

            for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
                const chunk = ids.slice(i, i + CHUNK_SIZE);
                // JQL: id in (...)
                const jql = `id in (${chunk.join(',')})`;

                try {
                    const searchRes = await axios.post(`${JIRA_DOMAIN}/rest/api/3/search/jql`, {
                        jql: jql,
                        fields: ['project'],
                        maxResults: 100 // Should match chunk size
                    }, { headers: jiraHeader });

                    if (searchRes.data.issues) {
                        searchRes.data.issues.forEach(issue => {
                            if (issue.fields && issue.fields.project) {
                                planProjectKeys.add(issue.fields.project.key);
                                planProjectKeys.add(issue.fields.project.id); // Add ID too to be safe
                            }
                        });
                    }
                } catch (e) {
                    console.error("Error resolving issue projects:", e.message);
                }
            }
        }

        // Also add PROJECT type plans (direct IDs)
        allPlans.forEach(p => {
            if (p.planItem.type === 'PROJECT') {
                planProjectKeys.add(String(p.planItem.id));
            }
        });

        console.log(`Identified ${planProjectKeys.size} active projects with plans.`);

        // D. Filter result
        // Condition: (Has Plans) AND ( (Name starts with OPE) OR (Name includes PIPELINE) )
        const finalProjects = projects.filter(p => {
            const hasPlans = planProjectKeys.has(p.key) || planProjectKeys.has(p.id);
            if (!hasPlans) return false;

            const nameUpper = p.name.toUpperCase();
            const matchesName = nameUpper.startsWith('OPE') || nameUpper.includes('PIPELINE');

            return matchesName;
        });

        res.json(finalProjects);
    } catch (e) {
        console.error('Error fetching/filtering projects:', e.message);
        res.status(500).send('Error al obtener proyectos');
    }
});

// 1.5. Obtener Equipos OPE de Tempo
app.get('/api/teams', async (req, res) => {
    try {
        console.log("Fetching OPE teams from Tempo...");

        // Fetch ALL Teams with pagination
        let allTeams = [];
        let teamNext = 'https://api.tempo.io/4/teams';

        while (teamNext) {
            const teamRes = await axios.get(teamNext, {
                headers: { 'Authorization': `Bearer ${TEMPO_TOKEN}` }
            });
            allTeams = allTeams.concat(teamRes.data.results);
            teamNext = teamRes.data.metadata && teamRes.data.metadata.next ? teamRes.data.metadata.next : null;
        }

        console.log(`Fetched ${allTeams.length} teams from Tempo`);

        // Return all teams (filtering will be done on frontend)
        res.json(allTeams);

    } catch (e) {
        console.error('Error fetching teams:', e.message);
        res.status(500).send('Error al obtener equipos');
    }
});

// 1.5.1. Obtener Recursos Genéricos (Dummys)
app.get('/api/generic-resources', async (req, res) => {
    try {
        console.log("[GENERIC] Fetching generic resources from Tempo (POST /generic-resources/search)...");
        let allGenerics = [];
        let url = 'https://api.tempo.io/4/generic-resources/search';
        let more = true;
        let offset = 0;
        const limit = 1000;

        while (more) {
            console.log(`[GENERIC] Fetching offset ${offset} (limit ${limit})...`);
            const response = await axios.post(url, { offset, limit }, { headers: { 'Authorization': `Bearer ${TEMPO_TOKEN}` } });

            const results = response.data.results || [];
            allGenerics = allGenerics.concat(results);

            console.log(`[GENERIC] Received ${results.length} results.`);

            // Use metadata.count to decide if more pages exist
            if (response.data.metadata && response.data.metadata.count > (offset + limit)) {
                offset += limit;
            } else {
                more = false;
            }

            // Safety break
            if (results.length === 0) more = false;
        }

        console.log(`[GENERIC] Total fetched: ${allGenerics.length}`);
        res.json(allGenerics);
    } catch (e) {
        console.error('[GENERIC] Error:', e.response ? JSON.stringify(e.response.data) : e.message);
        res.status(500).send('Error al obtener recursos genéricos');
    }
});

// 1.6. NEW: Get Team Breakdown (Forecast)
app.get('/api/teams/:id/breakdown', async (req, res) => {
    try {
        const { id } = req.params;
        const { from, to } = req.query; // Usually 3 months range

        console.log(`Fetching breakdown for team ${id} from ${from} to ${to}...`);

        // 1. Fetch Team Members
        let members = [];
        let memberNext = `https://api.tempo.io/4/teams/${id}/members`;
        while (memberNext) {
            const mRes = await axios.get(memberNext, { headers: { 'Authorization': `Bearer ${TEMPO_TOKEN}` } });
            members = members.concat(mRes.data.results);
            memberNext = mRes.data.metadata && mRes.data.metadata.next ? mRes.data.metadata.next : null;
        }

        // Filter active members and get Account IDs
        const accountIds = members.map(m => m.member.accountId).filter(id => id);

        // 2. Fetch Plans for these members in range
        let allPlans = [];
        // Tempo Search Limit is strict, chunk by members if needed. 
        // For typical team size (10-20), one call might work, but let's be safe with chunking (50 members).
        const CHUNK_SIZE = 50;

        for (let i = 0; i < accountIds.length; i += CHUNK_SIZE) {
            const chunk = accountIds.slice(i, i + CHUNK_SIZE);
            if (chunk.length === 0) continue;

            const searchUrl = 'https://api.tempo.io/4/plans/search';
            let offset = 0;
            let morePlans = true;

            while (morePlans) {
                try {
                    const response = await axios.post(searchUrl, {
                        from: from,
                        to: to,
                        accountIds: chunk,
                        offset: offset,
                        limit: 1000
                    }, { headers: { 'Authorization': `Bearer ${TEMPO_TOKEN}` } });

                    const results = response.data.results;
                    allPlans = allPlans.concat(results);

                    if (results.length < 1000) morePlans = false;
                    else offset += 1000;
                } catch (e) {
                    console.error("Error fetching team plans chunk:", e.message);
                    morePlans = false;
                }
            }
        }

        // 3. Resolve Project Keys for Plans (Plan Item -> Project Key)
        // We need to know if a plan is Facturable/Internal/Pipeline based on Project Key/Name.
        // Plan object usually has `planItem`. If TYPE is PROJECT, we have ID. If ISSUE, we have ID.
        // We need to fetch details for these items to get Key/Name.

        // Collect IDs to resolve
        const projectIds = new Set();
        const issueIds = new Set();

        allPlans.forEach(p => {
            if (p.planItem.type === 'PROJECT') projectIds.add(p.planItem.id);
            else if (p.planItem.type === 'ISSUE') issueIds.add(p.planItem.id);
        });

        const projectMap = {}; // ID -> { key, name }

        // Batch Resolve Issues -> Project Key
        if (issueIds.size > 0) {
            const ids = Array.from(issueIds);
            const C_SIZE = 100;
            for (let i = 0; i < ids.length; i += C_SIZE) {
                const chunk = ids.slice(i, i + C_SIZE);
                try {
                    const sRes = await axios.post(`${JIRA_DOMAIN}/rest/api/3/search/jql`, {
                        jql: `id in (${chunk.join(',')})`,
                        fields: ['project', 'summary'], // Summary might help if needed
                        maxResults: 100
                    }, { headers: jiraHeader });

                    sRes.data.issues.forEach(iss => {
                        if (iss.fields.project) {
                            // Map Issue ID to Project Info
                            projectMap[`ISSUE:${iss.id}`] = {
                                key: iss.fields.project.key,
                                name: iss.fields.project.name
                            };
                        }
                    });
                } catch (e) { console.error("Error resolving issue chunk:", e.message); }
            }
        }

        // Batch Resolve Projects (Direct IDs) -> Key
        if (projectIds.size > 0) {
            // Jira doesn't have a bulk get projects by ID endpoint easily (search is for issues).
            // We can iterate or try to cache. Since typically few unique projects, simple loop might suffice or GET /project/ID
            // Optimization: Load ALL projects is heavy. Let's do one by one for now (or improve if slow).
            const pIds = Array.from(projectIds);
            await Promise.all(pIds.map(async (pid) => {
                try {
                    const pRes = await axios.get(`${JIRA_DOMAIN}/rest/api/3/project/${pid}`, { headers: jiraHeader });
                    projectMap[`PROJECT:${pid}`] = {
                        key: pRes.data.key,
                        name: pRes.data.name
                    };
                } catch (e) { console.error(`Project ${pid} resolve failed`); }
            }));
        }

        // 4. Aggregate Data
        // Structure: result[accountId] = [ { month: '2026-02', [cat]: hours, capacity: totalHours }, ... ]
        // We need to return raw plan data + project info so frontend can sum.
        // Returning processed simplified plans seems best to reduce frontend load.

        const simplifiedPlans = allPlans.map(p => {
            let pInfo = null;
            if (p.planItem.type === 'PROJECT') pInfo = projectMap[`PROJECT:${p.planItem.id}`];
            else if (p.planItem.type === 'ISSUE') pInfo = projectMap[`ISSUE:${p.planItem.id}`];

            return {
                ...p,
                projectKey: pInfo ? pInfo.key : 'UNKNOWN',
                projectName: pInfo ? pInfo.name : 'Unknown'
            };
        });

        res.json({
            members: members.map(m => ({
                accountId: m.member.accountId,
                displayName: m.member.displayName,
                avatarUrl: m.member.avatarUrl
            })),
            plans: simplifiedPlans
        });

    } catch (e) {
        console.error('Error in team breakdown:', e);
        res.status(500).send('Error calculating breakdown');
    }
});

// 1.8. Obtener SOLO IDs de Miembros con Planes en un Proyecto (Súper Rápido)
app.get('/api/project-member-ids/:projectKey', async (req, res) => {
    try {
        const { projectKey } = req.params;
        const from = '2024-01-01';
        const to = '2026-12-31';

        console.log(`Rapid discovery: Finding member IDs for project ${projectKey}...`);

        // 1. Resolve Project numeric ID (for direct plans)
        let projectId = null;
        try {
            const pRes = await axios.get(`${JIRA_DOMAIN}/rest/api/3/project/${projectKey}`, { headers: jiraHeader });
            projectId = pRes.data.id;
        } catch (e) {
            console.error(`Project ${projectKey} not found in Jira`);
            return res.status(404).send('Proyecto no encontrado');
        }

        // 2. Fetch all issue IDs for the project
        let projectIssueIds = [];
        let nextToken = null;
        let hasMoreIssues = true;
        while (hasMoreIssues) {
            try {
                const jqlPayload = { jql: `project = ${projectKey}`, fields: ['id'], maxResults: 100 };
                if (nextToken) jqlPayload.nextPageToken = nextToken;
                const searchRes = await axios.post(`${JIRA_DOMAIN}/rest/api/3/search/jql`, jqlPayload, { headers: jiraHeader });
                const issues = searchRes.data.issues || [];
                if (issues.length > 0) projectIssueIds = projectIssueIds.concat(issues.map(i => parseInt(i.id)));
                nextToken = searchRes.data.nextPageToken;
                if (!nextToken) hasMoreIssues = false;
            } catch (e) { hasMoreIssues = false; }
        }

        // 3. Search Plans for PROJECT item and all ISSUE items
        const assignees = new Set();
        const searchUrl = 'https://api.tempo.io/4/plans/search';

        // Check Project Level Plans
        try {
            const pPlans = await axios.post(searchUrl, {
                from, to, planItemIds: [parseInt(projectId)], planItemTypes: ['PROJECT']
            }, { headers: { 'Authorization': `Bearer ${TEMPO_TOKEN}` } });
            pPlans.data.results.forEach(p => { if (p.assignee) assignees.add(p.assignee.id); });
        } catch (e) { console.error("Error project plans:", e.message); }

        // Check Issue Level Plans (Batched)
        const CHUNK_SIZE = 400;
        for (let i = 0; i < projectIssueIds.length; i += CHUNK_SIZE) {
            const chunk = projectIssueIds.slice(i, i + CHUNK_SIZE);
            try {
                const iPlans = await axios.post(searchUrl, {
                    from, to, planItemIds: chunk, planItemTypes: ['ISSUE'], limit: 1000
                }, { headers: { 'Authorization': `Bearer ${TEMPO_TOKEN}` } });
                iPlans.data.results.forEach(p => { if (p.assignee) assignees.add(p.assignee.id); });
            } catch (e) { console.error("Error issue plans chunk:", e.message); }
        }

        const resultIds = Array.from(assignees);
        console.log(`Rapid discovery found ${resultIds.length} assignees for ${projectKey}.`);
        res.json({ accountIds: resultIds });

    } catch (e) {
        console.error('Error in rapid member discovery:', e.message);
        res.status(500).send('Error');
    }
});

app.get('/api/reporte/:projectKey/:projectId', async (req, res) => {
    try {
        const { projectKey } = req.params;
        const { from, to } = req.query;

        console.log(`Fetching Tempo Worklogs & Plans for ${projectKey} from ${from} to ${to}...`);

        // --- FILTERING LOGIC: User wants to see resources "correctly" (OPE Teams logic) ---
        // 1. Fetch All OPE Teams and their Members for allowed list
        let allowedAccountIds = new Set();
        try {
            // A. Fetch ALL Teams (Pagination)
            let allTeams = [];
            let teamNext = 'https://api.tempo.io/4/teams';
            while (teamNext) {
                const teamRes = await axios.get(teamNext, { headers: { 'Authorization': `Bearer ${TEMPO_TOKEN}` } });
                allTeams = allTeams.concat(teamRes.data.results);
                teamNext = teamRes.data.metadata && teamRes.data.metadata.next ? teamRes.data.metadata.next : null;
            }

            // Filter OPE teams (exclude CLOUD/GENERICO as per frontend logic)
            const opeTeams = allTeams.filter(t => {
                const name = t.name.toUpperCase();
                const norm = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                return name.startsWith("OPE") && !norm.includes("CLOUD") && !norm.includes("GENERICO");
            });

            console.log(`Found ${opeTeams.length} OPE Teams. Fetching members for filter...`);

            // B. Fetch members for these teams (Pagination per team)
            for (const team of opeTeams) {
                let memberNext = `https://api.tempo.io/4/teams/${team.id}/members?limit=1000`;
                while (memberNext) {
                    try {
                        const mRes = await axios.get(memberNext, { headers: { 'Authorization': `Bearer ${TEMPO_TOKEN}` } });
                        mRes.data.results.forEach(m => {
                            if (m.member.accountId) allowedAccountIds.add(m.member.accountId);
                        });
                        memberNext = mRes.data.metadata && mRes.data.metadata.next ? mRes.data.metadata.next : null;
                    } catch (err) {
                        console.error(`Error fetching members for team ${team.name}:`, err.message);
                        break; // Skip to next team on error
                    }
                }
            }
            console.log(`Allowed OPE Resources count: ${allowedAccountIds.size}`);

        } catch (e) {
            console.error("Error fetching OPE team members for filter:", e.message);
            // If error, do NOT block results, just fallback to ALL (or maybe empty? Fallback safe)
            allowedAccountIds = null;
        }

        let allWorklogs = [];
        let allPlans = [];

        // Parallel Fetching functions
        const fetchWorklogs = async () => {
            let nextUrl = `https://api.tempo.io/4/worklogs?from=${from}&to=${to}&projectKey=${projectKey}&limit=1000`;
            while (nextUrl) {
                try {
                    const response = await axios.get(nextUrl, { headers: { 'Authorization': `Bearer ${TEMPO_TOKEN}` } });
                    allWorklogs = allWorklogs.concat(response.data.results);
                    nextUrl = response.data.metadata && response.data.metadata.next ? response.data.metadata.next : null;
                } catch (err) {
                    console.error('Error fetching worklogs:', err.message);
                    break;
                }
            }
        };

        const fetchPlans = async () => {
            try {
                // 1. Fetch ALL Issue IDs for the Project from Jira (using new API)
                let projectIssueIds = [];
                let nextToken = null;
                let hasMoreIssues = true;

                console.log(`Fetching issues for project ${projectKey}...`);

                while (hasMoreIssues) {
                    try {
                        const jqlPayload = {
                            jql: `project = ${projectKey}`,
                            fields: ['id'],
                            maxResults: 100
                        };
                        if (nextToken) jqlPayload.nextPageToken = nextToken;

                        const searchRes = await axios.post(`${JIRA_DOMAIN}/rest/api/3/search/jql`, jqlPayload, { headers: jiraHeader });

                        const issues = searchRes.data.issues || [];
                        if (issues.length > 0) {
                            projectIssueIds = projectIssueIds.concat(issues.map(i => parseInt(i.id)));
                        }

                        nextToken = searchRes.data.nextPageToken;
                        if (!nextToken) hasMoreIssues = false;

                    } catch (e) {
                        console.error('Error fetching project issues:', e.message);
                        hasMoreIssues = false;
                    }
                }
                console.log(`Found ${projectIssueIds.length} issues for ${projectKey}. fetching plans...`);

                if (projectIssueIds.length === 0) return;

                // 2. Search Tempo Plans by PlanItemIds (Batched)
                // Tempo limit is likely ~500 items in filter. We'll use 400.
                const CHUNK_SIZE = 400;
                const searchUrl = 'https://api.tempo.io/4/plans/search';

                for (let i = 0; i < projectIssueIds.length; i += CHUNK_SIZE) {
                    const chunk = projectIssueIds.slice(i, i + CHUNK_SIZE);

                    let offset = 0;
                    const limit = 500;
                    let morePlans = true;

                    while (morePlans) {
                        try {
                            const response = await axios.post(searchUrl, {
                                from: from,
                                to: to,
                                planItemIds: chunk, // Note: This misses plans on Project itself. User didn't ask to fix this specifically, but "Logic of Team Tab" implies Resources.
                                planItemTypes: ['ISSUE'],
                                offset: offset,
                                limit: limit
                            }, { headers: { 'Authorization': `Bearer ${TEMPO_TOKEN}` } });

                            const results = response.data.results;
                            allPlans = allPlans.concat(results);

                            if (results.length < limit) {
                                morePlans = false;
                            } else {
                                offset += limit;
                            }
                        } catch (err) {
                            console.error('Error fetching plans chunk:', err.message);
                            morePlans = false;
                        }
                    }
                }

            } catch (err) {
                console.error('Error in fetchPlans logic:', err.message);
            }
        };

        await Promise.all([fetchWorklogs(), fetchPlans()]);

        console.log(`Fetched ${allWorklogs.length} worklogs and ${allPlans.length} plans.`);

        // FILTER RESOURCES if allowedAccountIds is Set
        if (allowedAccountIds) {
            allWorklogs = allWorklogs.filter(w => allowedAccountIds.has(w.author.accountId));
            allPlans = allPlans.filter(p => allowedAccountIds.has(p.assignee.id));
            console.log(`After filtering by OPE Membership: ${allWorklogs.length} worklogs, ${allPlans.length} plans.`);
        }

        // Map to simple structure
        const worklogs = allWorklogs.map(w => ({
            id: w.tempoWorklogId,
            author: w.author.accountId,
            date: w.startDate,
            seconds: w.timeSpentSeconds
        }));

        const plans = allPlans.map(p => ({
            id: p.id,
            assignee: p.assignee.id,
            date: p.startDate,
            seconds: p.totalPlannedSeconds
        }));

        // Resolve User Names (Account ID -> Display Name + Avatar)
        const uniqueAuthors = [...new Set([...worklogs.map(w => w.author), ...plans.map(p => p.assignee)])];
        const userMap = {};
        const userAvatars = {};

        console.log(`Resolving names for ${uniqueAuthors.length} users...`);

        await Promise.all(uniqueAuthors.map(async (accountId) => {
            try {
                if (!accountId) return;
                const userRes = await axios.get(`${JIRA_DOMAIN}/rest/api/3/user?accountId=${accountId}`, { headers: jiraHeader });
                userMap[accountId] = userRes.data.displayName;
                userAvatars[accountId] = userRes.data.avatarUrls['48x48'];
            } catch (e) {
                userMap[accountId] = 'Unknown User';
            }
        }));

        res.json({ worklogs, plans, userMap, userAvatars });

    } catch (error) {
        console.error('Error in /api/reporte:', error.message);
        res.status(500).json({ error: 'Error en el reporte' });
    }
});

// 3. Obtener datos para el Gantt (FILTRADO: summary ~ "planificacion")
app.get('/api/gantt/:projectKey', async (req, res) => {
    try {
        const { projectKey } = req.params;
        const jql = `project=${projectKey} AND summary ~ "planificacion" ORDER BY created ASC`;

        // Use POST /rest/api/3/search/jql to avoid 410 error
        const response = await axios.post(`${JIRA_DOMAIN}/rest/api/3/search/jql`, {
            jql: jql,
            fields: ['summary', 'duedate', 'created'],
            maxResults: 100
        }, { headers: jiraHeader });
        const tasks = response.data.issues.map(issue => ({
            id: issue.key,
            name: `[${issue.key}] ${issue.fields.summary}`,
            start: issue.fields.created.split('T')[0],
            end: issue.fields.duedate || new Date().toISOString().split('T')[0],
            progress: 100
        }));
        res.json(tasks);
    } catch (error) { res.status(500).send('Error en Gantt'); }
});

// 3b. Obtener Listado Completo de Tareas (Status, Assignee, Dates)
app.get('/api/project_tasks/:projectKey', async (req, res) => {
    try {
        const { projectKey } = req.params;
        const jql = `project=${projectKey} ORDER BY created DESC`;

        let allIssues = [];
        let nextToken = null;
        let hasMore = true;

        while (hasMore) {
            const payload = {
                jql: jql,
                fields: ['summary', 'status', 'assignee', 'created', 'duedate'],
                maxResults: 100
            };
            if (nextToken) payload.nextPageToken = nextToken;

            const response = await axios.post(`${JIRA_DOMAIN}/rest/api/3/search/jql`, payload, { headers: jiraHeader });
            allIssues = allIssues.concat(response.data.issues);

            nextToken = response.data.nextPageToken;
            if (!nextToken || allIssues.length >= 500) hasMore = false; // Cap at 500 for safety
        }

        const tasks = allIssues.map(issue => ({
            key: issue.key,
            summary: issue.fields.summary,
            status: issue.fields.status.name,
            assignee: issue.fields.assignee ? issue.fields.assignee.displayName : 'Sin Asignar',
            created: issue.fields.created.split('T')[0],
            duedate: issue.fields.duedate || '-'
        }));
        res.json(tasks);
    } catch (error) {
        console.error("Error fetching project tasks:", error.message);
        res.status(500).send('Error fetching tasks');
    }
});

// 4. Obtener Equipos Tempo
app.get('/api/teams', async (req, res) => {
    try {
        const response = await axios.get('https://api.tempo.io/4/teams', {
            headers: { 'Authorization': `Bearer ${TEMPO_TOKEN}` }
        });
        res.json(response.data.results); // Just return list of teams
    } catch (e) {
        console.error('Error fetching teams:', e.message);
        res.status(500).send('Error fetching teams');
    }
});

// 5. Obtener Miembros de un Equipo (con Nombres resueltos)
app.get('/api/teams/:teamId/members', async (req, res) => {
    try {
        const { teamId } = req.params;

        // 1. Get Members from Tempo
        const memRes = await axios.get(`https://api.tempo.io/4/teams/${teamId}/members`, {
            headers: { 'Authorization': `Bearer ${TEMPO_TOKEN}` }
        });
        const members = memRes.data.results;

        // 2. Resolve Names via Jira
        const enrichedMembers = await Promise.all(members.map(async (m) => {
            const accountId = m.member.accountId;
            let displayName = 'Unknown';
            let avatarUrl = '';

            if (accountId) {
                try {
                    const userRes = await axios.get(`${JIRA_DOMAIN}/rest/api/3/user?accountId=${accountId}`, { headers: jiraHeader });
                    displayName = userRes.data.displayName;
                    avatarUrl = userRes.data.avatarUrls['48x48'];
                } catch (e) {
                    // console.error(`Failed to resolve user ${accountId}`);
                }
            }

            // Extract Role from active membership
            const activeMembership = m.memberships.active;
            const role = activeMembership && activeMembership.role ? activeMembership.role.name : 'Sin Rol';
            const availability = activeMembership ? activeMembership.commitmentPercent : 0;
            const joined = activeMembership && activeMembership.from ? activeMembership.from : 'N/A';

            return {
                accountId,
                displayName,
                avatarUrl,
                role,
                availability,
                joined
            };
        }));

        res.json(enrichedMembers);

    } catch (e) {
        console.error('Error fetching team members:', e.message);
        res.status(500).send('Error feching members');
    }
});

// 5b. Obtener Recursos Asignados a un Proyecto (vía Planes Tempo)
// 5b. Obtener Recursos Asignados a un Proyecto (vía Planes Tempo) - OPTIMIZED
app.get('/api/project_resources/:projectKey', async (req, res) => {
    try {
        const { projectKey } = req.params;
        const from = '2024-01-01';
        const to = '2027-12-31';

        console.log(`[OPTIMIZED] Fetching resources for project ${projectKey}...`);
        const startTotal = Date.now();

        // 0. Resolve Project numeric ID (Parallel with other initial fetches if possible, but fast enough)
        let projectId = null;
        try {
            const pRes = await axios.get(`${JIRA_DOMAIN}/rest/api/3/project/${projectKey}`, { headers: jiraHeader });
            projectId = pRes.data.id;
        } catch (e) {
            console.error(`Project ${projectKey} not found in Jira or error fetching ID`, e.message);
        }

        // Fetch Holidays from DB (Dynamic)
        let activeHolidays = await getActiveHolidays();
        const isHoliday = (dStr) => activeHolidays.has(dStr);

        // =================================================================================================
        // STEP 1: PARALLEL DATA FETCHING (Worklogs + Issues > Plans)
        // =================================================================================================

        // A. Worklogs Fetching (Parallelized by Date Range - Quarterly)
        const fetchWorklogsPromise = (async () => {
            const ranges = [];
            const years = [2024, 2025, 2026, 2027];
            years.forEach(year => {
                ranges.push({ start: `${year}-01-01`, end: `${year}-03-31` });
                ranges.push({ start: `${year}-04-01`, end: `${year}-06-30` });
                ranges.push({ start: `${year}-07-01`, end: `${year}-09-30` });
                ranges.push({ start: `${year}-10-01`, end: `${year}-12-31` });
            });

            const fetchRange = async (range) => {
                let rangeWorklogs = [];
                let nextUrl = `https://api.tempo.io/4/worklogs?from=${range.start}&to=${range.end}&projectKey=${projectKey}&limit=1000`;
                // let page = 0;
                while (nextUrl) {
                    try {
                        const response = await axios.get(nextUrl, { headers: { 'Authorization': `Bearer ${TEMPO_TOKEN}` } });
                        rangeWorklogs = rangeWorklogs.concat(response.data.results);
                        nextUrl = response.data.metadata && response.data.metadata.next ? response.data.metadata.next : null;
                    } catch (err) {
                        console.error(`Error fetching worklogs for range ${range.start}:`, err.message);
                        break;
                    }
                }
                return rangeWorklogs;
            };

            const results = await Promise.all(ranges.map(r => fetchRange(r)));
            const allWorklogs = results.flat();
            return allWorklogs;
        })();

        // B. Issues Fetching (Pagination handled in loop) -> Then Plans Fetching
        const fetchPlansAndIssuesPromise = (async () => {
            let projectIssueIds = [];
            const projectIssueSet = new Set();

            // 1. Fetch Issues
            let nextToken = null; // Issues pagination
            let hasMore = true;
            let totalIssues = 0;
            while (hasMore) {
                try {
                    const jqlPayload = { jql: `project = ${projectKey}`, fields: ['id'], maxResults: 100 };
                    if (nextToken) jqlPayload.nextPageToken = nextToken;
                    const searchRes = await axios.post(`${JIRA_DOMAIN}/rest/api/3/search/jql`, jqlPayload, { headers: jiraHeader });
                    if (searchRes.data.issues) {
                        const newIds = searchRes.data.issues.map(i => parseInt(i.id));
                        projectIssueIds = projectIssueIds.concat(newIds);
                        newIds.forEach(id => projectIssueSet.add(id));
                        totalIssues += newIds.length;
                    }
                    nextToken = searchRes.data.nextPageToken;
                    if (!nextToken) hasMore = false;
                } catch (e) {
                    console.error('Error fetching issues:', e.message);
                    hasMore = false;
                }
            }

            // 2. Fetch Plans (Batched)
            let allPlans = [];
            const searchUrl = 'https://api.tempo.io/4/plans/search';
            const planPromises = [];

            // 2a. Project Plans
            if (projectId) {
                planPromises.push(axios.post(searchUrl, {
                    from, to, planItemIds: [parseInt(projectId)], planItemTypes: ['PROJECT']
                }, { headers: { 'Authorization': `Bearer ${TEMPO_TOKEN}` } })
                    .then(r => r.data.results)
                    .catch(e => []));
            }

            // 2b. Issue Plans (Chunked)
            const CHUNK_SIZE = 400;
            for (let i = 0; i < projectIssueIds.length; i += CHUNK_SIZE) {
                const chunk = projectIssueIds.slice(i, i + CHUNK_SIZE);
                const fetchChunk = async (ids) => {
                    let chunkPlans = [];
                    let offset = 0;
                    let morePlans = true;
                    while (morePlans) {
                        try {
                            const res = await axios.post(searchUrl, {
                                from, to, planItemIds: ids, planItemTypes: ['ISSUE'], offset, limit: 500
                            }, { headers: { 'Authorization': `Bearer ${TEMPO_TOKEN}` } });
                            chunkPlans = chunkPlans.concat(res.data.results);
                            if (res.data.results.length < 500) morePlans = false;
                            else offset += 500;
                        } catch (e) { morePlans = false; }
                    }
                    return chunkPlans;
                };
                planPromises.push(fetchChunk(chunk));
            }

            const results = await Promise.all(planPromises);
            results.forEach(r => allPlans = allPlans.concat(r));
            return { plans: allPlans, issueSet: projectIssueSet };
        })();

        // Wait for both Big Data sets (Worklogs raw + Plans & Issues)
        const [allWorklogsRaw, plansData] = await Promise.all([fetchWorklogsPromise, fetchPlansAndIssuesPromise]);

        const allPlans = plansData.plans;
        const projectIssueSet = plansData.issueSet;

        // Filter Worklogs: Only keep worklogs linked to issues in THIS project
        const allWorklogs = allWorklogsRaw.filter(w => {
            if (w.issue && w.issue.id && projectIssueSet.has(parseInt(w.issue.id))) return true;
            return false;
        });

        console.log(`[OPTIMIZED] Fetched ${allWorklogsRaw.length} raw worklogs. Filtered to ${allWorklogs.length} (Project Match). Plans: ${allPlans.length}.`);

        // =================================================================================================
        // STEP 2: PROCESS DATA
        // =================================================================================================

        // A. Worklogs Processing
        let worklogMap = new Map(); // accountId -> { totalSeconds: 0, monthlyBreakdown: {} }
        allWorklogs.forEach(w => {
            const authorId = w.author.accountId;
            const worklogDate = w.startDate;
            const monthKey = worklogDate.substring(0, 7);

            if (!worklogMap.has(authorId)) {
                worklogMap.set(authorId, { totalSeconds: 0, monthlyBreakdown: {} });
            }
            const userData = worklogMap.get(authorId);
            userData.totalSeconds += w.timeSpentSeconds;
            if (!userData.monthlyBreakdown[monthKey]) userData.monthlyBreakdown[monthKey] = 0;
            userData.monthlyBreakdown[monthKey] += w.timeSpentSeconds;
        });

        // B. Plans Processing
        let plannerMap = new Map(); // accountId -> { totalSeconds: 0, plans: [], monthlyBreakdown: {} }
        // Helper for plans (same logic as before)
        const processPlanItem = (p) => {
            if (p.assignee && p.assignee.id) {
                const id = p.assignee.id;
                if (!plannerMap.has(id)) plannerMap.set(id, { totalSeconds: 0, plans: [], monthlyBreakdown: {} });
                const current = plannerMap.get(id);

                // Calculation Logic
                const start = new Date(p.startDate);
                const end = new Date(p.endDate);
                const rule = p.rule;
                const recurrenceEnd = p.recurrenceEndDate ? new Date(p.recurrenceEndDate) : null;
                const secsPerDay = p.plannedSecondsPerDay || 0;
                const includeNonWorking = p.includeNonWorkingDays;

                const addToBreakdown = (dateObj, seconds) => {
                    const dStr = dateObj.toISOString().split('T')[0];
                    const mKey = dStr.substring(0, 7);
                    if (!current.monthlyBreakdown[mKey]) current.monthlyBreakdown[mKey] = 0;
                    current.monthlyBreakdown[mKey] += seconds;
                };

                const processDay = (d) => {
                    const dStr = d.toISOString().split('T')[0];
                    if (!includeNonWorking) {
                        if (isHoliday(dStr)) return;
                        const day = d.getDay();
                        if (day === 0 || day === 6) return;
                    }
                    addToBreakdown(d, secsPerDay);
                };

                if (rule === 'WEEKLY' && recurrenceEnd) {
                    const daySpan = Math.round((end - start) / (1000 * 60 * 60 * 24));
                    let cycleStart = new Date(start);
                    while (cycleStart <= recurrenceEnd) {
                        for (let i = 0; i <= daySpan; i++) {
                            let d = new Date(cycleStart);
                            d.setDate(d.getDate() + i);
                            if (d > recurrenceEnd) continue;
                            processDay(d);
                        }
                        cycleStart.setDate(cycleStart.getDate() + 7);
                    }
                } else {
                    let currentDay = new Date(start);
                    while (currentDay <= end) {
                        processDay(currentDay);
                        currentDay.setDate(currentDay.getDate() + 1);
                    }
                }

                current.totalSeconds += (p.totalPlannedSeconds || 0);
                current.plans.push({
                    id: p.id,
                    startDate: p.startDate,
                    endDate: p.endDate,
                    secondsPerDay: p.plannedSecondsPerDay,
                    totalPlannedSeconds: p.totalPlannedSeconds,
                    rule: p.rule,
                    recurrenceEndDate: p.recurrenceEndDate,
                    includeNonWorkingDays: p.includeNonWorkingDays,
                    description: p.description
                });
            }
        };

        allPlans.forEach(processPlanItem);

        // =================================================================================================
        // STEP 3: CONSOLIDATE & RESOLVE USERS
        // =================================================================================================

        // Union of all users involved (Worklog Authors + Plan Assignees) -> REVERTED TO PLANS ONLY? No, user explicitly requested "real Jira data" (imputaciones) to show up even if plan mapping failed or doesn't exist.
        // Restoring union to see all resources in the project.
        const allUserIds = new Set([...plannerMap.keys(), ...worklogMap.keys()]);
        console.log(`[OPTIMIZED] Resolving details for ${allUserIds.size} unique users...`);

        // Resolve User Names in Parallel
        const userMap = new Map(); // id -> { name, avatar }

        const resolveUser = async (accountId) => {
            try {
                const res = await axios.get(`${JIRA_DOMAIN}/rest/api/3/user?accountId=${accountId}`, { headers: jiraHeader });
                return {
                    id: accountId,
                    displayName: res.data.displayName,
                    avatarUrl: res.data.avatarUrls['48x48']
                };
            } catch (e) {
                return { id: accountId, displayName: 'Unknown User', avatarUrl: '' };
            }
        };

        const userIdsArray = Array.from(allUserIds);
        // Batch user resolution if too many (Jira rate limit is high but be safe)
        const CHUNK = 50;
        for (let i = 0; i < userIdsArray.length; i += CHUNK) {
            const chunk = userIdsArray.slice(i, i + CHUNK);
            const userDetails = await Promise.all(chunk.map(id => resolveUser(id)));
            userDetails.forEach(u => userMap.set(u.id, u));
        }

        // =================================================================================================
        // STEP 4: BUILD RESPONSE
        // =================================================================================================

        const resources = userIdsArray.map(accountId => {
            const user = userMap.get(accountId);
            const planData = plannerMap.get(accountId) || { totalSeconds: 0, plans: [], monthlyBreakdown: {} };
            const workData = worklogMap.get(accountId) || { totalSeconds: 0, monthlyBreakdown: {} };

            return {
                accountId,
                displayName: user.displayName,
                avatarUrl: user.avatarUrl,
                role: 'Planificado',
                availability: '-',
                joined: '-',
                totalSeconds: planData.totalSeconds,
                imputedSeconds: workData.totalSeconds,
                imputedMonthlyBreakdown: workData.monthlyBreakdown,
                monthlyBreakdown: planData.monthlyBreakdown,
                plans: planData.plans
            };
        });

        // Sort by name
        resources.sort((a, b) => a.displayName.localeCompare(b.displayName));

        const endTotal = Date.now();
        console.log(`[OPTIMIZED] Finished in ${(endTotal - startTotal) / 1000}s. Returning ${resources.length} resources.`);

        res.json(resources);

    } catch (e) {
        console.error("Error fetching project resources:", e.message);
        res.status(500).send("Error");
    }
});

// 6. Obtener Worklogs de un Usuario (Histórico Completo por Proyecto)
app.get('/api/users/:accountId/worklogs', async (req, res) => {
    try {
        const { accountId } = req.params;
        const from = '2024-01-01'; // Proven working date from probe
        const to = new Date().toISOString().split('T')[0]; // Today

        console.log(`Fetching worklogs for user ${accountId}...`);

        // 1. Fetch all pages of worklogs from Tempo
        let allWorklogs = [];
        let nextUrl = `https://api.tempo.io/4/worklogs/user/${accountId}?from=${from}&to=${to}&limit=1000`;

        let lastError = null;
        while (nextUrl) {
            try {
                const response = await axios.get(nextUrl, { headers: { 'Authorization': `Bearer ${TEMPO_TOKEN}` } });
                allWorklogs = allWorklogs.concat(response.data.results);
                nextUrl = response.data.metadata && response.data.metadata.next ? response.data.metadata.next : null;
            } catch (err) {
                console.error('Error fetching user worklogs page:', err.message);
                lastError = err.message + (err.response ? ' - ' + JSON.stringify(err.response.data) : '');
                break;
            }
        }

        if (allWorklogs.length === 0) {
            return res.json({
                message: "No worklogs found",
                accountId,
                from,
                to,
                lastError,
                tokenPrefix: TEMPO_TOKEN ? TEMPO_TOKEN.substring(0, 5) : 'NONE'
            });
        }

        // 2. Extract Issue IDs to resolve Projects
        const issueIds = [...new Set(allWorklogs.map(w => w.issue.id))];
        console.log(`Resolving ${issueIds.length} unique issues...`);

        // 3. Resolve Issues (Direct Lookup because Search API returns 410)
        const issueMap = {};

        // Helper to fetch single issue
        const fetchIssue = async (id) => {
            try {
                const res = await axios.get(`${JIRA_DOMAIN}/rest/api/3/issue/${id}?fields=project,summary`, {
                    headers: jiraHeader,
                    validateStatus: status => status < 500 // Accept 404/410 to handle gracefully
                });
                if (res.status === 200) {
                    const fields = res.data.fields;
                    return {
                        id,
                        key: res.data.key,
                        summary: fields.summary,
                        project: { key: fields.project.key, name: fields.project.name }
                    };
                }
            } catch (e) {
                // console.error(`Failed to resolve issue ${id}`, e.message);
            }
            return null;
        };

        // Fetch in parallel (limit concurrency if needed, but for <100 issues it's usually fine or batch)
        // We'll process in chunks of 50 to avoid rate limits
        for (let i = 0; i < issueIds.length; i += 50) {
            const chunk = issueIds.slice(i, i + 50);
            const promises = chunk.map(id => fetchIssue(id));
            const results = await Promise.all(promises);
            results.forEach(r => {
                if (r) issueMap[r.id] = r;
            });
        }

        // 4. Group by Project (Priority: _Cliente_ Attribute > Jira Project)
        const projectGroups = {};
        const debugLogs = [];
        debugLogs.push(`Processing ${allWorklogs.length} worklogs`);

        allWorklogs.forEach(w => {
            if (!w.issue) return;

            const issueId = w.issue.id;
            let issueInfo = issueMap[issueId];

            // Fallback for Issue Info
            if (!issueInfo) {
                issueInfo = {
                    key: `ID-${issueId}`,
                    summary: 'Tarea no resuelta',
                    project: { key: 'UKN', name: 'Unknown' }
                };
            }

            // Determine distinct components
            const originalProjectKey = issueInfo.project.key;
            const originalProjectName = issueInfo.project.name;
            let clientCode = '';

            // Default grouping by Project Key
            let groupKey = originalProjectKey;

            // Check attributes for override (Group by Client Code aka Space)
            // Attribute keys found in probe: _Cliente_
            if (w.attributes && w.attributes.values) {
                const clientAttr = w.attributes.values.find(v => v.key === '_Cliente_');
                if (clientAttr) {
                    clientCode = clientAttr.value; // e.g., OPE00139ARC001.1.1
                    groupKey = clientCode; // Group by this client code
                }
            }

            if (!projectGroups[groupKey]) {
                projectGroups[groupKey] = {
                    projectKey: originalProjectKey,
                    projectName: originalProjectName,
                    clientCode: clientCode,
                    worklogs: [],
                    firstDate: w.startDate,
                    lastDate: w.startDate,
                    totalSeconds: 0
                };
            }

            const group = projectGroups[groupKey];

            // Add worklog formatted
            group.worklogs.push({
                date: w.startDate,
                description: w.description,
                timeSpentSeconds: w.timeSpentSeconds,
                issueKey: issueInfo.key,
                issueSummary: issueInfo.summary
            });

            // Update range
            if (w.startDate < group.firstDate) group.firstDate = w.startDate;
            if (w.startDate > group.lastDate) group.lastDate = w.startDate;

            group.totalSeconds += w.timeSpentSeconds;
        });

        // Convert to array and sort worklogs by date desc
        const result = Object.values(projectGroups).map(g => {
            g.worklogs.sort((a, b) => b.date.localeCompare(a.date));
            return g;
        });

        if (result.length === 0 && allWorklogs.length > 0) {
            return res.json({ error: "Logic Error: Result empty", debugLogs });
        }

        res.json(result);

    } catch (e) {
        console.error('Error in user worklogs:', e.message);
        res.status(500).send('Error fetching user worklogs');
    }
});

// 7. Obtener Planes de un Usuario (Futuro y Pasado)
// 7. Obtener Planes de un Usuario (Futuro y Pasado)
app.get('/api/users/:accountId/plans', async (req, res) => {
    try {
        const { accountId } = req.params;
        const from = req.query.from || '2000-01-01';
        const to = req.query.to || '2099-12-31';

        let isDummy = req.query.isDummy === 'true' || req.query.isDummy === true;

        console.log(`Fetching plans for user ${accountId} from ${from} to ${to}... (isDummy: ${isDummy})`);

        const searchUrl = 'https://api.tempo.io/4/plans/search';
        let allPlans = [];
        let offset = 0;
        const limit = 500;
        let morePlans = true;

        while (morePlans) {
            try {
                const payload = {
                    from: from,
                    to: to,
                    planItemTypes: ['ISSUE', 'PROJECT'], // Explicitly ask for everything
                    offset: offset,
                    limit: limit
                };
                if (isDummy) {
                    payload.genericResourceIds = [parseInt(accountId)];
                } else {
                    payload.accountIds = [accountId];
                }

                const response = await axios.post(searchUrl, payload, { headers: { 'Authorization': `Bearer ${TEMPO_TOKEN}` } });

                const results = response.data.results;
                allPlans = allPlans.concat(results);

                if (results.length < limit) {
                    morePlans = false;
                } else {
                    offset += limit;
                }
            } catch (err) {
                console.error('Error fetching user plans:', err.response ? JSON.stringify(err.response.data) : err.message);
                morePlans = false;
            }
        }

        if (allPlans.length === 0) return res.json([]);

        // Resolve Projects explicitly (planItem -> Project)
        const projectMap = {};
        const issueMap = {};

        // 1. Identify Items to Resolve
        const issuesToResolve = new Set();
        const projectsToResolve = new Set();

        allPlans.forEach(p => {
            if (p.planItem.type === 'ISSUE') issuesToResolve.add(p.planItem.id);
            else if (p.planItem.type === 'PROJECT') projectsToResolve.add(p.planItem.id);
        });

        // 2. Resolve Issues (to get Project)
        // We can do this in parallel batches
        const issueIds = Array.from(issuesToResolve);
        for (let i = 0; i < issueIds.length; i += 50) {
            const chunk = issueIds.slice(i, i + 50);
            await Promise.all(chunk.map(async (id) => {
                try {
                    const res = await axios.get(`${JIRA_DOMAIN}/rest/api/3/issue/${id}?fields=project,summary`, { headers: jiraHeader });
                    const fields = res.data.fields;
                    issueMap[id] = {
                        key: res.data.key,
                        summary: fields.summary,
                        project: { key: fields.project.key, name: fields.project.name }
                    };
                    // Cache project too
                    // projectMap[fields.project.id] = ... (if we had ID, but we usually have Key/Name)
                } catch (e) { }
            }));
        }

        // 3. Resolve Projects (Directly)
        const projectIds = Array.from(projectsToResolve);
        await Promise.all(projectIds.map(async (pid) => {
            try {
                const res = await axios.get(`${JIRA_DOMAIN}/rest/api/3/project/${pid}`, { headers: jiraHeader });
                projectMap[pid] = {
                    key: res.data.key,
                    name: res.data.name
                };
            } catch (e) {
                projectMap[pid] = { key: `ID-${pid}`, name: 'Unknown Project' };
            }
        }));

        // 4. Format Plans
        const formattedPlans = allPlans.map(p => {
            let project = { key: 'UKN', name: 'Unknown' };
            let issue = null;

            if (p.planItem.type === 'ISSUE') {
                issue = issueMap[p.planItem.id];
                if (issue) project = issue.project;
            } else if (p.planItem.type === 'PROJECT') {
                project = projectMap[p.planItem.id] || project;
            }

            // Use totalPlannedSecondsInScope if we specified a tight date range
            const isTightRange = (req.query.from && req.query.to);
            const exactSeconds = isTightRange && p.totalPlannedSecondsInScope !== undefined ? p.totalPlannedSecondsInScope : (p.totalPlannedSeconds || 0);

            return {
                id: p.id,
                date: p.startDate,
                endDate: p.endDate,
                secondsPerDay: p.plannedSecondsPerDay,
                totalSeconds: exactSeconds,
                description: p.description,
                project: project,
                issueKey: issue ? issue.key : null,
                issueSummary: issue ? issue.summary : null,
                rule: p.rule,
                recurrenceEndDate: p.recurrenceEndDate
            };
        });

        res.json(formattedPlans);

    } catch (e) {
        console.error('Error fetching user plans:', e.message);
        res.status(500).send('Error fetching user plans');
    }
});

// 8. Obtener Planes Masivos (para un periodo exacto)
app.post('/api/plans/bulk', async (req, res) => {
    try {
        const { from, to, accountIds, genericResourceIds } = req.body;
        if (!from || !to || (!accountIds && !genericResourceIds)) {
            return res.status(400).send('Missing from, to, or resource IDs');
        }

        console.log(`Fetching bulk plans from ${from} to ${to} for ${accountIds ? accountIds.length : 0} users and ${genericResourceIds ? genericResourceIds.length : 0} generics...`);

        const searchUrl = 'https://api.tempo.io/4/plans/search';
        let allPlans = [];
        let offset = 0;
        const limit = 500;
        let morePlans = true;

        while (morePlans) {
            try {
                const payload = {
                    from: from,
                    to: to,
                    planItemTypes: ['ISSUE', 'PROJECT'],
                    offset: offset,
                    limit: limit
                };
                if (accountIds && accountIds.length > 0) payload.accountIds = accountIds;
                if (genericResourceIds && genericResourceIds.length > 0) payload.genericResourceIds = genericResourceIds;

                const response = await axios.post(searchUrl, payload, { headers: { 'Authorization': `Bearer ${TEMPO_TOKEN}` } });

                const results = response.data.results;
                allPlans = allPlans.concat(results);

                if (results.length < limit) {
                    morePlans = false;
                } else {
                    offset += limit;
                }
            } catch (err) {
                console.error('Error fetching bulk plans:', err.response ? JSON.stringify(err.response.data) : err.message);
                morePlans = false; // Stop on error
            }
        }

        if (allPlans.length === 0) return res.json([]);

        // Resolve Projects
        const projectMap = {};
        const issueMap = {};
        const issuesToResolve = new Set();
        const projectsToResolve = new Set();

        allPlans.forEach(p => {
            if (p.planItem.type === 'ISSUE') issuesToResolve.add(p.planItem.id);
            else if (p.planItem.type === 'PROJECT') projectsToResolve.add(p.planItem.id);
        });

        // Resolve Issues
        const issueIds = Array.from(issuesToResolve);
        for (let i = 0; i < issueIds.length; i += 50) {
            const chunk = issueIds.slice(i, i + 50);
            await Promise.all(chunk.map(async (id) => {
                try {
                    const resApi = await axios.get(`${JIRA_DOMAIN}/rest/api/3/issue/${id}?fields=project,summary`, { headers: jiraHeader });
                    const fields = resApi.data.fields;
                    issueMap[id] = {
                        key: resApi.data.key,
                        summary: fields.summary,
                        project: { key: fields.project.key, name: fields.project.name }
                    };
                } catch (e) { }
            }));
        }

        // Resolve Projects
        const projectIds = Array.from(projectsToResolve);
        await Promise.all(projectIds.map(async (pid) => {
            try {
                const resApi = await axios.get(`${JIRA_DOMAIN}/rest/api/3/project/${pid}`, { headers: jiraHeader });
                projectMap[pid] = { key: resApi.data.key, name: resApi.data.name };
            } catch (e) {
                projectMap[pid] = { key: `ID-${pid}`, name: 'Unknown Project' };
            }
        }));

        // Format
        const formattedPlans = allPlans.map(p => {
            let project = { key: 'UKN', name: 'Unknown' };
            let issue = null;

            if (p.planItem.type === 'ISSUE') {
                issue = issueMap[p.planItem.id];
                if (issue) project = issue.project;
            } else if (p.planItem.type === 'PROJECT') {
                project = projectMap[p.planItem.id] || project;
            }

            // For bulk exact requests, the actual seconds perfectly bounded to the window is totalPlannedSecondsInScope
            const exactSeconds = p.totalPlannedSecondsInScope !== undefined ? p.totalPlannedSecondsInScope : (p.totalPlannedSeconds || 0);

            return {
                id: p.id,
                assigneeAccountId: p.assignee ? p.assignee.id : null,
                date: p.startDate,
                endDate: p.endDate,
                secondsPerDay: p.plannedSecondsPerDay,
                totalSeconds: exactSeconds,
                description: p.description,
                project: project,
                issueKey: issue ? issue.key : null,
                issueSummary: issue ? issue.summary : null,
                rule: p.rule,
                recurrenceEndDate: p.recurrenceEndDate
            };
        });

        res.json(formattedPlans);

    } catch (e) {
        console.error('Error fetching bulk plans:', e.message);
        res.status(500).send('Error fetching bulk plans');
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ================= ATTRIBUTES API =================

const ATTRIBUTES_FILE = path.join(__dirname, 'data', 'resource_attributes.json');

// Helper - Ensure file exists
try {
    if (!fs.existsSync(ATTRIBUTES_FILE)) {
        if (!fs.existsSync(path.dirname(ATTRIBUTES_FILE))) {
            fs.mkdirSync(path.dirname(ATTRIBUTES_FILE), { recursive: true });
        }
        fs.writeFileSync(ATTRIBUTES_FILE, JSON.stringify({}));
    }
} catch (e) {
    console.log("Vercel or read-only filesystem detected for ATTRIBUTES_FILE, skipping local file creation");
}

// GET /api/resources/attributes - Get all attributes
app.get('/api/resources/attributes', (req, res) => {
    try {
        if (fs.existsSync(ATTRIBUTES_FILE)) {
            const data = fs.readFileSync(ATTRIBUTES_FILE, 'utf8');
            res.json(JSON.parse(data));
        } else {
            res.json({});
        }
    } catch (e) {
        console.error("Error reading attributes:", e);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// POST /api/resources/:id/attributes - Update attributes for a specific user
app.post('/api/resources/:id/attributes', (req, res) => {
    try {
        const { id } = req.params;
        const newAttrs = req.body; // { cv: bool, skill: string, lob: string }

        let currentData = {};
        if (fs.existsSync(ATTRIBUTES_FILE)) {
            currentData = JSON.parse(fs.readFileSync(ATTRIBUTES_FILE, 'utf8'));
        }

        // Merge or Set
        currentData[id] = { ...currentData[id], ...newAttrs };

        fs.writeFileSync(ATTRIBUTES_FILE, JSON.stringify(currentData, null, 2));
        res.json({ success: true, data: currentData[id] });

    } catch (e) {
        console.error("Error saving attributes:", e);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = app;

if (require.main === module) {
    app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
}