const { google } = require("googleapis");
require("dotenv").config();

const authReadonly = new google.auth.GoogleAuth({
    keyFile: "./striped-buckeye-485807-t7-f6b5b7ca48b8.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const sheets = google.sheets({ version: "v4", auth: authReadonly });

async function getSheetNames() {
    try {
        const result = await sheets.spreadsheets.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
        });

        const sheetNames = result.data.sheets.map(s => s.properties.title);
        console.log("Sheet Names:", sheetNames);
    } catch (err) {
        console.error(err.message);
    }
}

getSheetNames();
