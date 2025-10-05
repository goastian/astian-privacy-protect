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

// Ensure that the Firefox manifest has the correct structure
const firefoxManifest = {
    "manifest_version": 2,
    "name": "Astian Privacy",
    "version": "2.0.5",
    "description": "Lightweight, fast, and secure ad blocker with detailed statistics and improved performance for Firefox",
    "permissions": [
        "storage",
        "tabs",
        "webRequest",
        "webRequestBlocking",
        "activeTab",
        "unlimitedStorage",
        "<all_urls>"
    ],
    "background": {
        "scripts": ["vendors.js", "background.js"],
        "persistent": true
    },
    "content_scripts": [
        {
            "matches": ["<all_urls>"],
            "js": ["content.js"],
            "run_at": "document_start"
        }
    ],
    "browser_action": {
        "default_popup": "popup.html",
        "default_title": "Astian Privacy",
        "default_icon": {
            "16": "icons/icon-16.png",
            "32": "icons/icon-32.png",
            "48": "icons/icon-48.png",
            "128": "icons/icon-128.png"
        }
    },
    "options_page": "options.html",
    "icons": {
        "16": "icons/icon-16.png",
        "32": "icons/icon-32.png",
        "48": "icons/icon-48.png",
        "128": "icons/icon-128.png"
    },
    "web_accessible_resources": [
        "styles/*"
    ],
    "applications": {
        "gecko": {
            "id": "adblock-optimizado@example.com",
            "strict_min_version": "78.0"
        }
    }
};

fs.writeFileSync(
    path.join(firefoxDir, 'manifest.json'),
    JSON.stringify(firefoxManifest, null, 2)
);

console.log('Firefox extension built successfully!');
console.log(`Output directory: ${firefoxDir}`);
