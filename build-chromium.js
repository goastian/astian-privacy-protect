const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Building Chromium extension...');

// Create build directory for Chromium
const chromiumDir = path.join(__dirname, 'dist-chromium');
if (!fs.existsSync(chromiumDir)) {
    fs.mkdirSync(chromiumDir, { recursive: true });
}

// Copy necessary files
const filesToCopy = [
    'dist/background.js',
    'dist/content.js',
    'dist/popup.js',
    'dist/options.js',
    'dist/vendors.js',
    'src/popup.html',
    'src/options.html',
    'src/styles',
    'src/icons'
];

filesToCopy.forEach(file => {
    const srcPath = path.join(__dirname, file);
    const destPath = path.join(chromiumDir, path.basename(file));

    if (fs.existsSync(srcPath)) {
        if (fs.statSync(srcPath).isDirectory()) {
            execSync(`cp -r "${srcPath}" "${destPath}"`);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
        console.log(`Copied: ${file}`);
    }
});

// Copy manifest specific to Chromium
fs.copyFileSync(
    path.join(__dirname, 'src/manifest-chromium.json'),
    path.join(chromiumDir, 'manifest.json')
);

console.log('Chromium extension built successfully!');
console.log(`Output directory: ${chromiumDir}`);
