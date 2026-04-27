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

// ส่ง baseUrl ไปทุก view อัตโนมัติ
app.use((req, res, next) => {
    res.locals.baseUrl = process.env.BASE_URL || '';
    next();
});
const sheets = google.sheets({
    version: "v4",
    auth: new google.auth.GoogleAuth({
        keyFile: "./striped-buckeye-485807-t7-f6b5b7ca48b8.json",
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    }),
});

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
        const salesData = await getsheet(idToEdit, "sales_pr");
        const allProductsRaw = await getsheet(null, "product");

        const saleHeaders = ["วันที่", "PIC", "ลูกค้า-ผู้ขาย", "ผู้สร้าง", "โทรศัพท์"];
        const subSaleHeaders = ["สินค้า", "ชื่อสินค้า", "จำนวน", "ราคาต่อหน่วย", "ภาษี", "จำนวนเงินรวม"];
        const productHeaders = ["รหัส", "ชื่อ", "ราคาขาย", "แบรนด์"];

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
        const data = await getsheet(null, "sales_pr");
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


app.listen(process.env.PORT || 4000, "0.0.0.0", () =>
    console.log(`Server running on port ${process.env.PORT || 4000}`)
);