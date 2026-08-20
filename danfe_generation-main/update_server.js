const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'server.js');
let content = fs.readFileSync(filePath, 'utf8');

const marker = 'function generateBarcode(text) {';
const index = content.lastIndexOf(marker);

if (index === -1) {
    console.error('Marker not found!');
    process.exit(1);
}

const newImplementation = `async function generateBarcode(text) {
    if (!text) return "";
    try {
        const png = await bwipjs.toBuffer({
            bcid: 'code128',       // Barcode type
            text: text,            // Text to encode
            scale: 3,              // 3x scaling factor
            height: 10,            // Bar height, in millimeters
            includetext: false,    // Show human-readable text
            textxalign: 'center',  // Always good to set this
        });
        return '<img style="width: 100%; max-height: 13mm;" src="data:image/png;base64,' + png.toString('base64') + '" />';
    } catch (e) {
        console.error("Erro ao gerar barcode:", e);
        return ""; // Fallback sem barcode
    }
}
`;

// Keep everything before the marker, append new implementation
const newContent = content.substring(0, index) + newImplementation;
fs.writeFileSync(filePath, newContent);
console.log('server.js updated successfully');
