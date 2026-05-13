require('dotenv').config();

async function testGemini() {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    // Using v1beta and gemini-flash-latest
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${geminiApiKey}`;

    console.log('Testing Gemini API (v1beta - flash-latest)...');
    try {
        const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: 'Hello, are you there?'
                    }]
                }]
            })
        });

        console.log('Status:', response.status);
        const data = await response.json();
        console.log('Response:', JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Error:', err.message);
    }
}

testGemini();
