// Updated: modal product data rendering
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");
const path = require("path");
const fs = require("fs"); // เพิ่ม fs สำหรับอ่านไฟล์
const app = express();

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Simple DoS Detection Middleware ---
const requestCounts = new Map();
const DOS_THRESHOLD = 50; // จำนวน request สูงสุดต่อ 10 วินาที
const RESET_INTERVAL = 10000; // 10 วินาที

setInterval(() => requestCounts.clear(), RESET_INTERVAL);

app.use((req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const currentCount = (requestCounts.get(ip) || 0) + 1;
    requestCounts.set(ip, currentCount);

    if (currentCount === DOS_THRESHOLD) {
        console.error(`[!!! DOS WARNING !!!] IP: ${ip} is making too many requests! (${currentCount} reqs in 10s)`);
    } else if (currentCount > DOS_THRESHOLD && currentCount % 50 === 0) {
        console.error(`[!!! DOS CONTINUING !!!] IP: ${ip} | Total: ${currentCount} reqs`);
    }
    next();
});

const session = require("express-session");
const FileStore = require('session-file-store')(session);

app.use(session({
    store: new FileStore({
        path: './sessions',
        retries: 0
    }),
    secret: 'erp-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: 1000 * 60 * 60 * 24 * 7 // 7 วัน
    }
}));

// ส่ง baseUrl ไปทุก view อัตโนมัติ
app.use((req, res, next) => {
    let baseUrl = process.env.BASE_URL || '';
    if (baseUrl.endsWith('/')) {
        baseUrl = baseUrl.slice(0, -1);
    }
    res.locals.baseUrl = baseUrl;
    res.locals.webhookUrl = process.env.WEBHOOK_TEST_URL || '';
    next();
});
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

// Simple In-memory Cache
const sheetCache = new Map();
const CACHE_TTL = 30 * 1000; // 30 seconds

async function getsheet(id, table) {
    const cacheKey = `${table}_all`;
    const now = Date.now();

    try {
        let data;
        
        if (sheetCache.has(cacheKey)) {
            const cached = sheetCache.get(cacheKey);
            if (now - cached.timestamp < CACHE_TTL) {
                console.log(`[DEBUG] Cache hit for ${table}`);
                data = cached.data;
            }
        }

        if (!data) {
            console.log(`[DEBUG] Fetching fresh data from Google Sheets: ${table}`);
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: process.env.GOOGLE_SHEET_ID,
                range: `${table}!A1:AZ`,
            });

            const rowsRaw = result.data.values ?? [];
            if (rowsRaw.length === 0) {
                console.log(`[DEBUG] Sheet ${table} is empty`);
                return [];
            }

            const [headersRaw, ...rows] = rowsRaw;
            const headers = headersRaw.map(h => (h || "").toString().trim());
            console.log(`[DEBUG] Headers for ${table} (trimmed):`, headers);

            data = rows.map((row, rowIndex) => {
                const obj = {};
                headers.forEach((h, i) => {
                    obj[h] = row[i] ?? "";
                });
                return obj;
            });

            sheetCache.set(cacheKey, { data, timestamp: now });
        }

        if (id) {
            const searchId = String(id).trim();
            console.log(`[DEBUG] Attempting to filter ${table} for ID: "${searchId}" (Length: ${searchId.length})`);
            
            const filtered = data.filter((row, idx) => {
                const rawRowId = row["id"] || row["ID"] || row["Id"] || row["รหัส"];
                const rowId = String(rawRowId).trim();
                
                // แก้ไข Logic Bug: ใช้ Suffix Match ป้องกันการเจอข้อมูลผิด (เช่น "1" ไปเจอ "10")
                const isExactMatch = rowId === searchId;
                const isSuffixMatch = rowId.endsWith("-" + searchId); // เช่น "so-AS-001" กับ "AS-001"
                const match = isExactMatch || isSuffixMatch;
                
                if (idx < 5 || match) {
                    console.log(`   - Row ${idx} ID: "${rawRowId}" -> Match: ${match} (${isExactMatch ? 'Exact' : (isSuffixMatch ? 'Suffix' : 'No')})`);
                }
                return match;
            });
            console.log(`[DEBUG] Filtered ${table} for ID ${id}: found ${filtered.length} matches`);
            return filtered;
        }

        console.log(`[DEBUG] Returning all ${data.length} rows for ${table}`);
        return data;
    } catch (err) {
        console.error(`[ERROR] getsheet (${table}):`, err.message);
        return [];
    }
}

async function generateNextId(prefix, sheetName) {
    try {
        const now = new Date();
        // Thai year (Buddhist year) = Gregorian year + 543
        const yy = ((now.getFullYear() + 543) % 100).toString().padStart(2, '0');
        const mm = (now.getMonth() + 1).toString().padStart(2, '0');
        const pattern = `${prefix}-${yy}${mm}-`;

        const result = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: `${sheetName}!A:A`,
        });

        const rows = result.data.values || [];
        const ids = rows.flat().filter(id => id && id.trim().startsWith(pattern));
        
        let maxSeq = 0;
        ids.forEach(id => {
            const parts = id.trim().split('-');
            if (parts.length === 3) {
                const seq = parseInt(parts[2]);
                if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
            }
        });

        const nextSeq = (maxSeq + 1).toString().padStart(4, '0');
        return `${pattern}${nextSeq}`;
    } catch (err) {
        console.error("Error generating next ID:", err);
        return `${prefix}-${Date.now()}`; // fallback
    }
}

// Login Routes
app.get('/login', (req, res) => {
    if (req.session && req.session.user) return res.redirect('/');
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    try {
        const employees = await getsheet(null, 'empolyee');
        const user = employees.find(e => e['ชื่อภาษาอังกฤษpic'] === username && e['password'] === password);
        
        if (user) {
            req.session.user = user;
            console.log(`[LOGIN SUCCESS] User: ${user['ชื่อภาษาอังกฤษpic']} (${user['ชื่อpic']}) | IP: ${ip} | Time: ${new Date().toLocaleString('th-TH')}`);
            return res.redirect('/');
        } else {
            console.warn(`[LOGIN FAILED] Attempted Username: ${username} | IP: ${ip} | Time: ${new Date().toLocaleString('th-TH')}`);
            return res.render('login', { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
        }
    } catch (err) {
        console.error(`[LOGIN ERROR] IP: ${ip} | Error: ${err.message}`);
        return res.render('login', { error: 'เกิดข้อผิดพลาดในการตรวจสอบข้อมูล' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Middleware ตรวจสอบการ Login
const requireLogin = (req, res, next) => {
    if (req.session && req.session.user) {
        res.locals.user = req.session.user; // ส่งข้อมูลพนักงานไปที่ view
        next();
    } else {
        res.redirect('/login');
    }
};

// --- ป้องกันทุก Route ด้านล่างนี้ ต้อง Login ก่อน ---
app.use(requireLogin);

app.get("/api/sheets", async (req, res) => {
    try {
        const result = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: "product!A1:AZ1000", // เปลี่ยนชื่อ sheet
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

app.get('/', async (req, res) => {
    try {
        const salesPr = await getsheet(null, 'Sale_pr');
        const salesSo = await getsheet(null, 'sales_so');
        const subSalesSo = await getsheet(null, 'sub_sales_so');
        const precherPo = await getsheet(null, 'precher_po'); // เพิ่มการดึงข้อมูล precher_po
        const subPrecherPo = await getsheet(null, 'sub_precher_po'); // เพิ่มการดึงข้อมูล sub_precher_po
        const stock = await getsheet(null, 'stock');

        // 1. คำนวณยอดขายรวม (ดึงมาจาก sub_sales_so ตามคำขอ)
        let totalRevenue = 0;
        subSalesSo.forEach(row => {
            const total = parseFloat(String(row['จำนวนเงินรวม'] || 0).replace(/,/g, ''));
            if (!isNaN(total)) totalRevenue += total;
        });

        // คำนวณยอดซื้อรวม (ดึงมาจาก sub_precher_po)
        let totalPurchase = 0;
        subPrecherPo.forEach(row => {
            const total = parseFloat(String(row['จำนวนเงินรวม'] || 0).replace(/,/g, ''));
            if (!isNaN(total)) totalPurchase += total;
        });

        // 2. ข้อมูลสำหรับกราฟเส้น (การขายและการซื้อรายเดือน - ย้อนหลัง 12 เดือนจนถึงเดือนนี้)
        const monthNamesFull = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
        const rollingLabels = [];
        const rollingSales = Array(13).fill(0);
        const rollingPurchases = Array(13).fill(0);
        
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        // สร้าง Labels สำหรับ 13 เดือนย้อนหลัง (เช่น พ.ค. 2025 - พ.ค. 2026)
        for (let i = 12; i >= 0; i--) {
            let m = currentMonth - i;
            let y = currentYear;
            if (m < 0) {
                m += 12;
                y -= 1;
            }
            rollingLabels.push(`${monthNamesFull[m]} ${y + 543}`); // ใช้ปี พ.ศ.
        }

        // ฟังก์ชันหา Index ของเดือนในกราฟ
        const getRollingIndex = (dateStr) => {
            if (!dateStr) return -1;
            const parts = dateStr.split('/');
            if (parts.length < 3) return -1;
            
            const d = parseInt(parts[0]);
            const m = parseInt(parts[1]) - 1;
            let y = parseInt(parts[2]);
            if (y > 2500) y -= 543; // แปลง พ.ศ. เป็น ค.ศ. ถ้าจำเป็น

            const date = new Date(y, m, d);
            const monthsDiff = (currentYear - date.getFullYear()) * 12 + (currentMonth - date.getMonth());
            
            if (monthsDiff >= 0 && monthsDiff <= 12) {
                return 12 - monthsDiff;
            }
            return -1;
        };

        // สร้าง Map ของวันที่
        const salesDateMap = {};
        salesSo.forEach(row => { if (row['id'] && row['วันที่']) salesDateMap[row['id']] = row['วันที่']; });
        const purchaseDateMap = {};
        precherPo.forEach(row => { if (row['id'] && row['วันที่']) purchaseDateMap[row['id']] = row['วันที่']; });

        // คำนวณยอดขายรายเดือน
        subSalesSo.forEach(row => {
            const dateStr = salesDateMap[row['id']];
            const idx = getRollingIndex(dateStr);
            if (idx !== -1) {
                const total = parseFloat(String(row['จำนวนเงินรวม'] || 0).replace(/,/g, ''));
                if (!isNaN(total)) rollingSales[idx] += total;
            }
        });

        // คำนวณยอดซื้อรายเดือน
        subPrecherPo.forEach(row => {
            const dateStr = purchaseDateMap[row['id']];
            const idx = getRollingIndex(dateStr);
            if (idx !== -1) {
                const total = parseFloat(String(row['จำนวนเงินรวม'] || 0).replace(/,/g, ''));
                if (!isNaN(total)) rollingPurchases[idx] += total;
            }
        });

        // 3. ข้อมูลสำหรับกราฟวงกลม (สถานะออเดอร์)
        const statusCounts = {
            'confirmed': salesPr.filter(r => ['สำเร็จ', 'ยืนยันแล้ว'].includes((r['สถานะเอกสาร'] || '').trim())).length,
            'pending': salesPr.filter(r => !['สำเร็จ', 'ยืนยันแล้ว'].includes((r['สถานะเอกสาร'] || '').trim())).length
        };

        const pendingOrders = statusCounts.pending;
        const lowStockItems = stock.filter(row => {
            const qty = parseFloat(row['จำนวน'] || 0);
            return qty > 0 && qty < 10;
        }).length;

        const recentSales = salesPr.slice(-5).reverse();

        res.render('index', {
            title: 'Dashboard',
            stats: {
                totalRevenue: totalRevenue.toLocaleString(),
                pendingOrders: pendingOrders,
                totalPurchase: totalPurchase.toLocaleString(),
                totalProducts: stock.length
            },
            chartData: {
                labels: rollingLabels,
                sales: rollingSales,
                purchases: rollingPurchases,
                comparison: [totalRevenue, totalPurchase], // ส่งข้อมูลเปรียบเทียบยอดขาย vs ยอดซื้อ
                status: [statusCounts.confirmed, statusCounts.pending]
            },
            recentSales: recentSales
        });
    } catch (err) {
        console.error("Dashboard error:", err);
        res.render('index', {
            title: 'Dashboard',
            stats: { totalRevenue: 0, pendingOrders: 0, lowStockCount: 0, totalProducts: 0 },
            chartData: { labels: [], sales: [], purchases: [], status: [0, 0] },
            recentSales: []
        });
    }
});


app.get("/edit_sale", async (req, res) => {
    const idToEdit = req.query.id;
    const searchQuery = (req.query.search || "").trim().toLowerCase();

    console.log("ID จาก URL:", idToEdit);

    try {
        const subSalesData = await getsheet(idToEdit, "sub_sales_pr");
        const salesData = await getsheet(idToEdit, "Sale_pr");
        const allProductsRaw = await getsheet(null, "product");

        const saleHeaders = ["id", "วันที่", "PIC", "ลูกค้า-ผู้ขาย", "โทรศัพท์", "สถานะเอกสาร"];
        const subSaleHeaders = ["id", "สินค้า", "ชื่อสินค้า", "ข้อมูลจำเพราะ", "จำนวน", "หน่วย", "ราคาต่อหน่วย", "จำนวนเงิน", "ภาษี", "จำนวนเงินรวม"];
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
            rawSalesData: salesData,
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
        const allowedHeaders = ["id", "วันที่", "PIC", "ลูกค้า-ผู้ขาย", "โทรศัพท์", "สถานะเอกสาร"];

        const searchQuery = (req.query.search || "").trim().toLowerCase();
        const statusFilter = (req.query.status || "ทั้งหมด");

        let filteredData = data.map(row => {
            let obj = {};
            allowedHeaders.forEach((h) => { 
                const rawVal = (row[h] || "").toString().trim();
                if (h === 'สถานะเอกสาร') {
                    // ปรับ Logic การ Map สถานะให้แม่นยำขึ้น (รองรับทั้ง 'สำเร็จ' และ 'ยืนยันแล้ว')
                    const isConfirmed = ['สำเร็จ', 'ยืนยันแล้ว'].includes(rawVal);
                    obj[h] = isConfirmed ? 'ยืนยันแล้ว' : 'ยังไม่ยืนยัน';
                } else {
                    obj[h] = rawVal;
                }
            });
            return obj;
        }).filter(obj => Object.keys(obj).length > 0);

        if (searchQuery) {
            filteredData = filteredData.filter(item => {
                return Object.values(item).some(val =>
                    String(val).toLowerCase().includes(searchQuery)
                );
            });
        }

        if (statusFilter !== "ทั้งหมด") {
            filteredData = filteredData.filter(item => item['สถานะเอกสาร'] === statusFilter);
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
            sheetCache.delete("Sale_pr_all");
            sheetCache.delete("sub_sales_pr_all");
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
            range: `${sheetName}!A1:AZ`,
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
    const { id, finalItems, orderChanges } = req.body;
    console.log('API /api/save_changes (Consolidated) called for ID:', id, 'Items:', finalItems?.length);

    if (!id) {
        return res.status(400).json({ error: "ต้องระบุ id" });
    }

    try {
        const sheetName = "sub_sales_pr";
        
        // 1. Fetch current rows to find indices to delete
        const result = await sheetsWrite.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: `${sheetName}!A1:AZ`,
        });

        const allRows = result.data.values ?? [];
        if (allRows.length > 0) {
            const headers = allRows[0];
            const idColIndex = headers.indexOf("id");

            if (idColIndex !== -1) {
                const spreadsheet = await sheetsWrite.spreadsheets.get({
                    spreadsheetId: process.env.GOOGLE_SHEET_ID,
                });
                const sheetMeta = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
                const sheetId = sheetMeta.properties.sheetId;

                const rowsToDelete = [];
                for (let i = 1; i < allRows.length; i++) {
                    const row = allRows[i];
                    const rowId = (row[idColIndex] || "").toString().trim();
                    if (rowId === id.trim()) {
                        rowsToDelete.push(i);
                    }
                }

                // Delete all existing items for this ID
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
                }
            }
        }

        // 2. Insert Final Items (Grouped and Recalculated)
        if (finalItems && Array.isArray(finalItems) && finalItems.length > 0) {
            const values = finalItems.map(p => {
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
        }

        // 3. Update Main Order (Sale_pr)
        try {
            const saleSheetName = "Sale_pr";
            const user = req.session.user;
            const userName = user ? (user['ชื่อภาษาอังกฤษpic'] || 'Unknown') : 'Unknown';

            const now = new Date();
            const dateStr = now.toLocaleString('th-TH', {
                timeZone: 'Asia/Bangkok',
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });

            const saleResult = await sheetsWrite.spreadsheets.values.get({
                spreadsheetId: process.env.GOOGLE_SHEET_ID,
                range: `${saleSheetName}!A1:AZ`,
            });

            const saleRows = saleResult.data.values ?? [];
            if (saleRows.length > 0) {
                const saleHeaders = saleRows[0];
                const saleIdCol = saleHeaders.indexOf("id");
                const saleDateCol = saleHeaders.indexOf("วันที่แก้ไขล่าสุด");
                const saleEditorCol = saleHeaders.indexOf("ผู้แก้ไขล่าสุด");

                if (saleIdCol !== -1) {
                    let saleRowIndex = -1;
                    for (let i = 1; i < saleRows.length; i++) {
                        if ((saleRows[i][saleIdCol] || "").toString().trim() === id.trim()) {
                            saleRowIndex = i;
                            break;
                        }
                    }

                    if (saleRowIndex !== -1) {
                        const saleRow = [...(saleRows[saleRowIndex] || [])];

                        if (orderChanges && typeof orderChanges === 'object') {
                            for (let j = 0; j < saleHeaders.length; j++) {
                                const header = saleHeaders[j];
                                if (orderChanges.hasOwnProperty(header)) {
                                    while (saleRow.length <= j) saleRow.push("");
                                    saleRow[j] = orderChanges[header];
                                }
                            }
                        }

                        if (saleDateCol !== -1) {
                            while (saleRow.length <= saleDateCol) saleRow.push("");
                            saleRow[saleDateCol] = dateStr;
                        }
                        if (saleEditorCol !== -1) {
                            while (saleRow.length <= saleEditorCol) saleRow.push("");
                            saleRow[saleEditorCol] = userName;
                        }

                        await sheetsWrite.spreadsheets.values.update({
                            spreadsheetId: process.env.GOOGLE_SHEET_ID,
                            range: `${saleSheetName}!A${saleRowIndex + 1}`,
                            valueInputOption: "USER_ENTERED",
                            requestBody: { values: [saleRow] },
                        });
                    }
                }
            }
        } catch (updateErr) {
            console.error("Error updating Sale_pr:", updateErr);
        }

        res.json({ success: true, message: "บันทึกการเปลี่ยนแปลงทั้งหมดเรียบร้อยแล้ว" });

    } catch (err) {
        console.error("Error saving changes:", err);
        res.status(500).json({ error: err.message });
    }
});

// API อัปเดตข้อมูล Order
app.post("/api/update_order", async (req, res) => {
    const { id, updatedData } = req.body;
    console.log('API /api/update_order called for ID:', id);

    if (!id || !updatedData) {
        return res.status(400).json({ error: "ต้องระบุ id และข้อมูลที่ต้องการอัปเดต" });
    }

    try {
        const sheetName = "Sale_pr";

        const result = await sheetsWrite.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: `${sheetName}!A1:AZ`,
        });

        const allRows = result.data.values ?? [];
        if (allRows.length === 0) return res.status(404).json({ error: "ไม่พบข้อมูลใน Sheet" });

        const headers = allRows[0];
        const idColIndex = headers.indexOf("id");
        if (idColIndex === -1) return res.status(500).json({ error: "ไม่พบคอลัมน์ id" });

        let rowIndex = -1;
        for (let i = 1; i < allRows.length; i++) {
            if ((allRows[i][idColIndex] || "").toString().trim() === id.trim()) {
                rowIndex = i;
                break;
            }
        }

        if (rowIndex === -1) return res.status(404).json({ error: "ไม่พบข้อมูล Order นี้" });

        const currentRow = allRows[rowIndex];
        const newRow = [];

        for (let j = 0; j < headers.length; j++) {
            const header = headers[j];
            if (updatedData.hasOwnProperty(header)) {
                newRow[j] = updatedData[header];
            } else {
                newRow[j] = currentRow[j] !== undefined ? currentRow[j] : "";
            }
        }

        // อัปเดต วันที่แก้ไขล่าสุด / ผู้แก้ไขล่าสุด อัตโนมัติ
        const user = req.session.user;
        const userName = user ? (user['ชื่อภาษาอังกฤษpic'] || 'Unknown') : 'Unknown';
        const now = new Date();
        const dateStr = now.toLocaleString('th-TH', {
            timeZone: 'Asia/Bangkok',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });

        const dateColIdx = headers.indexOf("วันที่แก้ไขล่าสุด");
        const editorColIdx = headers.indexOf("ผู้แก้ไขล่าสุด");
        if (dateColIdx !== -1) {
            while (newRow.length <= dateColIdx) newRow.push("");
            newRow[dateColIdx] = dateStr;
        }
        if (editorColIdx !== -1) {
            while (newRow.length <= editorColIdx) newRow.push("");
            newRow[editorColIdx] = userName;
        }

        // อัปเดตลง Google Sheets เริ่มต้นที่คอลัมน์ A ของแถวนั้น
        await sheetsWrite.spreadsheets.values.update({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: `${sheetName}!A${rowIndex + 1}`,
            valueInputOption: "USER_ENTERED",
            requestBody: {
                values: [newRow],
            },
        });

        console.log(`อัปเดตข้อมูล Order ID: ${id} สำเร็จ โดย ${userName} เวลา ${dateStr}`);
        res.json({ success: true, message: "อัปเดตข้อมูลสำเร็จ" });

    } catch (err) {
        console.error("Error updating order:", err);
        res.status(500).json({ error: err.message });
    }
});

// API ยืนยัน + อัปเดตวันที่แก้ไขล่าสุด / ผู้แก้ไขล่าสุด แล้วส่ง Webhook
app.post("/api/confirm-webhook", async (req, res) => {
    const { id } = req.body;
    console.log("--- Confirm Webhook Debug ---");
    console.log("Request ID:", id);

    if (!id) {
        console.warn("No ID provided in request body");
        return res.status(400).json({ error: "ต้องระบุ id" });
    }

    try {
        const sheetName = "Sale_pr";
        const user = req.session.user;
        const userName = user ? (user['ชื่อภาษาอังกฤษpic'] || 'Unknown') : 'Unknown';

        // Format date/time in Thai timezone
        const now = new Date();
        const dateStr = now.toLocaleString('th-TH', {
            timeZone: 'Asia/Bangkok',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });

        // 1. Read the entire sheet
        const result = await sheetsWrite.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: `${sheetName}!A1:AZ`,
        });

        const allRows = result.data.values ?? [];
        if (allRows.length === 0) {
            console.warn("Sheet is empty or not found");
            return res.status(404).json({ error: "ไม่พบข้อมูลใน Sheet" });
        }

        const headers = [...allRows[0]];
        const idColIndex = headers.indexOf("id");
        if (idColIndex === -1) {
            console.error("Column 'id' not found in headers:", headers);
            return res.status(500).json({ error: "ไม่พบคอลัมน์ id" });
        }

        // 2. Find the target row
        let rowIndex = -1;
        for (let i = 1; i < allRows.length; i++) {
            if ((allRows[i][idColIndex] || "").toString().trim() === id.toString().trim()) {
                rowIndex = i;
                break;
            }
        }

        if (rowIndex === -1) {
            console.warn(`Record with ID ${id} not found in sheet`);
            return res.status(404).json({ error: `ไม่พบข้อมูล ID: ${id}` });
        }

        console.log(`Found record at row ${rowIndex + 1}`);

        // 3. Find or add header columns
        let dateColIndex = headers.indexOf("วันที่แก้ไขล่าสุด");
        let editorColIndex = headers.indexOf("ผู้แก้ไขล่าสุด");
        let statusColIndex = headers.indexOf("สถานะเอกสาร");

        let headersChanged = false;
        if (dateColIndex === -1) {
            dateColIndex = headers.length;
            headers.push("วันที่แก้ไขล่าสุด");
            headersChanged = true;
        }
        if (editorColIndex === -1) {
            editorColIndex = headers.length;
            headers.push("ผู้แก้ไขล่าสุด");
            headersChanged = true;
        }
        if (statusColIndex === -1) {
            statusColIndex = headers.length;
            headers.push("สถานะเอกสาร");
            headersChanged = true;
        }

        // 4. Update headers if new columns were added
        if (headersChanged) {
            console.log("Updating sheet headers to include missing columns...");
            await sheetsWrite.spreadsheets.values.update({
                spreadsheetId: process.env.GOOGLE_SHEET_ID,
                range: `${sheetName}!A1`,
                valueInputOption: "USER_ENTERED",
                requestBody: { values: [headers] },
            });
        }

        // 5. Update the target row
        const currentRow = [...(allRows[rowIndex] || [])];
        while (currentRow.length <= Math.max(dateColIndex, editorColIndex, statusColIndex)) {
            currentRow.push("");
        }

        currentRow[statusColIndex] = "สำเร็จ";
        currentRow[dateColIndex] = dateStr;
        currentRow[editorColIndex] = userName;

        console.log("Updating record with status 'สำเร็จ', date and editor...");
        await sheetsWrite.spreadsheets.values.update({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: `${sheetName}!A${rowIndex + 1}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [currentRow] },
        });

        // ล้าง Cache เพื่อให้หน้าเว็บอัปเดตทันที
        sheetCache.delete(`${sheetName}_all`);

        console.log(`ยืนยัน ID: ${id} และเปลี่ยนสถานะเป็น 'สำเร็จ' โดย ${userName} เวลา ${dateStr}`);

        // 6. Call the webhook
        const typeColIndex = headers.indexOf("ประเภทธุรกรรม");
        const transactionType = typeColIndex !== -1 ? (allRows[rowIndex][typeColIndex] || "") : "ไม่พบข้อมูลคอลัมน์";

        // ลำดับความสำคัญ: WEBHOOK_CONFIRM_SALE_URL -> WEBHOOK_SALES_URL -> WEBHOOK_TEST_URL
        // หากไม่มีใน .env จะใช้ค่า default เป็น localhost ตามที่แจ้งมา
        let webhookUrl = process.env.WEBHOOK_CONFIRM_SALE_URL || process.env.WEBHOOK_SALES_URL || process.env.WEBHOOK_TEST_URL;
        
        if (!webhookUrl) {
            webhookUrl = "https://n8n.thanadon.click/webhook-test/bbfedac4-3a58-4092-9e4a-3773234c19b1";
            console.log("- Using fallback local n8n URL");
        }

        console.log("Debug Webhook Selection:");
        console.log("- Transaction Type (from sheet):", transactionType);
        console.log("- Selected Webhook URL:", webhookUrl);

        const picId = user ? (user['รหัสpic'] || '') : '';
        let webhookSuccess = false;
        let webhookError = null;

        if (webhookUrl) {
            try {
                const urlWithParams = new URL(webhookUrl);
                urlWithParams.searchParams.append('id', id);
                urlWithParams.searchParams.append('name', userName); // ส่งชื่อ PIC ไปด้วย
                urlWithParams.searchParams.append('picId', picId);

                console.log("Calling external webhook:", urlWithParams.toString());
                
                // Add timeout protection (10 seconds)
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);

                const webhookResponse = await fetch(urlWithParams.toString(), {
                    method: 'GET',
                    signal: controller.signal
                });

                clearTimeout(timeoutId);
                console.log("External Webhook Response Status:", webhookResponse.status);

                if (webhookResponse.ok) {
                    webhookSuccess = true;
                } else {
                    const errorText = await webhookResponse.text();
                    console.error("External Webhook Error Response:", errorText);
                    return res.status(500).json({ 
                        success: false, 
                        error: `Webhook ตอบกลับด้วยข้อผิดพลาด (${webhookResponse.status}): ${errorText.substring(0, 100)}` 
                    });
                }
            } catch (webhookErr) {
                console.error("External Webhook error:", webhookErr);
                let errorMessage = `ไม่สามารถเชื่อมต่อกับ Webhook ได้: ${webhookErr.message}`;
                if (webhookErr.name === 'AbortError') {
                    errorMessage = 'Webhook ตอบสนองช้าเกินไป (Timeout 10s)';
                } else if (webhookErr.code === 'ECONNREFUSED') {
                    errorMessage = 'ไม่สามารถเชื่อมต่อกับ n8n ได้ (Connection Refused) ตรวจสอบว่า n8n รันอยู่หรือไม่?';
                }
                return res.status(500).json({ 
                    success: false, 
                    error: errorMessage 
                });
            }
        } else {
            console.warn("No webhook URL defined for confirmation!");
            return res.status(500).json({ 
                success: false, 
                error: "ไม่พบการตั้งค่า Webhook URL ในระบบ (ตรวจสอบ .env)" 
            });
        }

        res.json({
            success: true,
            sheetUpdated: true,
            webhookSuccess: true
        });

    } catch (err) {
        console.error("Error in confirm-webhook:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/generate-pdf', async (req, res) => {
    try {
        console.log('Proxying request to generate-pdf...');
        const pdfApiUrl = process.env.PDF_API_URL || 'https://pdf.thanadon.click/api/generate-pdf';
        const response = await fetch(pdfApiUrl, {
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

app.get("/inventory", async (req, res) => {
    try {
        const data = await getsheet(null, "stock");
        const searchQuery = (req.query.search || "").trim().toLowerCase();
        
        let filteredData = data;
        if (searchQuery) {
            filteredData = data.filter(item => {
                return Object.values(item).some(val =>
                    String(val).toLowerCase().includes(searchQuery)
                );
            });
        }

        res.render("inventory", {
            data: filteredData,
            search: req.query.search || ""
        });
    } catch (err) {
        console.error("Error in /inventory:", err);
        res.status(500).send("เกิดข้อผิดพลาดในการโหลดข้อมูลคลังสินค้า: " + err.message);
    }
});

app.get('/add_sale', (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    res.render('add_sale', { today });
});

app.post('/add_sale', async (req, res) => {
    try {
        const user = req.session.user;
        const { orderType, วันที่, PIC } = req.body;
        const customerDetails = req.body['ลูกค้า-ผู้ขาย'];

        // กำหนด Webhook URL ตามประเภท
        let webhookUrl = process.env.WEBHOOK_TEST_URL;
        if (orderType === 'sale' && process.env.WEBHOOK_SALES_URL) {
            webhookUrl = process.env.WEBHOOK_SALES_URL;
        }

        console.log("--- Add Sale Webhook Debug ---");
        console.log("Order Type:", orderType);
        console.log("Webhook URL:", webhookUrl);

        if (!webhookUrl) {
            console.warn("No Webhook URL defined for this order type!");
            return res.status(500).json({ 
                success: false, 
                error: "ไม่พบ Webhook URL ในระบบ (ตรวจสอบ .env)" 
            });
        }

        const payload = {
            action: 'create_order',
            orderType: orderType,
            date: วันที่,
            picName: PIC,
            picId: user ? (user['รหัสpic'] || '') : '',
            customerDetails: customerDetails,
            timestamp: new Date().toISOString()
        };
        
        console.log("Payload:", JSON.stringify(payload));

        try {
            // สร้าง URL พร้อม Query Parameters สำหรับ GET request
            const urlWithParams = new URL(webhookUrl);
            Object.keys(payload).forEach(key => {
                urlWithParams.searchParams.append(key, payload[key]);
            });

            console.log("Calling Webhook:", urlWithParams.toString());

            // Add timeout protection (10 seconds)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await fetch(urlWithParams.toString(), {
                method: 'GET',
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            console.log("Webhook Response Status:", response.status);
            
            if (response.ok) {
                return res.json({ success: true });
            } else {
                const errorText = await response.text();
                console.error("Webhook Error Response:", errorText);
                return res.status(500).json({ 
                    success: false, 
                    error: `Webhook ตอบกลับด้วยข้อผิดพลาด (${response.status}): ${errorText.substring(0, 100)}` 
                });
            }
        } catch (fetchErr) {
            console.error("n8n Webhook fetch error:", fetchErr);
            let errorMessage = `ไม่สามารถเชื่อมต่อกับ Webhook ได้: ${fetchErr.message}`;
            if (fetchErr.name === 'AbortError') {
                errorMessage = 'Webhook ตอบสนองช้าเกินไป (Timeout 10s)';
            } else if (fetchErr.code === 'ECONNREFUSED') {
                errorMessage = 'ไม่สามารถเชื่อมต่อกับ n8n ได้ (Connection Refused) ตรวจสอบว่า n8n รันอยู่หรือไม่?';
            }
            return res.status(500).json({ 
                success: false, 
                error: errorMessage 
            });
        }
    } catch (err) {
        console.error("Error in add_sale proxy:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get("/edit_sale_so", async (req, res) => {
    const idToEdit = req.query.id;
    const searchQuery = (req.query.search || "").trim().toLowerCase();

    try {
        const subSalesData = await getsheet(idToEdit, "sub_sales_so");
        const salesData = await getsheet(idToEdit, "sales_so");
        const allProductsRaw = await getsheet(null, "product");

        const saleHeaders = ["id", "วันที่", "PIC", "ลูกค้า-ผู้ขาย", "โทรศัพท์", "สถานะเอกสาร"];
        const subSaleHeaders = ["id", "สินค้า", "ชื่อสินค้า", "ข้อมูลจำเพราะ", "จำนวน", "หน่วย", "ราคาต่อหน่วย", "จำนวนเงิน", "ภาษี", "จำนวนเงินรวม"];
        const productHeaders = ["รหัส", "ชื่อ", "ชื่อจำเพราะ", "หน่วย", "ราคาขาย", "แบรนด์", "อัตราภาษีขาย"];

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

        let saleSoData = mapDataByHeaders(subSalesData, subSaleHeaders);
        let orderData = mapDataByHeaders(salesData, saleHeaders);
        let allProducts = mapDataByHeaders(allProductsRaw, productHeaders);

        if (searchQuery) {
            saleSoData = saleSoData.filter(item =>
                Object.values(item).some(val =>
                    String(val).toLowerCase().includes(searchQuery)
                )
            );
        }

        res.render("edit_sale_so", {
            data: subSalesData,
            sale_so: saleSoData,
            order: orderData,
            rawSalesData: salesData,
            allProducts: allProducts,
            search: req.query.search || "",
            idToEdit: idToEdit
        });
    } catch (err) {
        console.error("Error in /edit_sale_so:", err);
        res.status(500).send({ error: err.message });
    }
});

app.post("/api/save_changes_so", async (req, res) => {
    const { id, finalItems, orderChanges } = req.body;
    if (!id) return res.status(400).json({ error: "ต้องระบุ id" });

    try {
        const sheetName = "sub_sales_so";
        const result = await sheetsWrite.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: `${sheetName}!A1:AZ`,
        });

        const allRows = result.data.values ?? [];
        if (allRows.length > 0) {
            const headers = allRows[0];
            const idColIndex = headers.indexOf("id");

            if (idColIndex !== -1) {
                const spreadsheet = await sheetsWrite.spreadsheets.get({
                    spreadsheetId: process.env.GOOGLE_SHEET_ID,
                });
                const sheetMeta = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
                const sheetId = sheetMeta.properties.sheetId;

                const rowsToDelete = [];
                for (let i = 1; i < allRows.length; i++) {
                    if ((allRows[i][idColIndex] || "").toString().trim() === id.trim()) {
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
                    sheetCache.delete(`${sheetName}_all`);
                }
            }
        }

        if (finalItems && Array.isArray(finalItems) && finalItems.length > 0) {
            const values = finalItems.map(p => {
                const qty = parseFloat(p.quantity) || 0;
                const price = parseFloat(p['ราคาขาย']) || 0;
                const taxRateStr = (p['อัตราภาษีขาย'] || "0").toString().replace('%', '');
                const taxRate = parseFloat(taxRateStr) || 0;
                const amount = qty * price;
                const tax = amount * (taxRate / 100);
                const total = amount + tax;

                return [id, p['รหัส'] || "", p['ชื่อ'] || "", p['ชื่อจำเพราะ'] || "", qty, p['หน่วย'] || "", price, amount, tax, total];
            });

            await sheetsWrite.spreadsheets.values.append({
                spreadsheetId: process.env.GOOGLE_SHEET_ID,
                range: `${sheetName}!A:J`,
                valueInputOption: "USER_ENTERED",
                requestBody: { values }
            });
            sheetCache.delete(`${sheetName}_all`);
        }

        // Update Main Order (sales_so)
        const saleSheetName = "sales_so";
        const user = req.session.user;
        const userName = user ? (user['ชื่อภาษาอังกฤษpic'] || 'Unknown') : 'Unknown';
        const now = new Date();
        const dateStr = now.toLocaleString('th-TH', {
            timeZone: 'Asia/Bangkok',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });

        const saleResult = await sheetsWrite.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: `${saleSheetName}!A1:AZ`,
        });

        const saleRows = saleResult.data.values ?? [];
        if (saleRows.length > 0) {
            const saleHeaders = saleRows[0];
            const saleIdCol = saleHeaders.indexOf("id");
            const saleDateCol = saleHeaders.indexOf("วันที่แก้ไขล่าสุด");
            const saleEditorCol = saleHeaders.indexOf("ผู้แก้ไขล่าสุด");

            if (saleIdCol !== -1) {
                let saleRowIndex = -1;
                for (let i = 1; i < saleRows.length; i++) {
                    if ((saleRows[i][saleIdCol] || "").toString().trim() === id.trim()) {
                        saleRowIndex = i;
                        break;
                    }
                }

                if (saleRowIndex !== -1) {
                    const saleRow = [...(saleRows[saleRowIndex] || [])];
                    if (orderChanges && typeof orderChanges === 'object') {
                        for (let j = 0; j < saleHeaders.length; j++) {
                            const header = saleHeaders[j];
                            if (orderChanges.hasOwnProperty(header)) {
                                while (saleRow.length <= j) saleRow.push("");
                                saleRow[j] = orderChanges[header];
                            }
                        }
                    }
                    if (saleDateCol !== -1) {
                        while (saleRow.length <= saleDateCol) saleRow.push("");
                        saleRow[saleDateCol] = dateStr;
                    }
                    if (saleEditorCol !== -1) {
                        while (saleRow.length <= saleEditorCol) saleRow.push("");
                        saleRow[saleEditorCol] = userName;
                    }

                    await sheetsWrite.spreadsheets.values.update({
                        spreadsheetId: process.env.GOOGLE_SHEET_ID,
                        range: `${saleSheetName}!A${saleRowIndex + 1}`,
                        valueInputOption: "USER_ENTERED",
                        requestBody: { values: [saleRow] },
                    });
                    sheetCache.delete(`${saleSheetName}_all`);
                }
            }
        }

        res.json({ success: true, message: "บันทึกการเปลี่ยนแปลงทั้งหมดเรียบร้อยแล้ว" });
    } catch (err) {
        console.error("Error saving SO changes:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get("/sale_so", async (req, res) => {
    try {
        const data = await getsheet(null, "sales_so");
        const allowedHeaders = ["id", "วันที่", "PIC", "ลูกค้า-ผู้ขาย", "โทรศัพท์"];

        // รับค่าค้นหา
        const searchQuery = (req.query.search || "").trim().toLowerCase();

        // 1. กรองคอลัมน์
        let filteredData = data.map(row => {
            let obj = {};
            allowedHeaders.forEach((h) => { if (row[h]) obj[h] = row[h]; });
            return obj;
        }).filter(obj => Object.keys(obj).length > 0);

        // 2. กรองข้อมูลตามคำค้นหา
        if (searchQuery) {
            filteredData = filteredData.filter(item => {
                return Object.values(item).some(val =>
                    String(val).toLowerCase().includes(searchQuery)
                );
            });
        }

        // ส่งกลับไปที่หน้า sale_so.ejs
        res.render("sale_so", {
            data: filteredData,
            search: req.query.search || ""
        });

    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post("/api/delete_order_so", async (req, res) => {
    const idToDelete = req.query.id;
    if (!idToDelete) return res.status(400).json({ error: "ไม่พบ ID ที่ต้องการลบ" });

    try {
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;
        const spreadsheet = await sheetsWrite.spreadsheets.get({ spreadsheetId });
        const salesSoSheet = spreadsheet.data.sheets.find(s => s.properties.title === "sales_so");
        const subSalesSoSheet = spreadsheet.data.sheets.find(s => s.properties.title === "sub_sales_so");

        if (!salesSoSheet || !subSalesSoSheet) return res.status(500).json({ error: "ไม่พบ Sheet ที่ต้องการ" });

        const salesSoRes = await sheetsWrite.spreadsheets.values.get({ spreadsheetId, range: "sales_so!A:A" });
        const salesSoRows = salesSoRes.data.values || [];
        const salesSoIndex = salesSoRows.findIndex(row => (row[0] || "").toString().trim() === idToDelete.trim());

        const subSalesSoRes = await sheetsWrite.spreadsheets.values.get({ spreadsheetId, range: "sub_sales_so!A:A" });
        const subSalesSoRows = subSalesSoRes.data.values || [];
        const subSalesSoIndices = [];
        subSalesSoRows.forEach((row, index) => {
            if ((row[0] || "").toString().trim() === idToDelete.trim()) subSalesSoIndices.push(index);
        });

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
        console.error("Error deleting SO order:", error);
        res.status(500).json({ error: error.message });
    }
});

// AI Chat Routes
app.get('/ai_chat', requireLogin, (req, res) => {
    const history = req.session.chatHistory || [];
    res.render('ai_chat', { history });
});

app.post('/api/chat/clear', requireLogin, (req, res) => {
    req.session.chatHistory = [];
    res.json({ success: true });
});

app.post('/api/chat', requireLogin, async (req, res) => {
    const userMessage = req.body.message;
    if (!userMessage) return res.status(400).json({ error: 'Message is required' });

    try {
        // ดึงข้อมูลทุก Table เพื่อให้ AI มีความรู้ครบถ้วน
        const [stock, product, salesPr, subSalesPr, salesSo, subSalesSo, employees] = await Promise.all([
            getsheet(null, 'stock'),
            getsheet(null, 'product'),
            getsheet(null, 'Sale_pr'),
            getsheet(null, 'sub_sales_pr'),
            getsheet(null, 'sales_so'),
            getsheet(null, 'sub_sales_so'),
            getsheet(null, 'empolyee')
        ]);

        const contextData = {
            inventory_summary: stock.map(s => ({ รหัส: s['รหัส'], ชื่อ: s['ชื่อ'], จำนวน: s['จำนวน'], หน่วย: s['หน่วย'] })),
            product_catalog: product.map(p => ({ รหัส: p['รหัส'], ชื่อ: p['ชื่อ'], ราคา: p['ราคาขาย'], แบรนด์: p['แบรนด์'] })),
            sales_proposals: salesPr.map(s => ({ id: s['id'], วันที่: s['วันที่'], ลูกค้า: s['ลูกค้า-ผู้ขาย'], สถานะ: s['สถานะเอกสาร'] })),
            sales_orders: salesSo.map(s => ({ id: s['id'], วันที่: s['วันที่'], ลูกค้า: s['ลูกค้า-ผู้ขาย'], ยอดรวม: s['จำนวนเงินรวม'] })),
            proposal_details: subSalesPr.map(d => ({ id: d['id'], สินค้า: d['สินค้า'], จำนวน: d['จำนวน'], รวม: d['จำนวนเงินรวม'] })),
            order_details: subSalesSo.map(d => ({ id: d['id'], สินค้า: d['สินค้า'], จำนวน: d['จำนวน'], รวม: d['จำนวนเงินรวม'] })),
            team: employees.map(e => ({ ชื่อ: e['ชื่อpic'], รหัส: e['รหัสpic'], แผนก: e['แผนก'] }))
        };

        // อ่าน Prompt จากไฟล์ .txt
        let systemPrompt = "";
        try {
            const promptTemplate = fs.readFileSync(path.join(__dirname, 'ai_prompt.txt'), 'utf8');
            systemPrompt = promptTemplate.replace('{{contextData}}', JSON.stringify(contextData));
        } catch (readErr) {
            console.error("Error reading ai_prompt.txt:", readErr);
            systemPrompt = `คุณคือ "พี่ AI" ผู้ช่วยระบบ ERP พรีเมียร์\nContext: ${JSON.stringify(contextData)}`;
        }

        const geminiApiKey = process.env.GEMINI_API_KEY;
        // ใช้ gemini-flash-latest เป็นมาตรฐาน
        const modelName = "gemini-3.1-flash-lite"; 
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`;

        // จัดการประวัติการแชท
        if (!req.session.chatHistory) req.session.chatHistory = [];
        
        // จำกัดประวัติการแชทไว้ที่ 10 ข้อความล่าสุดเพื่อประหยัด Token
        const history = req.session.chatHistory.slice(-10);

        // สร้าง Contents สำหรับ Gemini (รวม System Prompt และ History)
        const contents = [
            {
                role: 'user',
                parts: [{ text: `System Instruction: ${systemPrompt}\n\nกรุณารับทราบข้อมูลและทำหน้าที่เป็นพี่ AI ตามที่ระบุ` }]
            },
            {
                role: 'model',
                parts: [{ text: "รับทราบครับน้อง พี่ AI พร้อมช่วยเหลือและให้ข้อมูลระบบ ERP พรีเมียร์ตามคำสั่งแล้วครับ มีอะไรให้พี่ช่วยเช็ค บอกมาได้เลย!" }]
            },
            ...history.map(msg => ({
                role: msg.role,
                parts: [{ text: msg.text }]
            })),
            {
                role: 'user',
                parts: [{ text: userMessage }]
            }
        ];

        console.log(`[AI] Sending request to Google Gemini API with history (${history.length} turns)`);

        const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini API returned ${response.status}: ${errorText}`);
        }

        const result = await response.json();
        
        if (result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts[0]) {
            const aiResponse = result.candidates[0].content.parts[0].text;
            
            // บันทึกประวัติลง Session
            req.session.chatHistory.push({ role: 'user', text: userMessage });
            req.session.chatHistory.push({ role: 'model', text: aiResponse });
            
            res.json({ response: aiResponse });
        } else {
            res.status(500).json({ error: 'Invalid response from Gemini API' });
        }

    } catch (err) {
        console.error("[ERROR] AI Chat error:", err.message);
        res.status(500).json({ error: `ไม่สามารถเชื่อมต่อกับ Gemini AI ได้: ${err.message}` });
    }
});

app.listen(process.env.PORT || 5000, "0.0.0.0", () =>
    console.log(`Server running on port ${process.env.PORT || 5000}`)
);