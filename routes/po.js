const express = require('express');

module.exports = (dependencies) => {
    const router = express.Router();
    const { getsheet, sheetsWrite, sheetCache, process, fs, path } = dependencies;

    // Helper function for mapping data
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

    // --- Purchase Order (PO) Routes ---
    router.get("/purchase_order", async (req, res) => {
        try {
            const data = await getsheet(null, "precher_po");
            const allowedHeaders = ["id", "วันที่", "PIC", "ลูกค้า-ผู้ขาย", "โทรศัพท์"];
            const searchQuery = (req.query.search || "").trim().toLowerCase();

            let filteredData = data.map(row => {
                let obj = {};
                allowedHeaders.forEach((h) => { 
                    const rawVal = (row[h] || "").toString().trim();
                    obj[h] = rawVal;
                });
                return obj;
            }).filter(obj => Object.keys(obj).length > 0);

            if (searchQuery) {
                filteredData = filteredData.filter(item => 
                    Object.values(item).some(val => String(val).toLowerCase().includes(searchQuery))
                );
            }

            res.render("po", { 
                data: filteredData, 
                search: req.query.search || "",
                currentStatus: "ทั้งหมด"
            });
        } catch (err) {
            res.status(500).send(err.message);
        }
    });

    router.get("/edit_po", async (req, res) => {
        const idToEdit = req.query.id;
        const searchQuery = (req.query.search || "").trim().toLowerCase();
        try {
            const [subPoData, poData, allProductsRaw, employees] = await Promise.all([
                getsheet(idToEdit, "sub_precher_po"),
                getsheet(idToEdit, "precher_po"),
                getsheet(null, "product"),
                getsheet(null, "empolyee")
            ]);

            const poHeaders = ["id", "วันที่", "PIC", "ลูกค้า-ผู้ขาย", "โทรศัพท์"];
            const subPoHeaders = ["id", "สินค้า", "ชื่อสินค้า", "ข้อมูลจำเพราะ", "จำนวน", "หน่วย", "ราคาต่อหน่วย", "จำนวนเงิน", "ภาษี", "จำนวนเงินรวม"];
            const productHeaders = ["รหัส", "ชื่อ", "ชื่อจำเพราะ", "หน่วย", "ราคาซื้อ", "แบรนด์", "อัตราภาษีซื้อ"];

            let poItemData = mapDataByHeaders(subPoData, subPoHeaders);
            let orderData = mapDataByHeaders(poData, poHeaders);

            // Find full employee info for the PIC
            let picInfo = {};
            if (orderData.length > 0) {
                const picName = (orderData[0]['PIC'] || "").toString().trim();
                picInfo = employees.find(e => (e['ชื่อภาษาอังกฤษpic'] || "").toString().trim() === picName) || {};
            }
            
            let allProducts = allProductsRaw.map(row => {
                const obj = {};
                productHeaders.forEach(header => { obj[header] = row[header] !== undefined ? row[header] : ""; });
                return obj;
            }).filter(obj => Object.keys(obj).length > 0);

            if (searchQuery) {
                poItemData = poItemData.filter(item =>
                    Object.values(item).some(val => String(val).toLowerCase().includes(searchQuery))
                );
            }

            res.render("edit_po", {
                data: subPoData,
                po_items: poItemData,
                order: orderData,
                rawPoData: poData,
                allProducts: allProducts,
                picInfo: picInfo,
                search: req.query.search || "",
                idToEdit: idToEdit
            });
        } catch (err) {
            res.status(500).send({ error: err.message });
        }
    });

    router.post("/api/delete_order_po", async (req, res) => {
        const idToDelete = req.query.id;
        if (!idToDelete) return res.status(400).json({ error: "ไม่พบ ID ที่ต้องการลบ" });
        try {
            const spreadsheetId = process.env.GOOGLE_SHEET_ID;
            const spreadsheet = await sheetsWrite.spreadsheets.get({ spreadsheetId });
            const poSheet = spreadsheet.data.sheets.find(s => s.properties.title === "precher_po");
            const subPoSheet = spreadsheet.data.sheets.find(s => s.properties.title === "sub_precher_po");

            const poRes = await sheetsWrite.spreadsheets.values.get({ spreadsheetId, range: "precher_po!A:A" });
            const poRows = poRes.data.values || [];
            const poIndex = poRows.findIndex(row => (row[0] || "").toString().trim() === idToDelete.trim());

            const subPoRes = await sheetsWrite.spreadsheets.values.get({ spreadsheetId, range: "sub_precher_po!A:A" });
            const subPoRows = subPoRes.data.values || [];
            const subPoIndices = [];
            subPoRows.forEach((row, index) => { if ((row[0] || "").toString().trim() === idToDelete.trim()) subPoIndices.push(index); });

            const requests = [];
            if (subPoIndices.length > 0) {
                subPoIndices.sort((a, b) => b - a).forEach(index => {
                    requests.push({ deleteDimension: { range: { sheetId: subPoSheet.properties.sheetId, dimension: "ROWS", startIndex: index, endIndex: index + 1 } } });
                });
            }
            if (poIndex !== -1) {
                requests.push({ deleteDimension: { range: { sheetId: poSheet.properties.sheetId, dimension: "ROWS", startIndex: poIndex, endIndex: poIndex + 1 } } });
            }

            if (requests.length > 0) {
                await sheetsWrite.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
                sheetCache.delete("precher_po_all");
                sheetCache.delete("sub_precher_po_all");
            }
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post("/api/save_changes_po", async (req, res) => {
        let { id, finalItems, orderChanges } = req.body;
        if (!id) return res.status(400).json({ error: "ต้องระบุ id" });
        id = String(id).toUpperCase();
        try {
            const sheetName = "sub_precher_po";
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

            let grandTotal = 0;
            if (finalItems && finalItems.length > 0) {
                const values = finalItems.map(p => {
                    const qty = Math.max(0, parseFloat(p.quantity) || 0);
                    const price = Math.max(0, parseFloat(p['ราคาซื้อ']) || 0);
                    const taxRate = Math.max(0, parseFloat((p['อัตราภาษีซื้อ'] || "0").toString().replace('%', '')) || 0);
                    const amount = qty * price;
                    const tax = amount * (taxRate / 100);
                    const total = amount; 
                    grandTotal += (amount + tax); // Change: grandTotal now includes tax
                    return [id, p['รหัส'] || "", p['ชื่อ'] || "", p['ชื่อจำเพราะ'] || "", qty, p['หน่วย'] || "", price, amount, tax, total];
                });
                await sheetsWrite.spreadsheets.values.append({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${sheetName}!A:J`, valueInputOption: "USER_ENTERED", requestBody: { values } });
            }

            const poSheetName = "precher_po";
            const user = req.session.user;
            const userName = user ? (user['ชื่อภาษาอังกฤษpic'] || 'Unknown') : 'Unknown';
            const dateStr = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

            const poResult = await sheetsWrite.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${poSheetName}!A1:AZ` });
            const poRows = poResult.data.values ?? [];
            if (poRows.length > 0) {
                const poHeaders = poRows[0];
                const poIdCol = poHeaders.indexOf("id");
                if (poIdCol !== -1) {
                    let poRowIndex = -1;
                    for (let i = 1; i < poRows.length; i++) { if ((poRows[i][poIdCol] || "").toString().trim() === id.trim()) { poRowIndex = i; break; } }
                    if (poRowIndex !== -1) {
                        const poRow = [...(poRows[poRowIndex] || [])];
                        if (orderChanges) { for (let header in orderChanges) { const j = poHeaders.indexOf(header); if (j !== -1) { while (poRow.length <= j) poRow.push(""); poRow[j] = orderChanges[header]; } } }
                        const dateCol = poHeaders.indexOf("วันที่แก้ไขล่าสุด"); if (dateCol !== -1) { while (poRow.length <= dateCol) poRow.push(""); poRow[dateCol] = dateStr; }
                        const editorCol = poHeaders.indexOf("ผู้แก้ไขล่าสุด"); if (editorCol !== -1) { while (poRow.length <= editorCol) poRow.push(""); poRow[editorCol] = userName; }
                        
                        const totalCol = poHeaders.indexOf("จำนวนเงินรวม");
                        if (totalCol !== -1) {
                            while (poRow.length <= totalCol) poRow.push("");
                            poRow[totalCol] = grandTotal;
                        }

                        await sheetsWrite.spreadsheets.values.update({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${poSheetName}!A${poRowIndex + 1}`, valueInputOption: "USER_ENTERED", requestBody: { values: [poRow] } });
                    }
                }
            }
            // Clear cache to ensure the web page updates immediately
            sheetCache.delete("precher_po_all");
            sheetCache.delete("sub_precher_po_all");

            res.json({ success: true, message: "บันทึกการเปลี่ยนแปลงทั้งหมดเรียบร้อยแล้ว" });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
