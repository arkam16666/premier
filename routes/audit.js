const express = require('express');

module.exports = (dependencies) => {
    const router = express.Router();
    const { getLogs } = dependencies;

    // Audit Log Route (Admin Only)
    router.get('/audit', (req, res) => {
        // Protect route
        if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
            return res.status(403).send('<h2>403 Forbidden</h2><p>คุณไม่มีสิทธิ์เข้าถึงหน้านี้ (Admin Only)</p><a href="/">กลับหน้าแรก</a>');
        }

        const logs = getLogs();
        res.render('audit_log', { 
            logs: logs,
            user: req.session.user
        });
    });

    return router;
};
