document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;
    let iconUrl = '';

    // Create SVG data URIs for different pages based on their primary theme color/icon
    const createSvgIcon = (pathData, color1, color2) => {
        return 'data:image/svg+xml;utf8,' + encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
            <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="${color1}" />
                    <stop offset="100%" stop-color="${color2}" />
                </linearGradient>
            </defs>
            <path fill="url(#grad)" d="${pathData}"/>
        </svg>`);
    };

    // Define icons for different routes
    // Default (Building/ERP)
    let dPath = "M320 32H192c-17.7 0-32 14.3-32 32v416h192V64c0-17.7-14.3-32-32-32zm-64 352h-32v-32h32v32zm0-64h-32v-32h32v32zm0-64h-32v-32h32v32zm0-64h-32v-32h32v32zm160-32h-64v288h64c17.7 0 32-14.3 32-32V160c0-17.7-14.3-32-32-32zm-32 192h-32v-32h32v32zm0-64h-32v-32h32v32zM96 128H32c-17.7 0-32 14.3-32 32v288c0 17.7 14.3 32 32 32h64V128zm-32 192H32v-32h32v32zm0-64H32v-32h32v32z";
    let c1 = "#ff7eb3", c2 = "#a786ff"; // Default Pink/Purple

    if (path.includes('sale')) {
        // Sale Icon (Invoice Dollar)
        dPath = "M64 32C28.7 32 0 60.7 0 96v320c0 35.3 28.7 64 64 64h288c35.3 0 64-28.7 64-64V160H256c-17.7 0-32-14.3-32-32V32H64zm192 0v128h128L256 32z M216 264h-40v-16c0-8.8-7.2-16-16-16s-16 7.2-16 16v16h-16c-17.7 0-32 14.3-32 32s14.3 32 32 32h40v16c0 8.8 7.2 16 16 16s16-7.2 16-16v-16h16c17.7 0 32-14.3 32-32s-14.3-32-32-32z";
        c1 = "#ff7eb3"; c2 = "#ff7eb3"; // Pink
    } else if (path.includes('po') || path.includes('purchase') || path.includes('precher')) {
        // Purchase Icon (Shopping Cart)
        dPath = "M0 24C0 10.7 10.7 0 24 0H69.5c22 0 41.5 12.8 50.6 32h411c26.3 0 45.5 25 38.6 50.4l-41 152.3c-8.5 31.4-37 53.3-69.5 53.3H170.7l5.4 28.5c2.2 11.3 12.1 19.5 23.6 19.5H488c13.3 0 24 10.7 24 24s-10.7 24-24 24H199.7c-34.6 0-64.3-24.6-70.7-58.5L77.4 54.5c-.7-3.8-4-6.5-7.9-6.5H24C10.7 48 0 37.3 0 24zM128 464a48 48 0 1 1 96 0 48 48 0 1 1 -96 0zm336-48a48 48 0 1 1 0 96 48 48 0 1 1 0-96z";
        c1 = "#a786ff"; c2 = "#a786ff"; // Purple
    } else if (path.includes('inventory')) {
        // Inventory Icon (Boxes)
        dPath = "M448 344v112a23.9 23.9 0 0 1-24 24H312c-13.3 0-24-10.7-24-24V344H448zm-160 0v112a23.9 23.9 0 0 1-24 24H128c-13.3 0-24-10.7-24-24V344h160zM288 32H128c-13.3 0-24 10.7-24 24v112h160V32zm160 0H312v112h160V56a23.9 23.9 0 0 0-24-24z";
        c1 = "#4a90e2"; c2 = "#00d2ff"; // Blue
    } else if (path.includes('ai_chat')) {
        // AI Icon (Robot/Brain)
        dPath = "M256 0c-53 0-96 43-96 96v16h192V96c0-53-43-96-96-96zm-96 144H64c-35.3 0-64 28.7-64 64v128c0 35.3 28.7 64 64 64h384c35.3 0 64-28.7 64-64V208c0-35.3-28.7-64-64-64h-96V144zM64 208h384v128H64V208zm104 32a24 24 0 1 1 0 48 24 24 0 1 1 0-48zm176 0a24 24 0 1 1 0 48 24 24 0 1 1 0-48z";
        c1 = "#00f2fe"; c2 = "#4facfe"; // Cyan
    }

    iconUrl = createSvgIcon(dPath, c1, c2);

    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
    }
    link.href = iconUrl;
});