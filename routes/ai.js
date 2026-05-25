const express = require('express');

module.exports = (dependencies) => {
    const router = express.Router();
    const { getsheet, fs, path, process } = dependencies;

    router.get('/ai_chat', (req, res) => {
        const history = req.session.chatHistory || [];
        res.render('ai_chat', { history });
    });

    router.post('/api/chat/clear', (req, res) => {
        req.session.chatHistory = [];
        res.json({ success: true });
    });

    router.get('/api/models', async (req, res) => {
        try {
            const geminiModels = [
                { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash (Default)' },
                { id: 'gemini-1.5-pro-latest', name: 'Gemini 1.5 Pro' }
            ];

            let ollamaModels = [];
            try {
                const ollamaRes = await fetch('http://127.0.0.1:11434/api/tags');
                if (ollamaRes.ok) {
                    const data = await ollamaRes.json();
                    ollamaModels = data.models.map(m => ({
                        id: `ollama:${m.name}`,
                        name: `Ollama: ${m.name}`
                    }));
                }
            } catch (err) {
                console.warn("[AI] Ollama not available");
            }

            res.json({ gemini: geminiModels, ollama: ollamaModels });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post('/api/chat', async (req, res) => {
        const userMessage = req.body.message;
        if (!userMessage) return res.status(400).json({ error: 'Message is required' });

        try {
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
                team: employees.map(e => ({ ชื่อ: e['ชื่อpic'], รหัส: e['รหัสpic'] }))
            };

            let systemPrompt = "";
            try {
                const promptTemplate = fs.readFileSync(path.join(process.cwd(), 'ai_prompt.txt'), 'utf8');
                systemPrompt = promptTemplate.replace('{{contextData}}', JSON.stringify(contextData));
            } catch (readErr) {
                systemPrompt = `คุณคือ "พี่ AI" ผู้ช่วยระบบ ERP พรีเมียร์\nContext: ${JSON.stringify(contextData)}`;
            }

            const requestedModel = req.body.model || "gemini-3.1-flash-lite";
            if (!req.session.chatHistory) req.session.chatHistory = [];
            const history = req.session.chatHistory.slice(-10);

            let aiResponse = "";
            if (requestedModel.startsWith('ollama:')) {
                const ollamaModel = requestedModel.replace('ollama:', '');
                const response = await fetch("http://127.0.0.1:11434/api/chat", {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: ollamaModel,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            ...history.map(msg => ({ role: msg.role === 'model' ? 'assistant' : 'user', content: msg.text })),
                            { role: 'user', content: userMessage }
                        ],
                        stream: false
                    })
                });
                const result = await response.json();
                aiResponse = result.message.content;
            } else {
                const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:generateContent?key=${process.env.GEMINI_API_KEY}`;
                const contents = [
                    { role: 'user', parts: [{ text: `System Instruction: ${systemPrompt}\n\nกรุณารับทราบข้อมูล` }] },
                    { role: 'model', parts: [{ text: "รับทราบครับ!" }] },
                    ...history.map(msg => ({ role: msg.role, parts: [{ text: msg.text }] })),
                    { role: 'user', parts: [{ text: userMessage }] }
                ];
                const response = await fetch(geminiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents })
                });
                const result = await response.json();
                aiResponse = result.candidates[0].content.parts[0].text;
            }

            req.session.chatHistory.push({ role: 'user', text: userMessage });
            req.session.chatHistory.push({ role: 'model', text: aiResponse });
            res.json({ response: aiResponse });
        } catch (err) {
            res.status(500).json({ error: `AI Error: ${err.message}` });
        }
    });

    return router;
};
