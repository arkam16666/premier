const express = require('express');
const fs = require('fs');
const path = require('path');

module.exports = (dependencies) => {
    const router = express.Router();
    const { sheets, process } = dependencies;

    // ดึง URL ของ Python API จาก .env หรือใช้ default เป็น https://pdf.thanadon.click
    const PYTHON_API_BASE = process.env.PYTHON_API_BASE_URL || 'https://pdf.thanadon.click';
    const PDF_API_URL = process.env.PDF_API_URL || 'https://pdf.thanadon.click/api/generate-pdf-link';

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

    // ดึงข้อมูลรายการย่อยของ Purchase Request
    router.get("/api/sub_purchase", async (req, res) => {
        const { id } = req.query;
        if (!id) return res.status(400).json({ success: false, error: "Missing ID" });
        const { getsheet } = dependencies;
        try {
            const items = await getsheet(id, "sub_precher_pr");
            res.json({ success: true, items });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ดึงข้อมูลรายการย่อยของ Sale Request
    router.get("/api/sub_sale", async (req, res) => {
        const { id } = req.query;
        if (!id) return res.status(400).json({ success: false, error: "Missing ID" });
        const { getsheet } = dependencies;
        try {
            const items = await getsheet(id, "sub_sales_pr");
            res.json({ success: true, items });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // Proxy สำหรับสร้าง PO PDF (เพื่อแก้ปัญหา CORS)
    router.post('/api/generate-po-pdf', async (req, res) => {
        try {
            // Debug incoming payload
            try {
                const preview = JSON.stringify(req.body).slice(0, 1200);
                console.log(`[DEBUG] /api/generate-po-pdf called at ${new Date().toISOString()} - payload keys: ${Object.keys(req.body || {}).length} - preview: ${preview}`);
            } catch (e) {
                console.log('[DEBUG] /api/generate-po-pdf called - could not stringify body', e.message);
            }

            console.log("[DEBUG] Requesting PO PDF from external API...");

            // Debug-only shortcut: if client adds ?debug=1 or header x-debug:1, just echo the payload
            const isDebug = (req.query && req.query.debug === '1') || req.headers['x-debug'] === '1';
            if (isDebug) {
                try {
                    const preview = JSON.stringify(req.body).slice(0, 1200);
                    return res.json({ success: true, debug: true, keys: Object.keys(req.body || {}).length, preview });
                } catch (e) {
                    return res.json({ success: true, debug: true, keys: Object.keys(req.body || {}).length });
                }
            }

            const response = await fetch(PDF_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body)
            });

            const buffer = Buffer.from(await response.arrayBuffer());
            const firstBytes = buffer.toString('utf8', 0, 100);

            // 1. ถ้าเป็น PDF จริงๆ
            if (buffer.length >= 4 && buffer.toString('utf8', 0, 4) === '%PDF') {
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', 'inline; filename=po.pdf');
                return res.send(buffer);
            }

            // 2. ถ้าเป็น JSON (เช่น ส่งลิงก์มาให้ หรือ Error)
            if (firstBytes.trim().startsWith('{') || firstBytes.trim().startsWith('[')) {
                try {
                    const result = JSON.parse(buffer.toString());
                    return res.status(response.status).json(result);
                } catch (e) {
                    // ถ้า parse ไม่ได้ให้ข้ามไป
                }
            }

            // 3. กรณีอื่นๆ
            console.error("[ERROR] Received invalid PDF/JSON data for PO.");
            return res.status(500).json({ error: "ข้อมูลที่ได้รับจากเครื่องมือสร้าง PDF ไม่ถูกต้อง" });

        } catch (error) {
            console.error("[ERROR] generate-po-pdf proxy:", error.message);
            res.status(500).json({ error: "ไม่สามารถเชื่อมต่อกับ PDF Service ได้: " + error.message });
        }
    });

    // ดึงข้อมูลลูกค้า (ที่อยู่, รหัส, เบอร์โทร)
    router.get("/api/customer_info", async (req, res) => {
        const { name } = req.query;
        if (!name) return res.status(400).json({ success: false, error: "Missing Name" });
        const { getsheet } = dependencies;
        try {
            const customers = await getsheet(null, "customer");
            const customer = customers.find(c => (c['ชื่อลูกค้า/ผู้ขาย'] || '').toString().trim() === name.trim());
            res.json({
                success: true,
                address: customer ? customer['ที่อยู่ 1'] : "",
                code: customer ? customer['รหัสลูกค้า/ผู้ขาย'] : "",
                phone: customer ? customer['โทรศัพท์'] : ""
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 1. ส่งข้อมูลไปให้ Python Generate PDF และรับไฟล์ PDF กลับมาตรงๆ (Direct Stream)
    router.post('/api/generate-pdf', async (req, res) => {
        try {
            // Added debug logging to trace incoming print requests
            try {
                const preview = JSON.stringify(req.body, Object.keys(req.body).slice(0, 50)).slice(0, 1200);
                console.log(`[DEBUG] /api/generate-pdf called at ${new Date().toISOString()} - payload keys: ${Object.keys(req.body || {}).length} - preview: ${preview}`);
            } catch (logErr) {
                console.log('[DEBUG] /api/generate-pdf called at', new Date().toISOString(), '- (could not stringify body)', logErr.message);
            }

            console.log("[DEBUG] Sending data to Python PDF Service (Stream)...");
            const response = await fetch(PDF_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body)
            });

            const buffer = Buffer.from(await response.arrayBuffer());
            const firstBytes = buffer.toString('utf8', 0, 100);

            if (buffer.length >= 4 && buffer.toString('utf8', 0, 4) === '%PDF') {
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', response.headers.get('content-disposition') || 'inline; filename=report.pdf');
                return res.send(buffer);
            }

            if (firstBytes.trim().startsWith('{') || firstBytes.trim().startsWith('[')) {
                try {
                    const result = JSON.parse(buffer.toString());
                    return res.status(response.status).json(result);
                } catch (e) { }
            }

            return res.status(500).json({ error: "ข้อมูลที่ได้รับไม่ใช่รูปแบบ PDF ที่ถูกต้อง" });
        } catch (error) {
            console.error("[ERROR] generate-pdf proxy:", error.message);
            res.status(500).json({ error: "ไม่สามารถเชื่อมต่อกับ Python PDF Service ได้" });
        }
    });

    // 2. Route สำหรับดึง PDF จาก Python มาแสดงผล (Proxy View)
    router.get('/api/view-pdf/:filename', async (req, res) => {
        try {
            const filename = req.params.filename;
            const targetUrl = `${PYTHON_API_BASE}/api/view-pdf/${encodeURIComponent(filename)}`;

            console.log(`[DEBUG] Fetching PDF from Python: ${targetUrl}`);
            const response = await fetch(targetUrl);

            if (!response.ok) {
                console.error(`[ERROR] Python service returned ${response.status}`);
                return res.status(response.status).json({ error: "ไม่พบไฟล์ PDF หรือ Python API ทำงานผิดพลาด" });
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // ตรวจสอบ Signature ของไฟล์ PDF (%PDF)
            if (buffer.length > 4 && buffer.toString('utf8', 0, 4) !== '%PDF') {
                console.error("[ERROR] Received invalid PDF data. First 100 bytes:", buffer.toString('utf8', 0, 100));

                // ถ้าข้อมูลที่ได้รับเป็น HTML (เช่น หน้า Login) ให้แจ้งเตือน
                if (buffer.toString().includes('<!DOCTYPE html>') || buffer.toString().includes('<html')) {
                    return res.status(500).json({ error: "เซสชันหมดอายุหรือถูกเปลี่ยนเส้นทางไปยังหน้าเข้าสู่ระบบ" });
                }

                return res.status(500).json({ error: "ไฟล์ที่ได้รับจากเครื่องมือสร้าง PDF ไม่สมบูรณ์" });
            }

            // ตั้งค่า Header เพื่อให้เบราว์เซอร์แสดงผลเป็น PDF
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Length', buffer.length);
            res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

            console.log(`[DEBUG] Successfully serving PDF: ${filename} (${buffer.length} bytes)`);
            res.send(buffer);
        } catch (error) {
            console.error("[ERROR] view-pdf proxy failure:", error.message);
            res.status(500).json({ error: "เกิดข้อผิดพลาดในการดึงไฟล์: " + error.message });
        }
    });

    // 3. ส่งข้อมูลไปให้ Python สร้างลิงก์ PDF ถาวร
    router.post('/api/generate-pdf-link', async (req, res) => {
        try {
            console.log(`[DEBUG] Requesting PDF Link from external API...`);
            const response = await fetch(PDF_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body)
            });

            const result = await response.json();
            res.status(response.status).json(result);
        } catch (error) {
            console.error("[ERROR] generate-pdf-link proxy:", error.message);
            res.status(500).json({ error: "ไม่สามารถเชื่อมต่อกับ Python PDF Service เพื่อสร้างลิงก์ได้" });
        }
    });

    return router;
};
