const fs = require('fs');
const path = require('path');

const viewsDir = path.join(__dirname, 'views');
const files = fs.readdirSync(viewsDir).filter(f => f.endsWith('.ejs'));

const replacement = `<%- include('partials/sidebar') %>`;

files.forEach(file => {
    const filePath = path.join(viewsDir, file);
    let content = fs.readFileSync(filePath, 'utf8');

    // Replace <aside class="sidebar">...</aside>
    // Note: since the closing tag </aside> is followed by <main> or similar, we use a regex to capture everything from <aside class="sidebar"> to </aside>
    const regex = /<aside class="sidebar">[\s\S]*?<\/aside>/;
    if (regex.test(content)) {
        content = content.replace(regex, replacement);
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated ${file}`);
    }
});
console.log('Refactoring complete.');
