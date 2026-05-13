require('dotenv').config();

async function listModels() {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiApiKey}`;

    console.log('Listing Gemini models...');
    try {
        const response = await fetch(url);
        const data = await response.json();
        console.log(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Error:', err.message);
    }
}

listModels();
