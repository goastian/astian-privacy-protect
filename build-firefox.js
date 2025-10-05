const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Building Firefox extension...');

// Create build directory for Firefox
const firefoxDir = path.join(__dirname, 'dist-firefox');
if (!fs.existsSync(firefoxDir)) {
    fs.mkdirSync(firefoxDir, { recursive: true });
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
    const destPath = path.join(firefoxDir, path.basename(file));

    if (fs.existsSync(srcPath)) {
        if (fs.statSync(srcPath).isDirectory()) {
            execSync(`cp -r "${srcPath}" "${destPath}"`);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
        console.log(`Copied: ${file}`);
    }
});

// Copy manifest specific to Firefox
fs.copyFileSync(
    path.join(__dirname, 'src/manifest-firefox.json'),
    path.join(firefoxDir, 'manifest.json')
);

console.log('Firefox extension built successfully!');
console.log(`Output directory: ${firefoxDir}`);
