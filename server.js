require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const FileStore = require('session-file-store')(session);
const { logAction, getLogs } = require('./utils/logger');
const app = express();

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Middlewares ---
const requestCounts = new Map();
const DOS_THRESHOLD = 50;
const RESET_INTERVAL = 10000;
setInterval(() => requestCounts.clear(), RESET_INTERVAL);

app.use((req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const currentCount = (requestCounts.get(ip) || 0) + 1;
    requestCounts.set(ip, currentCount);
    if (currentCount >= DOS_THRESHOLD && currentCount % 50 === 0) {
        console.error(`[!!! DOS !!!] IP: ${ip} | Reqs: ${currentCount}`);
    }
    next();
});

app.use(session({
    store: new FileStore({ path: './sessions', retries: 0 }),
    secret: process.env.SESSION_SECRET || 'erp-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

app.use((req, res, next) => {
    let baseUrl = process.env.BASE_URL || '';
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
    res.locals.baseUrl = baseUrl;
    res.locals.webhookUrl = process.env.WEBHOOK_TEST_URL || '';
    next();
});

const requireLogin = (req, res, next) => {
    if (req.session && req.session.user) {
        if (!req.session.user.role) {
            const dept = (req.session.user['แผนก'] || '').toString().trim().toLowerCase();
            if (dept === 'admin') req.session.user.role = 'admin';
            else if (dept.includes('sales')) req.session.user.role = 'sales';
            else if (dept.includes('procurement')) req.session.user.role = 'procurement';
            else req.session.user.role = 'user';
        }
        res.locals.user = req.session.user;
        next();
    } else {
        res.redirect('/login');
    }
};

// --- Google Sheets Auth ---
const authReadonly = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, '\n'),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const authWrite = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, '\n'),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: authReadonly });
const sheetsWrite = google.sheets({ version: "v4", auth: authWrite });

// --- Services / Helpers ---
const sheetCache = new Map();
const CACHE_TTL = 30 * 1000;

async function getsheet(id, table) {
    const cacheKey = `${table}_all`;
    const now = Date.now();
    try {
        let data;
        if (sheetCache.has(cacheKey)) {
            const cached = sheetCache.get(cacheKey);
            if (now - cached.timestamp < CACHE_TTL) {
                data = cached.data;
            }
        }

        if (!data) {
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: process.env.GOOGLE_SHEET_ID,
                range: `${table}!A1:AZ`,
            });
            const rowsRaw = result.data.values ?? [];
            if (rowsRaw.length === 0) return [];
            const [headersRaw, ...rows] = rowsRaw;
            const headers = headersRaw.map(h => (h || "").toString().trim());
            data = rows.map((row) => {
                const obj = {};
                headers.forEach((h, i) => { obj[h] = row[i] ?? ""; });
                return obj;
            });
            sheetCache.set(cacheKey, { data, timestamp: now });
        }

        if (id) {
            const searchId = String(id).trim();
            return data.filter((row) => {
                const rawRowId = row["id"] || row["ID"] || row["Id"] || row["รหัส"];
                const rowId = String(rawRowId).trim();
                return rowId === searchId || rowId.endsWith("-" + searchId);
            });
        }
        return data;
    } catch (err) {
        console.error(`[ERROR] getsheet (${table}):`, err.message);
        return [];
    }
}

// --- Routes Injection ---
const dependencies = { getsheet, sheetsWrite, sheets, sheetCache, fs, path, process, logAction, getLogs };

// Auth routes (No login required)
app.use('/', require('./routes/auth')(dependencies));
app.use('/', require('./routes/token_auth')(dependencies));

// All other routes (Login required)
app.use(requireLogin);
app.use('/', require('./routes/dashboard')(dependencies));
app.use('/', require('./routes/sales')(dependencies));
app.use('/', require('./routes/inventory')(dependencies));
app.use('/', require('./routes/pr')(dependencies));
app.use('/', require('./routes/po')(dependencies));
app.use('/', require('./routes/ai')(dependencies));
app.use('/', require('./routes/api')(dependencies));
app.use('/', require('./routes/audit')(dependencies));

app.listen(process.env.PORT || 5000, "0.0.0.0", () =>
    console.log(`Server running on port http://localhost:${process.env.PORT || 5000}`)
);

// touch for nodemon restart

// touch for nodemon restart
