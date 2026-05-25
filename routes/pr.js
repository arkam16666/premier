const express = require('express');

module.exports = (dependencies) => {
    const router = express.Router();
    const { getsheet, sheetsWrite, sheetCache, process } = dependencies;

    // --- Precher PR Routes ---
    router.get("/precher_pr", async (req, res) => {
        try {
            const [data, subData] = await Promise.all([
                getsheet(null, "Precher_pr"),
                getsheet(null, "sub_precher_pr")
            ]);

            // Calculate totals from sub_precher_pr
            const totalsMap = {};
            subData.forEach(row => {
                const id = String(row['id']).trim();
                const amount = parseFloat(String(row['จำนวนเงิน'] || 0).replace(/,/g, ''));
                const tax = parseFloat(String(row['ภาษี'] || 0).replace(/,/g, ''));
                const total = parseFloat(String(row['จำนวนเงินรวม'] || 0).replace(/,/g, ''));
                
                // Use existing total if available, otherwise sum amount + tax
                const finalAmount = total > 0 ? total : (amount + tax);
                
                if (!isNaN(finalAmount)) {
                    totalsMap[id] = (totalsMap[id] || 0) + finalAmount;
                }
            });

            const allowedHeaders = ["id", "วันที่", "PIC", "ลูกค้า-ผู้ขาย", "โทรศัพท์", "จำนวนเงินรวม", "สถานะเอกสาร"];
            const searchQuery = (req.query.search || "").trim().toLowerCase();
            const statusFilter = (req.query.status || "ทั้งหมด");

            let filteredData = data.map(row => {
                let obj = {};
                allowedHeaders.forEach((h) => { 
                    if (h === 'จำนวนเงินรวม') {
                        obj[h] = (totalsMap[String(row['id']).trim()] || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
                    } else {
                        const rawVal = (row[h] || "").toString().trim();
                        if (h === 'สถานะเอกสาร') {
                            obj[h] = rawVal || 'ยังไม่ยืนยัน';
                        } else {
                            obj[h] = rawVal;
                        }
                    }
                });
                return obj;
            }).filter(obj => Object.keys(obj).length > 0);

            if (searchQuery) {
                filteredData = filteredData.filter(item => 
                    Object.values(item).some(val => String(val).toLowerCase().includes(searchQuery))
                );
            }

            if (statusFilter !== "ทั้งหมด") {
                filteredData = filteredData.filter(item => {
                    if (statusFilter === "ยืนยันแล้ว") {
                        return ["ยืนยันแล้ว", "สำเร็จ"].includes(item['สถานะเอกสาร']);
                    } else if (statusFilter === "ยังไม่ยืนยัน") {
                        return !["ยืนยันแล้ว", "สำเร็จ"].includes(item['สถานะเอกสาร']);
                    }
                    return item['สถานะเอกสาร'] === statusFilter;
                });
            }

            res.render("precher_pr", {
                data: filteredData,
                search: req.query.search || "",
                currentStatus: statusFilter
            });
        } catch (err) {
            res.status(500).send(err.message);
        }
    });

    router.get("/edit_purchase", async (req, res) => {
        const idToEdit = req.query.id;
        const searchQuery = (req.query.search || "").trim().toLowerCase();
        try {
            const subPurchaseData = await getsheet(idToEdit, "sub_precher_pr");
            const purchaseData = await getsheet(idToEdit, "Precher_pr");
            const allProductsRaw = await getsheet(null, "product");

            const purchaseHeaders = ["id", "วันที่", "PIC", "ลูกค้า-ผู้ขาย", "โทรศัพท์", "สถานะเอกสาร"];
            const subPurchaseHeaders = ["id", "สินค้า", "ชื่อสินค้า", "ข้อมูลจำเพราะ", "จำนวน", "หน่วย", "ราคาต่อหน่วย", "จำนวนเงิน", "ภาษี", "จำนวนเงินรวม"];
            const productHeaders = ["รหัส", "ชื่อ", "ชื่อจำเพราะ", "หน่วย", "ราคาซื้อ", "แบรนด์", "อัตราภาษีซื้อ"];

            const mapDataByHeaders = (rawData, headers) => {
                if (!rawData || !headers) return [];
                return rawData.map(row => {
                    const obj = {};
                    headers.forEach(header => {
                        obj[header] = row[header] !== undefined ? row[header] : "";
                    });
                    return obj;
                }).filter(obj => Object.keys(obj).length > 0);
            };

            let purchasePrData = mapDataByHeaders(subPurchaseData, subPurchaseHeaders);
            let orderData = mapDataByHeaders(purchaseData, purchaseHeaders);
            
            let allProducts = allProductsRaw.map(row => {
                const obj = {};
                productHeaders.forEach(header => {
                    obj[header] = row[header] !== undefined ? row[header] : "";
                });
                return obj;
            }).filter(obj => Object.keys(obj).length > 0);

            if (searchQuery) {
                purchasePrData = purchasePrData.filter(item =>
                    Object.values(item).some(val => String(val).toLowerCase().includes(searchQuery))
                );
            }

            res.render("edit_purchase", {
                data: subPurchaseData,
                purchase_pr: purchasePrData,
                order: orderData,
                rawPurchaseData: purchaseData,
                allProducts: allProducts,
                search: req.query.search || "",
                idToEdit: idToEdit
            });
        } catch (err) {
            res.status(500).send({ error: err.message });
        }
    });

    router.post("/api/save_changes_purchase", async (req, res) => {
        const { id, finalItems, orderChanges } = req.body;
        if (!id) return res.status(400).json({ error: "ต้องระบุ id" });
        try {
            const sheetName = "sub_precher_pr";
            const result = await sheetsWrite.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${sheetName}!A1:AZ` });
            const allRows = result.data.values ?? [];
            if (allRows.length > 0) {
                const headers = allRows[0];
                const idColIndex = headers.indexOf("id");
                if (idColIndex !== -1) {
                    const spreadsheet = await sheetsWrite.spreadsheets.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID });
                    const sheetMeta = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
                    const rowsToDelete = [];
                    for (let i = 1; i < allRows.length; i++) { if ((allRows[i][idColIndex] || "").toString().trim() === id.trim()) rowsToDelete.push(i); }
                    if (rowsToDelete.length > 0) {
                        rowsToDelete.sort((a, b) => b - a);
                        const requests = rowsToDelete.map((rowIndex) => ({ deleteDimension: { range: { sheetId: sheetMeta.properties.sheetId, dimension: "ROWS", startIndex: rowIndex, endIndex: rowIndex + 1 } } }));
                        await sheetsWrite.spreadsheets.batchUpdate({ spreadsheetId: process.env.GOOGLE_SHEET_ID, requestBody: { requests } });
                    }
                }
            }

            if (finalItems && finalItems.length > 0) {
                const values = finalItems.map(p => {
                    const qty = parseFloat(p.quantity) || 0;
                    const price = parseFloat(p['ราคาซื้อ']) || 0;
                    const taxRate = parseFloat((p['อัตราภาษีซื้อ'] || "0").toString().replace('%', '')) || 0;
                    const amount = qty * price;
                    const tax = amount * (taxRate / 100);
                    return [id, p['รหัส'] || "", p['ชื่อ'] || "", p['ชื่อจำเพราะ'] || "", qty, p['หน่วย'] || "", price, amount, tax, amount + tax];
                });
                await sheetsWrite.spreadsheets.values.append({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${sheetName}!A:J`, valueInputOption: "USER_ENTERED", requestBody: { values } });
            }

            const purchaseSheetName = "Precher_pr";
            const user = req.session.user;
            const userName = user ? (user['ชื่อภาษาอังกฤษpic'] || 'Unknown') : 'Unknown';
            const dateStr = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
            
            const purchaseResult = await sheetsWrite.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${purchaseSheetName}!A1:AZ` });
            const purchaseRows = purchaseResult.data.values ?? [];
            if (purchaseRows.length > 0) {
                const purchaseHeaders = purchaseRows[0];
                const purchaseIdCol = purchaseHeaders.indexOf("id");
                if (purchaseIdCol !== -1) {
                    let purchaseRowIndex = -1;
                    for (let i = 1; i < purchaseRows.length; i++) { if ((purchaseRows[i][purchaseIdCol] || "").toString().trim() === id.trim()) { purchaseRowIndex = i; break; } }
                    if (purchaseRowIndex !== -1) {
                        const purchaseRow = [...(purchaseRows[purchaseRowIndex] || [])];
                        if (orderChanges) { for (let header in orderChanges) { const j = purchaseHeaders.indexOf(header); if (j !== -1) { while (purchaseRow.length <= j) purchaseRow.push(""); purchaseRow[j] = orderChanges[header]; } } }
                        const dateCol = purchaseHeaders.indexOf("วันที่แก้ไขล่าสุด"); if (dateCol !== -1) { while (purchaseRow.length <= dateCol) purchaseRow.push(""); purchaseRow[dateCol] = dateStr; }
                        const editorCol = purchaseHeaders.indexOf("ผู้แก้ไขล่าสุด"); if (editorCol !== -1) { while (purchaseRow.length <= editorCol) purchaseRow.push(""); purchaseRow[editorCol] = userName; }
                        await sheetsWrite.spreadsheets.values.update({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${purchaseSheetName}!A${purchaseRowIndex + 1}`, valueInputOption: "USER_ENTERED", requestBody: { values: [purchaseRow] } });
                    }
                }
            }
            res.json({ success: true, message: "บันทึกการเปลี่ยนแปลงทั้งหมดเรียบร้อยแล้ว" });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get("/delpurchase", async (req, res) => {
        const idToDelete = req.query.id;
        if (!idToDelete) return res.status(400).send("ไม่พบ ID ที่ต้องการลบ");
        try {
            const spreadsheetId = process.env.GOOGLE_SHEET_ID;
            const spreadsheet = await sheetsWrite.spreadsheets.get({ spreadsheetId });
            const purchasePrSheet = spreadsheet.data.sheets.find(s => s.properties.title === "Precher_pr");
            const subPurchasePrSheet = spreadsheet.data.sheets.find(s => s.properties.title === "sub_precher_pr");

            const purchasePrRes = await sheetsWrite.spreadsheets.values.get({ spreadsheetId, range: "Precher_pr!A:A" });
            const purchasePrRows = purchasePrRes.data.values || [];
            const purchasePrIndex = purchasePrRows.findIndex(row => row[0] === idToDelete);

            const subPurchasePrRes = await sheetsWrite.spreadsheets.values.get({ spreadsheetId, range: "sub_precher_pr!A:A" });
            const subPurchasePrRows = subPurchasePrRes.data.values || [];
            const subPurchasePrIndices = [];
            subPurchasePrRows.forEach((row, index) => { if (row[0] === idToDelete) subPurchasePrIndices.push(index); });

            const requests = [];
            if (subPurchasePrIndices.length > 0) {
                subPurchasePrIndices.sort((a, b) => b - a).forEach(index => {
                    requests.push({ deleteDimension: { range: { sheetId: subPurchasePrSheet.properties.sheetId, dimension: "ROWS", startIndex: index, endIndex: index + 1 } } });
                });
            }
            if (purchasePrIndex !== -1) {
                requests.push({ deleteDimension: { range: { sheetId: purchasePrSheet.properties.sheetId, dimension: "ROWS", startIndex: purchasePrIndex, endIndex: purchasePrIndex + 1 } } });
            }

            if (requests.length > 0) {
                await sheetsWrite.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
                sheetCache.delete("Precher_pr_all");
                sheetCache.delete("sub_precher_pr_all");
            }
            res.redirect("/precher_pr");
        } catch (error) {
            res.status(500).send("เกิดข้อผิดพลาดในการลบข้อมูล: " + error.message);
        }
    });

    router.post("/api/confirm-webhook-purchase", async (req, res) => {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: "ต้องระบุ id" });
        try {
            const sheetName = "Precher_pr";
            const user = req.session.user;
            const userName = user ? (user['ชื่อภาษาอังกฤษpic'] || 'Unknown') : 'Unknown';
            const dateStr = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

            const result = await sheetsWrite.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${sheetName}!A1:AZ` });
            const allRows = result.data.values ?? [];
            const headers = [...allRows[0]];
            const idColIndex = headers.indexOf("id");
            let rowIndex = -1;
            for (let i = 1; i < allRows.length; i++) { if ((allRows[i][idColIndex] || "").toString().trim() === id.toString().trim()) { rowIndex = i; break; } }
            if (rowIndex === -1) return res.status(404).json({ error: `ไม่พบข้อมูล ID: ${id}` });

            let dateColIndex = headers.indexOf("วันที่แก้ไขล่าสุด");
            let editorColIndex = headers.indexOf("ผู้แก้ไขล่าสุด");
            
            const currentRow = [...(allRows[rowIndex] || [])];
            if (dateColIndex !== -1) currentRow[dateColIndex] = dateStr;
            if (editorColIndex !== -1) currentRow[editorColIndex] = userName;
            await sheetsWrite.spreadsheets.values.update({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${sheetName}!A${rowIndex + 1}`, valueInputOption: "USER_ENTERED", requestBody: { values: [currentRow] } });
            
            sheetCache.delete(`${sheetName}_all`);
            
            let webhookUrl = process.env.WEBHOOK_CONFIRM_PURCHASE_URL || process.env.WEBHOOK_TEST_URL;
            if (webhookUrl) {
                const urlWithParams = new URL(webhookUrl);
                urlWithParams.searchParams.append('id', id);
                urlWithParams.searchParams.append('name', userName);
                urlWithParams.searchParams.append('picId', user ? (user['รหัสpic'] || '') : '');
                const webhookResponse = await fetch(urlWithParams.toString(), { method: 'GET' });
                if (!webhookResponse.ok) return res.status(500).json({ success: false, error: "Webhook Error" });
            }
            res.json({ success: true, sheetUpdated: true, webhookSuccess: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
