const express = require('express');

module.exports = (dependencies) => {
    const router = express.Router();
    const { getsheet } = dependencies;

    router.get('/', async (req, res) => {
        try {
            const salesPr = await getsheet(null, 'Sale_pr');
            const salesSo = await getsheet(null, 'sales_so');
            const subSalesSo = await getsheet(null, 'sub_sales_so');
            const precherPo = await getsheet(null, 'precher_po');
            const subPrecherPo = await getsheet(null, 'sub_precher_po');
            const stock = await getsheet(null, 'stock');

            // 1. คำนวณยอดขายรวม
            let totalRevenue = 0;
            subSalesSo.forEach(row => {
                const total = parseFloat(String(row['จำนวนเงินรวม'] || 0).replace(/,/g, ''));
                if (!isNaN(total)) totalRevenue += total;
            });

            // คำนวณยอดซื้อรวม
            let totalPurchase = 0;
            subPrecherPo.forEach(row => {
                const total = parseFloat(String(row['จำนวนเงินรวม'] || 0).replace(/,/g, ''));
                if (!isNaN(total)) totalPurchase += total;
            });

            // 2. ข้อมูลสำหรับกราฟเส้น
            const monthNamesFull = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
            const rollingLabels = [];
            const rollingSales = Array(13).fill(0);
            const rollingPurchases = Array(13).fill(0);
            
            const now = new Date();
            const currentMonth = now.getMonth();
            const currentYear = now.getFullYear();

            for (let i = 12; i >= 0; i--) {
                let m = currentMonth - i;
                let y = currentYear;
                if (m < 0) { m += 12; y -= 1; }
                rollingLabels.push(`${monthNamesFull[m]} ${y + 543}`);
            }

            const getRollingIndex = (dateStr) => {
                if (!dateStr) return -1;
                const parts = dateStr.split('/');
                if (parts.length < 3) return -1;
                const m = parseInt(parts[1]) - 1;
                let y = parseInt(parts[2]);
                if (y > 2500) y -= 543;
                const date = new Date(y, m, 1);
                const monthsDiff = (currentYear - date.getFullYear()) * 12 + (currentMonth - date.getMonth());
                if (monthsDiff >= 0 && monthsDiff <= 12) return 12 - monthsDiff;
                return -1;
            };

            const salesDateMap = {};
            salesSo.forEach(row => { if (row['id'] && row['วันที่']) salesDateMap[row['id']] = row['วันที่']; });
            const purchaseDateMap = {};
            precherPo.forEach(row => { if (row['id'] && row['วันที่']) purchaseDateMap[row['id']] = row['วันที่']; });

            subSalesSo.forEach(row => {
                const dateStr = salesDateMap[row['id']];
                const idx = getRollingIndex(dateStr);
                if (idx !== -1) {
                    const total = parseFloat(String(row['จำนวนเงินรวม'] || 0).replace(/,/g, ''));
                    if (!isNaN(total)) rollingSales[idx] += total;
                }
            });

            subPrecherPo.forEach(row => {
                const dateStr = purchaseDateMap[row['id']];
                const idx = getRollingIndex(dateStr);
                if (idx !== -1) {
                    const total = parseFloat(String(row['จำนวนเงินรวม'] || 0).replace(/,/g, ''));
                    if (!isNaN(total)) rollingPurchases[idx] += total;
                }
            });

            const statusCounts = {
                'confirmed': salesPr.filter(r => ['สำเร็จ', 'ยืนยันแล้ว'].includes((r['สถานะเอกสาร'] || '').trim())).length,
                'pending': salesPr.filter(r => !['สำเร็จ', 'ยืนยันแล้ว'].includes((r['สถานะเอกสาร'] || '').trim())).length
            };

            res.render('index', {
                title: 'Dashboard',
                stats: {
                    totalRevenue: totalRevenue.toLocaleString(),
                    pendingOrders: statusCounts.pending,
                    totalPurchase: totalPurchase.toLocaleString(),
                    totalProducts: stock.length
                },
                chartData: {
                    labels: rollingLabels,
                    sales: rollingSales,
                    purchases: rollingPurchases,
                    comparison: [totalRevenue, totalPurchase],
                    status: [statusCounts.confirmed, statusCounts.pending]
                },
                recentSales: salesPr.slice(-5).reverse()
            });
        } catch (err) {
            console.error("Dashboard error:", err);
            res.render('index', {
                title: 'Dashboard',
                stats: { totalRevenue: 0, pendingOrders: 0, totalPurchase: 0, totalProducts: 0 },
                chartData: { labels: [], sales: [], purchases: [], comparison: [0, 0], status: [0, 0] },
                recentSales: []
            });
        }
    });

    return router;
};
