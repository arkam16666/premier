const express = require('express');
const crypto = require('crypto');

// เก็บ Token ไว้ใน Memory (สามารถเปลี่ยนเป็น Database จริงได้ในอนาคต)
const tokenStore = new Map();

module.exports = (dependencies) => {
    const router = express.Router();
    const { getsheet } = dependencies;

    /**
     * API สำหรับสร้าง Temporary Token
     * Request body: { linetoken, targetUrl }
     */
    router.post('/api/generate-edit-token', async (req, res) => {
        const { linetoken, targetUrl } = req.body;
        const apiKey = req.headers['x-api-key'];

        // ตรวจสอบ API Key เพื่อความปลอดภัย (ตั้งค่าใน .env: INTERNAL_API_KEY)
        if (process.env.INTERNAL_API_KEY && apiKey !== process.env.INTERNAL_API_KEY) {
            return res.status(401).json({ success: false, error: 'Unauthorized: Invalid API Key' });
        }

        if (!linetoken || !targetUrl) {
            return res.status(400).json({ success: false, error: 'Missing linetoken or targetUrl' });
        }

        try {
            // ค้นหาพนักงานจาก linetoken
            const employees = await getsheet(null, 'empolyee');
            const user = employees.find(e => e['linetoken'] === linetoken);

            if (!user) {
                return res.status(404).json({ success: false, error: 'User not found with provided linetoken' });
            }

            // สร้าง Token แบบสุ่ม
            const token = crypto.randomBytes(32).toString('hex');
            const expires = Date.now() + (10 * 60 * 1000); // หมดอายุใน 10 นาที

            // เก็บข้อมูลลง Store
            tokenStore.set(token, {
                user: user,
                targetUrl: targetUrl,
                expires: expires
            });

            // สร้าง Full Link
            const baseUrl = res.locals.baseUrl || process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
            const loginLink = `${baseUrl}/auth/token/${token}`;

            res.json({
                success: true,
                token: token,
                loginLink: loginLink,
                expiresIn: '10 minutes'
            });

        } catch (err) {
            console.error('[TOKEN GEN ERROR]:', err);
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    });

    /**
     * Route สำหรับคลิกลิงก์เพื่อ Login และ Redirect
     */
    router.get('/auth/token/:token', async (req, res) => {
        const { token } = req.params;
        const tokenData = tokenStore.get(token);

        if (!tokenData) {
            return res.render('auth_token', { 
                status: 'error', 
                message: 'Token ไม่ถูกต้อง หรืออาจถูกใช้งานไปแล้ว' 
            });
        }

        if (Date.now() > tokenData.expires) {
            tokenStore.delete(token);
            return res.render('auth_token', { 
                status: 'error', 
                message: 'ลิงก์หมดอายุการใช้งานแล้ว (เกิน 10 นาที)' 
            });
        }

        // ล็อกอินสำเร็จ: ตั้งค่า Session
        req.session.user = tokenData.user;
        const targetUrl = tokenData.targetUrl;

        // ลบ Token ทิ้งหลังใช้งาน (One-time use)
        tokenStore.delete(token);

        console.log(`[TOKEN LOGIN] User: ${tokenData.user['ชื่อภาษาอังกฤษpic']} accessed via token. Preparing redirect to: ${targetUrl}`);
        
        // Render หน้า Loading สวยๆ ก่อน Redirect (Redirect จะทำผ่าน Client-side JS ใน EJS)
        res.render('auth_token', { 
            status: 'success', 
            targetUrl: targetUrl 
        });
    });

    // Cleanup Loop: ลบ Token ที่หมดอายุทิ้งทุกๆ 5 นาที
    setInterval(() => {
        const now = Date.now();
        for (const [token, data] of tokenStore.entries()) {
            if (now > data.expires) {
                tokenStore.delete(token);
            }
        }
    }, 5 * 60 * 1000);

    return router;
};
