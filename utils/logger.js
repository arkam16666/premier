const fs = require('fs');
const path = require('path');

const logFile = path.join(process.cwd(), 'logs', 'audit.json');

// Initialize log file if not exists
if (!fs.existsSync(logFile)) {
    fs.writeFileSync(logFile, JSON.stringify([]));
}

function logAction(user, action, details, ip) {
    try {
        let logs = [];
        try {
            logs = JSON.parse(fs.readFileSync(logFile, 'utf8'));
        } catch (e) {
            logs = [];
        }
        
        const newLog = {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            user: user ? (user['ชื่อภาษาอังกฤษpic'] || user['ชื่อpic'] || 'Unknown User') : 'System/Guest',
            role: user ? user.role : 'N/A',
            action: action,
            details: details,
            ip: ip || 'Unknown'
        };
        
        logs.unshift(newLog); // Add to beginning (newest first)
        
        // Keep only last 1000 logs to prevent file bloat
        if (logs.length > 1000) {
            logs.length = 1000;
        }
        
        fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
    } catch (err) {
        console.error("Failed to write audit log:", err);
    }
}

function getLogs() {
    try {
        return JSON.parse(fs.readFileSync(logFile, 'utf8'));
    } catch (err) {
        return [];
    }
}

module.exports = { logAction, getLogs };
