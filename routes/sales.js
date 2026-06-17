const express = require('express');

module.exports = (dependencies) => {
    const router = express.Router();
    const { getsheet, sheetsWrite, sheetCache, process, fs, path, logAction } = dependencies;

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

    // --- Sale PR Routes ---
    router.get("/sale_pr", async (req, res) => {
        try {
            const data = await getsheet(null, "Sale_pr");
            const allowedHeaders = ["id", "วันที่", "PIC", "ลูกค้า-ผู้ขาย", "สถานะเอกสาร"];
            const searchQuery = (req.query.search || "").trim().toLowerCase();
            const statusFilter = (req.query.status || "ทั้งหมด");


            let filteredData = data.map(row => {
                let obj = {};
                allowedHeaders.forEach((h) => { 
                    const rawVal = (row[h] || "").toString().trim();
                    if (h === 'สถานะเอกสาร') {
                        obj[h] = rawVal || 'ยังไม่ยืนยัน';
                    } else {
                        obj[h] = rawVal;
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

            res.render("sale_pr", {
                data: filteredData,
                search: req.query.search || "",
                currentStatus: statusFilter
            });
        } catch (err) {
            res.status(500).send(err.message);
        }
    });

    router.get("/add_sale", (req, res) => {
        try {
            const today = new Date().toISOString().split('T')[0];
            res.render('add_sale', { 
                today, 
                user: req.session.user || res.locals.user 
            });
        } catch (err) {
            console.error("[ERROR] GET /add_sale:", err);
            res.status(500).send("Internal Server Error: " + err.message);
        }
    });

    router.post('/add_sale', async (req, res) => {
        try {
            const user = req.session.user;
            const { orderType, วันที่ } = req.body;
            const PIC = user ? (user['ชื่อภาษาอังกฤษpic'] || req.body.PIC) : req.body.PIC;
            const customerDetails = req.body['ลูกค้า-ผู้ขาย'];

            console.log('[DEBUG] add_sale request body:', JSON.stringify(req.body));
            
            let salesUrl = process.env.WEBHOOK_SALES_URL;
            let prUrl = process.env.PR_URL;
            let testUrl = process.env.WEBHOOK_TEST_URL;

            // Fallback: Read .env manually if URLs are missing (in case server wasn't restarted)
            if (!salesUrl || !prUrl) {
                try {
                    const envContent = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
                    const lines = envContent.split('\n');
                    lines.forEach(line => {
                        const [key, ...valueParts] = line.split('=');
                        if (key && valueParts.length > 0) {
                            const value = valueParts.join('=').trim();
                            if (key.trim() === 'WEBHOOK_SALES_URL' && !salesUrl) salesUrl = value;
                            if (key.trim() === 'PR_URL' && !prUrl) prUrl = value;
                            if (key.trim() === 'WEBHOOK_TEST_URL' && !testUrl) testUrl = value;
                        }
                    });
                } catch (e) {
                    console.error('[ERROR] Failed to read .env fallback:', e.message);
                }
            }

            let webhookUrl = "";
            if (orderType === 'sale') {
                webhookUrl = salesUrl || testUrl;
                console.log(`[DEBUG] Selected Sales Webhook: ${webhookUrl}`);
            } else if (orderType === 'purchase') {
                webhookUrl = prUrl || testUrl;
                console.log(`[DEBUG] Selected Purchase Webhook: ${webhookUrl}`);
            }

            if (!webhookUrl) {
                return res.status(500).json({ 
                    success: false, 
                    error: "ไม่พบ Webhook URL สำหรับประเภทรายการนี้ในระบบ", 
                    debug: { orderType, hasSalesUrl: !!salesUrl, hasPrUrl: !!prUrl } 
                });
            }

            const employeesRaw = await getsheet(null, "empolyee");
            const senderName = user ? (user['ชื่อภาษาอังกฤษpic'] || '') : '';
            const senderData = employeesRaw.find(e => (e['ชื่อภาษาอังกฤษpic'] || '').toString().trim() === senderName.trim()) || {};
            const { password, linetoken, token, ...senderInfo } = senderData;

            const payload = {
                action: 'create_order',
                orderType: orderType,
                date: วันที่,
                picName: PIC,
                picNameThai: (senderInfo['ชื่อpic'] || '').toString().trim(),
                picDepartment: (senderInfo['แผนก'] || '').toString().trim(),
                picId: (user ? (user['รหัสpic'] || '') : '').toString().trim(),
                customerDetails: customerDetails,
                timestamp: new Date().toISOString(),
                replyToken: 'false',
                senderInfo: JSON.stringify(senderInfo)
            };
            
            const urlWithParams = new URL(webhookUrl);
            Object.keys(payload).forEach(key => urlWithParams.searchParams.append(key, payload[key]));

            const response = await fetch(urlWithParams.toString(), { method: 'GET' });
            
            let webhookResponseData = null;
            try {
                const contentType = response.headers.get("content-type");
                if (contentType && contentType.includes("application/json")) {
                    webhookResponseData = await response.json();
                } else {
                    webhookResponseData = { message: await response.text() };
                }
            } catch (e) {
                console.warn("[WARN] Could not parse webhook response:", e.message);
            }

            if (response.ok) {
                if (logAction) logAction(user, 'Create Order', 'Created ' + orderType + ' order for ' + customerDetails, req.headers['x-forwarded-for'] || req.socket.remoteAddress);
                return res.json({ 
                    success: true, 
                    webhookResponse: webhookResponseData 
                });
            } else {
                const errorMsg = webhookResponseData?.message || webhookResponseData?.error || webhookResponseData?.msg || `Webhook Error: ${response.status}`;
                return res.status(500).json({ 
                    success: false, 
                    error: errorMsg, 
                    webhookResponse: webhookResponseData 
                });
            }
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    router.get("/edit_sale", async (req, res) => {
        const idToEdit = req.query.id;
        const searchQuery = (req.query.search || "").trim().toLowerCase();
        try {
            // Force cache clear for debug
            sheetCache.delete("new_Product_all");

            const [subSalesData, salesData, allProductsRaw, employees, newProductRawAll] = await Promise.all([
                getsheet(idToEdit, "sub_sales_pr"),
                getsheet(idToEdit, "Sale_pr"),
                getsheet(null, "product"),
                getsheet(null, "empolyee"),
                getsheet(null, "new_Product") // Fetch all rows to bypass header issues
            ]);

            // Filter using the correct foreign key column 'sale_pr_id'
            const newProductRaw = newProductRawAll.filter(row => {
                return String(row['sale_pr_id'] || '').trim() === String(idToEdit).trim();
            });

            const saleHeaders = ["id", "วันที่", "PIC", "ลูกค้า-ผู้ขาย", "โทรศัพท์", "สถานะเอกสาร"];
            const subSaleHeaders = ["id", "สินค้า", "ชื่อสินค้า", "ข้อมูลจำเพราะ", "จำนวน", "หน่วย", "ราคาต่อหน่วย", "จำนวนเงิน", "ภาษี"];
            const productHeaders = ["รหัส", "ชื่อ", "ชื่อจำเพราะ", "หน่วย", "ราคาขาย", "แบรนด์", "อัตราภาษีขาย"];
            
            // Map the specific new_Product columns to match the UI table expectations
            const newProductData = newProductRaw.map(row => {
                const qty = parseFloat(row['จำกัดจำนวน'] || row['จำนวน'] || 1) || 1;
                // Use ราคาต่อหน่วย or ราคา as the base unit price
                let unitPrice = parseFloat(row['ราคาต่อหน่วย'] || row['ราคา'] || 0); 
                
                let amount = Math.max(0, unitPrice) * qty;
                let tax = amount * 0.07; // Assuming 7% VAT
                let total = amount + tax;
                
                return {
                    'สินค้า': row['รหัส'] || row['id'] || '',               // Use id as SKU
                    'ชื่อสินค้า': row['ชื่อ'] || '',           // Map ชื่อ to ชื่อสินค้า
                    'ข้อมูลจำเพราะ': row['ชื่อจำเพราะ'] || row['ประเภทสินค้า'] || '', // Map ประเภทสินค้า to ข้อมูลจำเพราะ
                    'จำนวน': qty,                          // Map จำกัดจำนวน to จำนวน
                    'หน่วย': row['หน่วย'] || row['กลุ่มสินค้า'] || '',         // Useกลุ่มสินค้า as unit
                    'ราคาต่อหน่วย': unitPrice,                // Pre-tax unit price
                    'จำนวนเงิน': amount,                   // Pre-tax total amount
                    'ภาษี': tax,                             // VAT 7%
                    'ยอดรวม': total                         // Grand Total (pre-tax + tax)
                };
            });

            let salePrData = mapDataByHeaders(subSalesData, subSaleHeaders);
            let orderData = mapDataByHeaders(salesData, saleHeaders);
            let allProducts = mapDataByHeaders(allProductsRaw, productHeaders);
            
            console.log(`[DEBUG] Mapped newProductData:`, newProductData);

            // Find full employee info for the PIC (use trim to handle whitespace/tabs)
            let picInfo = {};
            if (orderData.length > 0) {
                const picName = (orderData[0]['PIC'] || "").toString().trim();
                picInfo = employees.find(e => (e['ชื่อภาษาอังกฤษpic'] || "").toString().trim() === picName) || {};
            }

            if (searchQuery) {
                salePrData = salePrData.filter(item =>
                    Object.values(item).some(val => String(val).toLowerCase().includes(searchQuery))
                );
            }

            res.render("edit_sale", {
                data: subSalesData,
                sale_pr: salePrData,
                order: orderData,
                rawSalesData: salesData,
                allProducts: allProducts,
                newProductData: newProductData,
                picInfo: picInfo, // Pass full employee info
                search: req.query.search || "",
                idToEdit: idToEdit
            });
        } catch (err) {
            res.status(500).send({ error: err.message });
        }
    });

    router.get("/delsale", async (req, res) => {
        const idToDelete = req.query.id;
        if (!idToDelete) return res.status(400).send("ไม่พบ ID ที่ต้องการลบ");
        try {
            const spreadsheetId = process.env.GOOGLE_SHEET_ID;
            const spreadsheet = await sheetsWrite.spreadsheets.get({ spreadsheetId });
            const salesPrSheet = spreadsheet.data.sheets.find(s => s.properties.title === "Sale_pr");
            const subSalesPrSheet = spreadsheet.data.sheets.find(s => s.properties.title === "sub_sales_pr");

            const salesPrRes = await sheetsWrite.spreadsheets.values.get({ spreadsheetId, range: "Sale_pr!A:A" });
            const salesPrRows = salesPrRes.data.values || [];
            const salesPrIndex = salesPrRows.findIndex(row => row[0] === idToDelete);

            const subSalesPrRes = await sheetsWrite.spreadsheets.values.get({ spreadsheetId, range: "sub_sales_pr!A:A" });
            const subSalesPrRows = subSalesPrRes.data.values || [];
            const subSalesPrIndices = [];
            subSalesPrRows.forEach((row, index) => { if (row[0] === idToDelete) subSalesPrIndices.push(index); });

            const requests = [];
            if (subSalesPrIndices.length > 0) {
                subSalesPrIndices.sort((a, b) => b - a).forEach(index => {
                    requests.push({ deleteDimension: { range: { sheetId: subSalesPrSheet.properties.sheetId, dimension: "ROWS", startIndex: index, endIndex: index + 1 } } });
                });
            }
            if (salesPrIndex !== -1) {
                requests.push({ deleteDimension: { range: { sheetId: salesPrSheet.properties.sheetId, dimension: "ROWS", startIndex: salesPrIndex, endIndex: salesPrIndex + 1 } } });
            }

            if (requests.length > 0) {
                await sheetsWrite.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
                sheetCache.delete("Sale_pr_all");
                sheetCache.delete("sub_sales_pr_all");
            }
            res.redirect("/sale_pr");
        } catch (error) {
            res.status(500).send("เกิดข้อผิดพลาดในการลบข้อมูล: " + error.message);
        }
    });

    // --- Sale SO Routes ---
    router.get("/sale_so", async (req, res) => {
        try {
            const data = await getsheet(null, "sales_so");
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

            res.render("sale_so", { 
                data: filteredData, 
                search: req.query.search || "",
                currentStatus: "ทั้งหมด"
            });
        } catch (err) {
            res.status(500).send(err.message);
        }
    });

    router.get("/edit_sale_so", async (req, res) => {
        const idToEdit = req.query.id;
        const searchQuery = (req.query.search || "").trim().toLowerCase();
        try {
            const [subSalesData, salesData, allProductsRaw, stockData, employees] = await Promise.all([
                getsheet(idToEdit, "sub_sales_so"),
                getsheet(idToEdit, "sales_so"),
                getsheet(null, "product"),
                getsheet(null, "stock"),
                getsheet(null, "empolyee")
            ]);

            const saleHeaders = ["id", "วันที่", "PIC", "ลูกค้า-ผู้ขาย", "โทรศัพท์"];
            const subSaleHeaders = ["id", "สินค้า", "ชื่อสินค้า", "ข้อมูลจำเพราะ", "จำนวน", "หน่วย", "ราคาต่อหน่วย", "จำนวนเงิน", "ภาษี"];
            const productHeaders = ["รหัส", "ชื่อ", "ชื่อจำเพราะ", "หน่วย", "ราคาขาย", "แบรนด์", "อัตราภาษีขาย"];

            const stockMap = {};
            stockData.forEach(s => { if (s['รหัส']) stockMap[s['รหัส']] = s['จำนวน']; });

            let saleSoData = mapDataByHeaders(subSalesData, subSaleHeaders);
            let orderData = mapDataByHeaders(salesData, saleHeaders);

            // Find full employee info for the PIC (use trim to handle whitespace/tabs)
            let picInfo = {};
            if (orderData.length > 0) {
                const picName = (orderData[0]['PIC'] || "").toString().trim();
                picInfo = employees.find(e => (e['ชื่อภาษาอังกฤษpic'] || "").toString().trim() === picName) || {};
            }
            
            let allProducts = allProductsRaw.map(row => {
                const obj = {};
                productHeaders.forEach(header => { obj[header] = row[header] !== undefined ? row[header] : ""; });
                obj['จำนวน'] = stockMap[row['รหัส']] || "0";
                return obj;
            }).filter(obj => Object.keys(obj).length > 0);

            if (searchQuery) {
                saleSoData = saleSoData.filter(item =>
                    Object.values(item).some(val => String(val).toLowerCase().includes(searchQuery))
                );
            }

            res.render("edit_sale_so", {
                data: subSalesData,
                sale_so: saleSoData,
                order: orderData,
                rawSalesData: salesData,
                allProducts: allProducts,
                picInfo: picInfo, // Pass full employee info
                search: req.query.search || "",
                idToEdit: idToEdit
            });
        } catch (err) {
            res.status(500).send({ error: err.message });
        }
    });

    router.post("/api/delete_order_so", async (req, res) => {
        const idToDelete = req.query.id;
        if (!idToDelete) return res.status(400).json({ error: "ไม่พบ ID ที่ต้องการลบ" });
        try {
            const spreadsheetId = process.env.GOOGLE_SHEET_ID;
            const spreadsheet = await sheetsWrite.spreadsheets.get({ spreadsheetId });
            const salesSoSheet = spreadsheet.data.sheets.find(s => s.properties.title === "sales_so");
            const subSalesSoSheet = spreadsheet.data.sheets.find(s => s.properties.title === "sub_sales_so");

            const salesSoRes = await sheetsWrite.spreadsheets.values.get({ spreadsheetId, range: "sales_so!A:A" });
            const salesSoRows = salesSoRes.data.values || [];
            const salesSoIndex = salesSoRows.findIndex(row => (row[0] || "").toString().trim() === idToDelete.trim());

            const subSalesSoRes = await sheetsWrite.spreadsheets.values.get({ spreadsheetId, range: "sub_sales_so!A:A" });
            const subSalesSoRows = subSalesSoRes.data.values || [];
            const subSalesSoIndices = [];
            subSalesSoRows.forEach((row, index) => { if ((row[0] || "").toString().trim() === idToDelete.trim()) subSalesSoIndices.push(index); });

            const requests = [];
            if (subSalesSoIndices.length > 0) {
                subSalesSoIndices.sort((a, b) => b - a).forEach(index => {
                    requests.push({ deleteDimension: { range: { sheetId: subSalesSoSheet.properties.sheetId, dimension: "ROWS", startIndex: index, endIndex: index + 1 } } });
                });
            }
            if (salesSoIndex !== -1) {
                requests.push({ deleteDimension: { range: { sheetId: salesSoSheet.properties.sheetId, dimension: "ROWS", startIndex: salesSoIndex, endIndex: salesSoIndex + 1 } } });
            }

            if (requests.length > 0) {
                await sheetsWrite.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
                sheetCache.delete("sales_so_all");
                sheetCache.delete("sub_sales_so_all");
            }
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // --- Common APIs for Sale/SO ---
    router.post("/api/save_changes", async (req, res) => {
        let { id, finalItems, orderChanges } = req.body;
        if (!id) return res.status(400).json({ error: "ต้องระบุ id" });
        id = String(id).toUpperCase();
        try {
            const sheetName = "sub_sales_pr";
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
                    const qty = Math.max(0, parseFloat(p.quantity) || 0);
                    const price = Math.max(0, parseFloat(p['ราคาขาย']) || 0);
                    const taxRate = Math.max(0, parseFloat((p['อัตราภาษีขาย'] || "0").toString().replace('%', '')) || 0);
                    const amount = qty * price;
                    const tax = amount * (taxRate / 100);
                    return [id, p['รหัส'] || "", p['ชื่อ'] || "", p['ชื่อจำเพราะ'] || "", qty, p['หน่วย'] || "", price, amount, tax, amount];
                });
                await sheetsWrite.spreadsheets.values.append({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${sheetName}!A:J`, valueInputOption: "USER_ENTERED", requestBody: { values } });
            }

            // Update Sale_pr
            const saleSheetName = "Sale_pr";
            const user = req.session.user;
            const userName = user ? (user['ชื่อภาษาอังกฤษpic'] || 'Unknown') : 'Unknown';
            const dateStr = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
            
            const saleResult = await sheetsWrite.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${saleSheetName}!A1:AZ` });
            const saleRows = saleResult.data.values ?? [];
            if (saleRows.length > 0) {
                const saleHeaders = saleRows[0];
                const saleIdCol = saleHeaders.indexOf("id");
                if (saleIdCol !== -1) {
                    let saleRowIndex = -1;
                    for (let i = 1; i < saleRows.length; i++) { if ((saleRows[i][saleIdCol] || "").toString().trim() === id.trim()) { saleRowIndex = i; break; } }
                    if (saleRowIndex !== -1) {
                        const saleRow = [...(saleRows[saleRowIndex] || [])];
                        if (orderChanges) { for (let header in orderChanges) { const j = saleHeaders.indexOf(header); if (j !== -1) { while (saleRow.length <= j) saleRow.push(""); saleRow[j] = orderChanges[header]; } } }
                        const dateCol = saleHeaders.indexOf("วันที่แก้ไขล่าสุด"); if (dateCol !== -1) { while (saleRow.length <= dateCol) saleRow.push(""); saleRow[dateCol] = dateStr; }
                        const editorCol = saleHeaders.indexOf("ผู้แก้ไขล่าสุด"); if (editorCol !== -1) { while (saleRow.length <= editorCol) saleRow.push(""); saleRow[editorCol] = userName; }
                        await sheetsWrite.spreadsheets.values.update({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${saleSheetName}!A${saleRowIndex + 1}`, valueInputOption: "USER_ENTERED", requestBody: { values: [saleRow] } });
                    }
                }
            }
            if (logAction) logAction(req.session ? req.session.user : null, 'Update Order', 'Updated order ID: ' + id, req.headers['x-forwarded-for'] || req.socket.remoteAddress);
            res.json({ success: true, message: "บันทึกการเปลี่ยนแปลงทั้งหมดเรียบร้อยแล้ว" });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post("/api/save_changes_so", async (req, res) => {
        let { id, finalItems, orderChanges } = req.body;
        if (!id) return res.status(400).json({ error: "ต้องระบุ id" });
        id = String(id).toUpperCase();
        try {
            const sheetName = "sub_sales_so";
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
                    const price = Math.max(0, parseFloat(p['ราคาขาย']) || 0);
                    const taxRate = Math.max(0, parseFloat((p['อัตราภาษีขาย'] || "0").toString().replace('%', '')) || 0);
                    const amount = qty * price;
                    const tax = amount * (taxRate / 100);
                    const total = amount; 
                    grandTotal += (amount + tax); // Change: grandTotal now includes tax
                    return [id, p['รหัส'] || "", p['ชื่อ'] || "", p['ชื่อจำเพราะ'] || "", qty, p['หน่วย'] || "", price, amount, tax, total];
                });
                await sheetsWrite.spreadsheets.values.append({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${sheetName}!A:J`, valueInputOption: "USER_ENTERED", requestBody: { values } });
            }

            // Update sales_so
            const saleSheetName = "sales_so";
            const user = req.session.user;
            const userName = user ? (user['ชื่อภาษาอังกฤษpic'] || 'Unknown') : 'Unknown';
            const dateStr = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

            const saleResult = await sheetsWrite.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${saleSheetName}!A1:AZ` });
            const saleRows = saleResult.data.values ?? [];
            if (saleRows.length > 0) {
                const saleHeaders = saleRows[0];
                const saleIdCol = saleHeaders.indexOf("id");
                if (saleIdCol !== -1) {
                    let saleRowIndex = -1;
                    for (let i = 1; i < saleRows.length; i++) { if ((saleRows[i][saleIdCol] || "").toString().trim() === id.trim()) { saleRowIndex = i; break; } }
                    if (saleRowIndex !== -1) {
                        const saleRow = [...(saleRows[saleRowIndex] || [])];
                        if (orderChanges) { for (let header in orderChanges) { const j = saleHeaders.indexOf(header); if (j !== -1) { while (saleRow.length <= j) saleRow.push(""); saleRow[j] = orderChanges[header]; } } }
                        const dateCol = saleHeaders.indexOf("วันที่แก้ไขล่าสุด"); if (dateCol !== -1) { while (saleRow.length <= dateCol) saleRow.push(""); saleRow[dateCol] = dateStr; }
                        const editorCol = saleHeaders.indexOf("ผู้แก้ไขล่าสุด"); if (editorCol !== -1) { while (saleRow.length <= editorCol) saleRow.push(""); saleRow[editorCol] = userName; }
                        
                        // Update grand total
                        const totalCol = saleHeaders.indexOf("จำนวนเงินรวม");
                        if (totalCol !== -1) {
                            while (saleRow.length <= totalCol) saleRow.push("");
                            saleRow[totalCol] = grandTotal;
                        }

                        await sheetsWrite.spreadsheets.values.update({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${saleSheetName}!A${saleRowIndex + 1}`, valueInputOption: "USER_ENTERED", requestBody: { values: [saleRow] } });
                    }
                }
            }
            if (logAction) logAction(req.session ? req.session.user : null, 'Update Order', 'Updated order ID: ' + id, req.headers['x-forwarded-for'] || req.socket.remoteAddress);
            res.json({ success: true, message: "บันทึกการเปลี่ยนแปลงทั้งหมดเรียบร้อยแล้ว" });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post("/api/confirm-webhook", async (req, res) => {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: "ต้องระบุ id" });
        try {
            const sheetName = "Sale_pr";
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
            let statusColIndex = headers.indexOf("สถานะเอกสาร");
            
            const currentRow = [...(allRows[rowIndex] || [])];
            if (dateColIndex !== -1) currentRow[dateColIndex] = dateStr;
            if (editorColIndex !== -1) currentRow[editorColIndex] = userName;
            await sheetsWrite.spreadsheets.values.update({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${sheetName}!A${rowIndex + 1}`, valueInputOption: "USER_ENTERED", requestBody: { values: [currentRow] } });
            
            sheetCache.delete(`${sheetName}_all`);
            
            let webhookUrl = process.env.WEBHOOK_CONFIRM_SALE_URL || process.env.WEBHOOK_SALES_URL || process.env.WEBHOOK_TEST_URL;
            let webhookResponseData = null;
            if (webhookUrl) {
                const employeesRaw = await getsheet(null, "empolyee");
                
                // Find current sender's info
                const senderData = employeesRaw.find(e => (e['ชื่อภาษาอังกฤษpic'] || '').toString().trim() === userName.trim()) || {};
                
                // Exclude sensitive fields
                const { password, linetoken, token, ...senderInfo } = senderData;

                const urlWithParams = new URL(webhookUrl);
                urlWithParams.searchParams.append('id', id);
                urlWithParams.searchParams.append('name', userName);
                urlWithParams.searchParams.append('picId', user ? (user['รหัสpic'] || '') : '');
                urlWithParams.searchParams.append('replyToken', 'false');
                urlWithParams.searchParams.append('senderInfo', JSON.stringify(senderInfo));
                const webhookResponse = await fetch(urlWithParams.toString(), { method: 'GET' });
                
                try {
                    const contentType = webhookResponse.headers.get("content-type");
                    if (contentType && contentType.includes("application/json")) {
                        webhookResponseData = await webhookResponse.json();
                    } else {
                        webhookResponseData = { message: await webhookResponse.text() };
                    }
                } catch (e) {
                    console.warn("[WARN] Could not parse webhook response:", e.message);
                }

                if (!webhookResponse.ok) {
                    return res.status(500).json({ 
                        success: false, 
                        error: "Webhook Error", 
                        webhookResponse: webhookResponseData 
                    });
                }
            }
            res.json({ 
                success: true, 
                sheetUpdated: true, 
                webhookSuccess: true, 
                webhookResponse: webhookResponseData 
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // --- Added missing APIs ---
    router.post("/api/delete_rows", async (req, res) => {
        const { id, productCodes } = req.body;
        if (!id || !productCodes || !Array.isArray(productCodes) || productCodes.length === 0) {
            return res.status(400).json({ error: "ต้องระบุ id และ productCodes" });
        }
        try {
            const sheetName = "sub_sales_pr";
            const result = await sheetsWrite.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${sheetName}!A1:AZ` });
            const allRows = result.data.values ?? [];
            const headers = allRows[0];
            const idColIndex = headers.indexOf("id");
            const productColIndex = headers.indexOf("สินค้า");

            const spreadsheet = await sheetsWrite.spreadsheets.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID });
            const sheetMeta = spreadsheet.data.sheets.find((s) => s.properties.title === sheetName);
            const sheetId = sheetMeta.properties.sheetId;

            const rowsToDelete = [];
            for (let i = 1; i < allRows.length; i++) {
                const row = allRows[i];
                if ((row[idColIndex] || "").toString().trim() === id.trim() && productCodes.includes((row[productColIndex] || "").toString().trim())) {
                    rowsToDelete.push(i);
                }
            }
            if (rowsToDelete.length > 0) {
                rowsToDelete.sort((a, b) => b - a);
                const requests = rowsToDelete.map((rowIndex) => ({ deleteDimension: { range: { sheetId: sheetId, dimension: "ROWS", startIndex: rowIndex, endIndex: rowIndex + 1 } } }));
                await sheetsWrite.spreadsheets.batchUpdate({ spreadsheetId: process.env.GOOGLE_SHEET_ID, requestBody: { requests } });
            }
            res.json({ deleted: rowsToDelete.length });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post("/api/add_rows", async (req, res) => {
        const { id, products } = req.body;
        if (!id || !products || !Array.isArray(products) || products.length === 0) {
            return res.status(400).json({ error: "ต้องระบุ id และรายการสินค้า" });
        }
        try {
            const sheetName = "sub_sales_pr";
            const values = products.map(p => {
                const qty = Math.max(0, parseFloat(p.quantity) || 0);
                const price = Math.max(0, parseFloat(p['ราคาขาย']) || 0);
                const taxRate = Math.max(0, parseFloat((p['อัตราภาษีขาย'] || "0").toString().replace('%', '')) || 0);
                const amount = qty * price;
                const tax = amount * (taxRate / 100);
                return [id, p.รหัส || "", p.ชื่อ || "", p.ชื่อจำเพราะ || "", qty, p.หน่วย || "", price, amount, tax, amount + tax];
            });
            await sheetsWrite.spreadsheets.values.append({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${sheetName}!A:J`, valueInputOption: "USER_ENTERED", requestBody: { values } });
            res.json({ success: true, added: products.length });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post("/api/update_order", async (req, res) => {
        const { id, updatedData } = req.body;
        if (!id || !updatedData) return res.status(400).json({ error: "ต้องระบุ id และข้อมูลที่ต้องการอัปเดต" });
        try {
            const sheetName = "Sale_pr";
            const result = await sheetsWrite.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${sheetName}!A1:AZ` });
            const allRows = result.data.values ?? [];
            const headers = allRows[0];
            const idColIndex = headers.indexOf("id");
            let rowIndex = -1;
            for (let i = 1; i < allRows.length; i++) { if ((allRows[i][idColIndex] || "").toString().trim() === id.trim()) { rowIndex = i; break; } }
            if (rowIndex === -1) return res.status(404).json({ error: "ไม่พบข้อมูล Order นี้" });

            const currentRow = allRows[rowIndex];
            const newRow = headers.map((header, j) => updatedData.hasOwnProperty(header) ? updatedData[header] : (currentRow[j] !== undefined ? currentRow[j] : ""));

            const user = req.session.user;
            const userName = user ? (user['ชื่อภาษาอังกฤษpic'] || 'Unknown') : 'Unknown';
            const dateStr = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
            
            const dateColIdx = headers.indexOf("วันที่แก้ไขล่าสุด");
            const editorColIdx = headers.indexOf("ผู้แก้ไขล่าสุด");
            if (dateColIdx !== -1) newRow[dateColIdx] = dateStr;
            if (editorColIdx !== -1) newRow[editorColIdx] = userName;

            await sheetsWrite.spreadsheets.values.update({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${sheetName}!A${rowIndex + 1}`, valueInputOption: "USER_ENTERED", requestBody: { values: [newRow] } });
            res.json({ success: true, message: "อัปเดตข้อมูลสำเร็จ" });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
