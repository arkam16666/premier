const { google } = require("googleapis");
require("dotenv").config();

const authWrite = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, '\n'),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheetsWrite = google.sheets({ version: "v4", auth: authWrite });
const spreadsheetId = process.env.GOOGLE_SHEET_ID;

async function getsheet(table) {
    const result = await sheetsWrite.spreadsheets.values.get({
        spreadsheetId,
        range: `${table}!A1:AZ`,
    });
    const rowsRaw = result.data.values ?? [];
    if (rowsRaw.length === 0) return [];
    const [headersRaw, ...rows] = rowsRaw;
    const headers = headersRaw.map(h => (h || "").toString().trim());
    return rows.map((row) => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] ?? ""; });
        return obj;
    });
}

async function run() {
    try {
        const precherPr = await getsheet("precher_pr");
        console.log("=== PRECHER_PR Full Data (First 2 rows) ===");
        console.log(JSON.stringify(precherPr.slice(0, 2), null, 2));
    } catch (err) {
        console.error("Error:", err.message);
    }
}

run();
