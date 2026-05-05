const { google } = require("googleapis");
require("dotenv").config();

const authReadonly = new google.auth.GoogleAuth({
    keyFile: "./striped-buckeye-485807-t7-f6b5b7ca48b8.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const sheets = google.sheets({ version: "v4", auth: authReadonly });

async function test() {
    try {
        const result = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: `empolyee!A1:Z`,
        });

        const [headers, ...rows] = result.data.values ?? [];
        console.log("HEADERS:", headers);
        if (rows.length > 0) {
            console.log("FIRST ROW:", rows[0]);
        }
    } catch (err) {
        console.error(err.message);
    }
}

test();
