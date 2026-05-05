// Updated: modal product data rendering
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");
const path = require("path");
const app = express();

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());
app.use(express.json());

// ส่ง baseUrl ไปทุก view อัตโนมัติ
app.use((req, res, next) => {
    res.locals.baseUrl = process.env.BASE_URL || '';
    next();
});
const authReadonly = new google.auth.GoogleAuth({
    keyFile: "./striped-buckeye-485807-t7-f6b5b7ca48b8.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const authWrite = new google.auth.GoogleAuth({
    keyFile: "./striped-buckeye-485807-t7-f6b5b7ca48b8.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: authReadonly });
const sheetsWrite = google.sheets({ version: "v4", auth: authWrite });

app.get("/api/sheets", async (req, res) => {
    try {
        const result = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: "product!A1:Z1000", // เปลี่ยนชื่อ sheet
        });

        const [headers, ...rows] = result.data.values ?? [];
        if (!headers) return res.json({ data: [] });

        let data = rows.map((row) =>
            Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""]))
        );

        if (req.query.id) data = data.filter((row) => row["รหัส"] === req.query.id);

        res.json({ data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/', (req, res) => {
    res.render('index', {
        title: 'หน้าแรก',
        name: 'Thanadon'
    });
});

async function getsheet(id, table) {
    try {
        const result = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: `${table}!A1:Z`,
        });

        const [headers, ...rows] = result.data.values ?? [];
        if (!headers) return [];

        let data = rows.map((row) =>
            Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""]))
        );

        // ถ้า id เป็น null จะไม่ filter
        if (id) {
            data = data.filter((row) => row["id"] === id);
        }

        return data;
    } catch (err) {
        console.error("Error fetching sheet:", err.message);
        return [];
    }
}

app.get("/edit_sale", async (req, res) => {
    const idToEdit = req.query.id;
    const searchQuery = (req.query.search || "").trim().toLowerCase();

    console.log("ID จาก URL:", idToEdit);

    try {
        const subSalesData = await getsheet(idToEdit, "sub_sales_pr");
        const salesData = await getsheet(idToEdit, "Sale_pr");
        const allProductsRaw = await getsheet(null, "product");

        const saleHeaders = ["id", "วันที่", "PIC", "ลูกค้า-ผู้ขาย", "ผู้สร้าง", "โทรศัพท์", "Email", "เครดิต (วัน)"];
        const subSaleHeaders = ["สินค้า", "ชื่อสินค้า", "จำนวน", "ราคาต่อหน่วย", "ภาษี", "จำนวนเงินรวม"];
        const productHeaders = ["รหัส", "ชื่อ", "ชื่อจำเพราะ", "หน่วย", "ราคาขาย", "แบรนด์", "อัตราภาษีขาย"];

        // ฟังก์ชันช่วยในการ map data
        const mapDataByHeaders = (rawData, headers) => {
            if (!rawData || !headers) return []; // กันพังถ้าลืมส่งค่า
            return rawData.map(row => {
                const obj = {};
                headers.forEach(header => {
                    // ใช้คำสั่งนี้เพื่อให้ยอมรับค่าที่เป็น 0 หรือ string ว่างได้
                    obj[header] = row[header] !== undefined ? row[header] : "";
                });
                return obj;
            }).filter(obj => Object.keys(obj).length > 0);
        };

        // map data ตามหัวข้อที่กำหนด
        let salePrData = mapDataByHeaders(subSalesData, subSaleHeaders);
        let orderData = mapDataByHeaders(salesData, saleHeaders);
        let allProducts = mapDataByHeaders(allProductsRaw, productHeaders);
        // ตัวกรอง (ถ้ามี searchQuery)
        if (searchQuery) {
            salePrData = salePrData.filter(item =>
                Object.values(item).some(val =>
                    String(val).toLowerCase().includes(searchQuery)
                )
            );
        }

        console.log({
            subSalesData,
            salePrData,
            orderData,
            allProducts,
            searchQuery
        });

        res.render("edit_sale", {
            data: subSalesData,
            sale_pr: salePrData,
            order: orderData,
            allProducts: allProducts,
            search: req.query.search || "",
            idToEdit: idToEdit
        });
    } catch (err) {
        console.error("Error in /edit_sale:", err);
        res.status(500).send({ error: err.message });
    }
});

app.get("/sale_pr", async (req, res) => {
    try {
        const data = await getsheet(null, "Sale_pr");
        const allowedHeaders = ["id", "วันที่", "PIC", "ลูกค้า-ผู้ขาย", "ผู้สร้าง", "โทรศัพท์"];

        // รับค่าค้นหา
        const searchQuery = (req.query.search || "").trim().toLowerCase();

        // 1. กรองคอลัมน์ (ตามโค้ดเดิมของคุณ)
        let filteredData = data.map(row => {
            let obj = {};
            allowedHeaders.forEach((h) => { if (row[h]) obj[h] = row[h]; });
            return obj;
        }).filter(obj => Object.keys(obj).length > 0);

        // 2. กรองข้อมูลตามคำค้นหา (ค้นหาจากทุกคอลัมน์ที่มีใน allowedHeaders)
        if (searchQuery) {
            filteredData = filteredData.filter(item => {
                return Object.values(item).some(val =>
                    String(val).toLowerCase().includes(searchQuery)
                );
            });
        }

        // ส่งกลับไปที่หน้า sale_pr.ejs
        res.render("sale_pr", {
            data: filteredData,
            search: req.query.search || "" // ต้องส่งตัวนี้กลับไปด้วยเสมอ
        });

    } catch (err) {
        res.status(500).send(err.message);
    }
});

// ปรับปรุง /delsale ให้ลบทั้งใน sales_pr และ sub_sales_pr
app.get("/delsale", async (req, res) => {
    const idToDelete = req.query.id;

    if (!idToDelete) {
        return res.status(400).send("ไม่พบ ID ที่ต้องการลบ");
    }

    try {
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        // 1. หา Sheet IDs
        const spreadsheet = await sheetsWrite.spreadsheets.get({ spreadsheetId });
        const salesPrSheet = spreadsheet.data.sheets.find(s => s.properties.title === "Sale_pr");
        const subSalesPrSheet = spreadsheet.data.sheets.find(s => s.properties.title === "sub_sales_pr");

        if (!salesPrSheet || !subSalesPrSheet) {
            return res.status(500).send("ไม่พบ Sheet ที่ต้องการ");
        }

        // 2. หาแถวที่ต้องลบใน sales_pr
        const salesPrRes = await sheetsWrite.spreadsheets.values.get({
            spreadsheetId,
            range: "Sale_pr!A:A",
        });
        const salesPrRows = salesPrRes.data.values || [];
        const salesPrIndex = salesPrRows.findIndex(row => row[0] === idToDelete);

        // 3. หาแถวที่ต้องลบใน sub_sales_pr
        const subSalesPrRes = await sheetsWrite.spreadsheets.values.get({
            spreadsheetId,
            range: "sub_sales_pr!A:A",
        });
        const subSalesPrRows = subSalesPrRes.data.values || [];
        const subSalesPrIndices = [];
        subSalesPrRows.forEach((row, index) => {
            if (row[0] === idToDelete) subSalesPrIndices.push(index);
        });

        const requests = [];

        // ลบใน sub_sales_pr (ลบจากล่างขึ้นบน)
        if (subSalesPrIndices.length > 0) {
            subSalesPrIndices.sort((a, b) => b - a).forEach(index => {
                requests.push({
                    deleteDimension: {
                        range: {
                            sheetId: subSalesPrSheet.properties.sheetId,
                            dimension: "ROWS",
                            startIndex: index,
                            endIndex: index + 1
                        }
                    }
                });
            });
        }

        // ลบใน sales_pr
        if (salesPrIndex !== -1) {
            requests.push({
                deleteDimension: {
                    range: {
                        sheetId: salesPrSheet.properties.sheetId,
                        dimension: "ROWS",
                        startIndex: salesPrIndex,
                        endIndex: salesPrIndex + 1
                    }
                }
            });
        }

        if (requests.length > 0) {
            await sheetsWrite.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: { requests },
            });
        }

        console.log(`ลบข้อมูล ID: ${idToDelete} สำเร็จ`);
        res.redirect("/sale_pr");

    } catch (error) {
        console.error("Error deleting order:", error);
        res.status(500).send("เกิดข้อผิดพลาดในการลบข้อมูล: " + error.message);
    }
});


// API ลบแถวจาก sub_sales_pr sheet
app.post("/api/delete_rows", async (req, res) => {
    const { id, productCodes } = req.body;
    console.log('API /api/delete_rows called with:', { id, productCodes });
    if (!id || !productCodes || !Array.isArray(productCodes) || productCodes.length === 0) {
        return res.status(400).json({ error: "ต้องระบุ id และ productCodes" });
    }

    try {
        const sheetName = "sub_sales_pr";
        const result = await sheetsWrite.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: `${sheetName}!A1:Z`,
        });

        const allRows = result.data.values ?? [];
        if (allRows.length === 0) return res.json({ deleted: 0 });

        const headers = allRows[0];
        const idColIndex = headers.indexOf("id");
        const productColIndex = headers.indexOf("สินค้า");

        if (idColIndex === -1 || productColIndex === -1) {
            return res.status(500).json({ error: "ไม่พบคอลัมน์ id หรือ สินค้า ใน sheet" });
        }

        // หา sheet ID (gid) สำหรับ batchUpdate
        const spreadsheet = await sheetsWrite.spreadsheets.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
        });
        const sheetMeta = spreadsheet.data.sheets.find(
            (s) => s.properties.title === sheetName
        );
        if (!sheetMeta) {
            return res.status(500).json({ error: `ไม่พบ sheet ชื่อ ${sheetName}` });
        }
        const sheetId = sheetMeta.properties.sheetId;

        // หาแถวที่ต้องลบ (index ใน sheet, 0-based)
        const rowsToDelete = [];
        for (let i = 1; i < allRows.length; i++) {
            const row = allRows[i];
            const rowId = (row[idColIndex] || "").toString().trim();
            const rowProduct = (row[productColIndex] || "").toString().trim();

            if (rowId === id.trim() && productCodes.map(pc => pc.trim()).includes(rowProduct)) {
                rowsToDelete.push(i);
            }
        }

        if (rowsToDelete.length === 0) {
            return res.json({ deleted: 0 });
        }

        // ลบจากล่างขึ้นบน เพื่อไม่ให้ index เลื่อน
        rowsToDelete.sort((a, b) => b - a);

        const requests = rowsToDelete.map((rowIndex) => ({
            deleteDimension: {
                range: {
                    sheetId: sheetId,
                    dimension: "ROWS",
                    startIndex: rowIndex,
                    endIndex: rowIndex + 1,
                },
            },
        }));

        await sheetsWrite.spreadsheets.batchUpdate({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            requestBody: { requests },
        });

        console.log(`ลบ ${rowsToDelete.length} แถว จาก ${sheetName} สำเร็จ`);
        res.json({ deleted: rowsToDelete.length });
    } catch (err) {
        console.error("Error deleting rows:", err);
        res.status(500).json({ error: err.message });
    }
});

// API เพิ่มสินค้าลงใน sub_sales_pr sheet
app.post("/api/add_rows", async (req, res) => {
    const { id, products } = req.body;
    console.log('API /api/add_rows called with:', { id, productsCount: products ? products.length : 0 });

    if (!id || !products || !Array.isArray(products) || products.length === 0) {
        return res.status(400).json({ error: "ต้องระบุ id และรายการสินค้า" });
    }

    try {
        const sheetName = "sub_sales_pr";

        // ข้อมูลที่ต้องการเขียนลง sheet ตามลำดับ header
        // ['id', 'สินค้า', 'ชื่อสินค้า', 'ข้อมูลจำเพราะ', 'จำนวน', 'หน่วย', 'ราคาต่อหน่วย', 'จำนวนเงิน', 'ภาษี', 'จำนวนเงินรวม']
        const values = products.map(p => {
            const qty = parseFloat(p.quantity) || 0;
            const price = parseFloat(p['ราคาขาย']) || 0;
            const taxRateStr = (p['อัตราภาษีขาย'] || "0").toString().replace('%', '');
            const taxRate = parseFloat(taxRateStr) || 0;

            const amount = qty * price;
            const tax = amount * (taxRate / 100);
            const total = amount + tax;

            return [
                id,                  // id
                p.รหัส || "",         // สินค้า
                p.ชื่อ || "",         // ชื่อสินค้า
                p.ชื่อจำเพราะ || "",   // ข้อมูลจำเพราะ
                qty,                 // จำนวน
                p.หน่วย || "",        // หน่วย
                price,               // ราคาต่อหน่วย
                amount,              // จำนวนเงิน
                tax,                 // ภาษี
                total                // จำนวนเงินรวม
            ];
        });

        await sheetsWrite.spreadsheets.values.append({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: `${sheetName}!A:J`,
            valueInputOption: "USER_ENTERED",
            requestBody: {
                values: values
            }
        });

        console.log(`เพิ่ม ${products.length} รายการลงใน ${sheetName} สำเร็จ`);
        res.json({ success: true, added: products.length });
    } catch (err) {
        console.error("Error adding rows:", err);
        res.status(500).json({ error: err.message });
    }
});

// API บันทึกการเปลี่ยนแปลงทั้งหมด (ทั้งเพิ่มและลบ)
app.post("/api/save_changes", async (req, res) => {
    const { id, deletes, adds } = req.body;
    console.log('API /api/save_changes called for ID:', id, 'Deletes:', deletes?.length, 'Adds:', adds?.length);

    if (!id) {
        return res.status(400).json({ error: "ต้องระบุ id" });
    }

    try {
        const sheetName = "sub_sales_pr";
        let deletedCount = 0;
        let addedCount = 0;

        // 1. จัดการการลบ (Deletes)
        if (deletes && Array.isArray(deletes) && deletes.length > 0) {
            const result = await sheetsWrite.spreadsheets.values.get({
                spreadsheetId: process.env.GOOGLE_SHEET_ID,
                range: `${sheetName}!A1:Z`,
            });

            const allRows = result.data.values ?? [];
            if (allRows.length > 0) {
                const headers = allRows[0];
                const idColIndex = headers.indexOf("id");
                const productColIndex = headers.indexOf("สินค้า");

                if (idColIndex !== -1 && productColIndex !== -1) {
                    const spreadsheet = await sheetsWrite.spreadsheets.get({
                        spreadsheetId: process.env.GOOGLE_SHEET_ID,
                    });
                    const sheetMeta = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
                    const sheetId = sheetMeta.properties.sheetId;

                    const rowsToDelete = [];
                    for (let i = 1; i < allRows.length; i++) {
                        const row = allRows[i];
                        const rowId = (row[idColIndex] || "").toString().trim();
                        const rowProduct = (row[productColIndex] || "").toString().trim();

                        if (rowId === id.trim() && deletes.map(d => d.trim()).includes(rowProduct)) {
                            rowsToDelete.push(i);
                        }
                    }

                    if (rowsToDelete.length > 0) {
                        rowsToDelete.sort((a, b) => b - a);
                        const requests = rowsToDelete.map((rowIndex) => ({
                            deleteDimension: {
                                range: {
                                    sheetId: sheetId,
                                    dimension: "ROWS",
                                    startIndex: rowIndex,
                                    endIndex: rowIndex + 1,
                                },
                            },
                        }));

                        await sheetsWrite.spreadsheets.batchUpdate({
                            spreadsheetId: process.env.GOOGLE_SHEET_ID,
                            requestBody: { requests },
                        });
                        deletedCount = rowsToDelete.length;
                    }
                }
            }
        }

        // 2. จัดการการเพิ่ม (Adds)
        if (adds && Array.isArray(adds) && adds.length > 0) {
            const values = adds.map(p => {
                const qty = parseFloat(p.quantity) || 0;
                const price = parseFloat(p['ราคาขาย']) || 0;
                const taxRateStr = (p['อัตราภาษีขาย'] || "0").toString().replace('%', '');
                const taxRate = parseFloat(taxRateStr) || 0;

                const amount = qty * price;
                const tax = amount * (taxRate / 100);
                const total = amount + tax;

                return [
                    id,                  // id
                    p['รหัส'] || "",      // สินค้า
                    p['ชื่อ'] || "",      // ชื่อสินค้า
                    p['ชื่อจำเพราะ'] || "", // ข้อมูลจำเพราะ
                    qty,                 // จำนวน
                    p['หน่วย'] || "",     // หน่วย
                    price,               // ราคาต่อหน่วย
                    amount,              // จำนวนเงิน
                    tax,                 // ภาษี
                    total                // จำนวนเงินรวม
                ];
            });

            await sheetsWrite.spreadsheets.values.append({
                spreadsheetId: process.env.GOOGLE_SHEET_ID,
                range: `${sheetName}!A:J`,
                valueInputOption: "USER_ENTERED",
                requestBody: { values }
            });
            addedCount = adds.length;
        }

        console.log(`บันทึกการเปลี่ยนแปลงสำเร็จ: ลบ ${deletedCount}, เพิ่ม ${addedCount}`);
        res.json({ success: true, deleted: deletedCount, added: addedCount });

    } catch (err) {
        console.error("Error saving changes:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/generate-pdf', async (req, res) => {
    try {
        console.log('Proxying request to generate-pdf...');
        const response = await fetch('http://185.84.161.60:4000/api/generate-pdf', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(req.body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`External API Error Body:`, errorText);
            throw new Error(`External API returned status: ${response.status} - ${errorText}`);
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            return res.json(data);
        } else {
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            if (contentType) {
                res.setHeader('Content-Type', contentType);
            } else {
                res.setHeader('Content-Type', 'application/pdf');
            }
            // Let the frontend handle the blob downloading
            return res.send(buffer);
        }
    } catch (error) {
        console.error('Error in proxy /api/generate-pdf:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(process.env.PORT || 5000, "0.0.0.0", () =>
    console.log(`Server running on port ${process.env.PORT || 5000}`)
);