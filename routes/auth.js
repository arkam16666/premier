const express = require('express');

module.exports = (dependencies) => {
    const router = express.Router();
    const { getsheet, logAction } = dependencies;

    // Login Routes
    router.get('/login', (req, res) => {
        if (req.session && req.session.user) return res.redirect('/');
        res.render('login', { error: null });
    });

    router.post('/login', async (req, res) => {
        const { username, password } = req.body;
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        try {
            const employees = await getsheet(null, 'empolyee');
            const user = employees.find(e => e['ชื่อภาษาอังกฤษpic'] === username && e['password'] === password);
            
            if (user) {
                // Assign role based on department
                const dept = (user['แผนก'] || '').toString().trim().toLowerCase();
                if (dept === 'admin') user.role = 'admin';
                else if (dept.includes('sales')) user.role = 'sales';
                else if (dept.includes('procurement')) user.role = 'procurement';
                else user.role = 'user';

                req.session.user = user;
                if (logAction) logAction(user, 'Login Success', `Logged in from IP: ${ip}`, ip);
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

    router.get('/logout', (req, res) => {
        req.session.destroy();
        res.redirect('/login');
    });

    return router;
};
