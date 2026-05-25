const express = require('express');

module.exports = (dependencies) => {
    const router = express.Router();
    const { sheets, process } = dependencies;

    router.get("/api/sheets", async (req, res) => {
        try {
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: process.env.GOOGLE_SHEET_ID,
                range: "product!A1:AZ1000",
            });
            const [headers, ...rows] = result.data.values ?? [];
            if (!headers) return res.json({ data: [] });
            let data = rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""])));
            if (req.query.id) data = data.filter((row) => row["รหัส"] === req.query.id);
            res.json({ data });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post('/api/generate-pdf', async (req, res) => {
        try {
            const pdfApiUrl = process.env.PDF_API_URL || 'https://pdf.thanadon.click/api/generate-pdf';
            const response = await fetch(pdfApiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body)
            });
            if (!response.ok) throw new Error(`External API returned status: ${response.status}`);
            
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                const data = await response.json();
                return res.json(data);
            } else {
                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                res.setHeader('Content-Type', contentType || 'application/pdf');
                return res.send(buffer);
            }
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
};
