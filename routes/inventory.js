const express = require('express');

module.exports = (dependencies) => {
    const router = express.Router();
    const { getsheet } = dependencies;

    router.get("/inventory", async (req, res) => {
        try {
            // ดึงข้อมูลจากทั้ง product (ข้อมูลหลัก) และ stock (จำนวน)
            const [products, stock] = await Promise.all([
                getsheet(null, "product"),
                getsheet(null, "stock")
            ]);

            const searchQuery = (req.query.search || "").trim().toLowerCase();
            
            // สร้าง Map ของสต็อกสินค้าเพื่อความรวดเร็ว
            const stockMap = {};
            stock.forEach(item => {
                if (item['รหัส']) stockMap[item['รหัส']] = item['จำนวน'];
            });

            // รวมข้อมูลสินค้าและจำนวนสต็อก
            let combinedData = products.map(p => ({
                ...p,
                'จำนวน': stockMap[p['รหัส']] || "0"
            }));

            if (searchQuery) {
                combinedData = combinedData.filter(item => {
                    return Object.values(item).some(val =>
                        String(val).toLowerCase().includes(searchQuery)
                    );
                });
            }

            res.render("inventory", {
                data: combinedData,
                search: req.query.search || ""
            });
        } catch (err) {
            console.error("Error in /inventory:", err);
            res.status(500).send("เกิดข้อผิดพลาดในการโหลดข้อมูลคลังสินค้า: " + err.message);
        }
    });

    router.post("/api/update_product", async (req, res) => {
        const { id, updatedData } = req.body;
        if (!id || !updatedData) return res.status(400).json({ error: "ต้องระบุ id และข้อมูลที่ต้องการอัปเดต" });

        try {
            const sheetName = "product";
            const result = await dependencies.sheetsWrite.spreadsheets.values.get({
                spreadsheetId: process.env.GOOGLE_SHEET_ID,
                range: `${sheetName}!A1:AZ`,
            });

            const allRows = result.data.values ?? [];
            if (allRows.length === 0) return res.status(404).json({ error: "ไม่พบข้อมูลใน Sheet" });

            const headers = allRows[0];
            const idColIndex = headers.indexOf("รหัส");
            if (idColIndex === -1) return res.status(500).json({ error: "ไม่พบคอลัมน์ รหัส" });

            let rowIndex = -1;
            for (let i = 1; i < allRows.length; i++) {
                if ((allRows[i][idColIndex] || "").toString().trim() === id.trim()) {
                    rowIndex = i;
                    break;
                }
            }

            if (rowIndex === -1) return res.status(404).json({ error: "ไม่พบข้อมูลสินค้านี้" });

            const currentRow = allRows[rowIndex];
            const newRow = headers.map((header, j) => {
                if (updatedData.hasOwnProperty(header)) {
                    return updatedData[header];
                }
                return currentRow[j] !== undefined ? currentRow[j] : "";
            });

            await dependencies.sheetsWrite.spreadsheets.values.update({
                spreadsheetId: process.env.GOOGLE_SHEET_ID,
                range: `${sheetName}!A${rowIndex + 1}`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [newRow],
                },
            });

            // ล้าง Cache สินค้า
            dependencies.sheetCache.delete("product_all");

            res.json({ success: true, message: "อัปเดตข้อมูลสินค้าสำเร็จ" });
        } catch (err) {
            console.error("Error updating product:", err);
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
