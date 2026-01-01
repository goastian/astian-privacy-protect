# Astian Privacy Protect

A high-performance ad blocker compatible with Mozilla Firefox and Chromium browsers.
[Midori Privacy](https://ads.fund/token/0xadff55919304565a3e904fce983504fb2a764b76) project is supported by ADS.FUND

## 🚀 Features

### Efficient Blocking
- **99% compatibility** with Easylist and uBlock Origin filters
- Blocks ads, trackers, and unwanted content
- Automatically updated filters
- High-performance mode for better performance

### Detailed Statistics
- **Real-time block counter**
- **Data saved** (KB, MB, GB)
- **Time saved** on page loads
- **Statistics by type** (ads, trackers, social networks)
- **Performance metrics** (memory, CPU)

### Performance Optimization
- **Minimal memory consumption** (< 50MB typically)
- **Batching** to reduce CPU load
- **Smart caching** for better performance
- **Automatic cleanup** of unused resources

### Modern Interface
- **Intuitive popup** with statistics in real time
- **Options page** with advanced settings
- **Custom lists** (white/black)
- **Statistics export**

## 📦 Installation

### For Developers

1. **Clone the repository:**
```bash
git clone https://github.com/goastian/astian-privacy-protect/
cd astian-privacy-protect
```

2. **Install dependencies:**
```bash
npm install
```

3. **Compile the extension:**
```bash
# For Firefox
npm run build:firefox

# For Chromium
npm run build:chromium

# For both
npm run build:all
```

### For Users

#### Firefox
1. Download the `.xpi` file from the releases
2. Open Firefox and go to `about:addons`
3. Click the gear icon and select "Install add-on from file"
4. Select the downloaded `.xpi` file

#### Chrome/Chromium
1. Download the `.zip` file from the releases
2. Extract the file to a folder
3. Open Chrome and go to `chrome://extensions/`
4. Enable "Developer Mode"
5. Click "Upload unpackaged extension"
6. Select the extracted folder

## 🛠️ Development

### Project Structure

```
src/
├── background.ts # Main service worker
├─── content.ts # Content script for web pages
├─── popup.ts # Popup script
├─── options.ts # Options page script
├── adblocker.ts # Main adblocker logic
├── stats-manager.ts # Statistics management
├── performance-optimizer.ts # Performance optimizations
├── types.ts # TypeScript type definitions
├── manifest.json # Chromium (v3) manifest
├── manifest-firefox.json # Firefox (v2) manifest
├── popup.html # Popup interface
├── options.html # Options page
├── styles/ # CSS files
│ ├── popup.css
│ └── options.css
└── icons/ # Extension icons
├── icon-16.png
├── icon-32.png
├── icon-48.png
└── icon-128.png
```

### Available Scripts

```bash
# Development
npm run dev # Development mode with watch
npm run build # Build for production
npm run build:firefox # Build for Firefox only
npm run build:chromium # Build for Chromium only
npm run build:all # Build for both browsers

# Code Quality
npm run lint # Run ESLint
npm run test # Run tests

# Packaging
npm run package:firefox # Create .xpi for Firefox
npm run package:chromium # Create .zip for Chromium
```

## ⚙️ Configuration

### Available Options

- **Blocker Status**: Enable/Disable
- **High Performance Mode**: Performance optimizations
- **Blocking Types**: Ads, trackers, social networks
- **Refresh Interval**: Filter update frequency
- **Memory Limit**: Memory usage control
- **Custom Lists**: Custom whitelists and blacklists

### Configuration API

```typescript
// Configuration Example
const config = {
enabled: true,
blockAds: true,
blockTrackers: true,
blockSocial: false,
whitelist: ['example.com'],
blacklist: ['ads.example.com'],
updateInterval: 24, // hours
showStats: true,
performanceMode: true
};
```

## 📊 Statistics

### Available Metrics

- **Total Blocked**: Total number of blocked requests
- **Data Saved**: Amount of data saved (B, KB, MB, GB)
- **Time Saved**: Total time saved on page loads
- **Blocked by Type**: Breakdown by ads, trackers, etc.
- **Performance**: Memory and CPU usage
- **Daily Statistics**: Metrics for the current day

### Data Export

Statistics can be exported in JSON format for further analysis:

```json
{
"stats": {
"totalBlocked": 1250,
"totalDataSaved": "15.2 MB",
"totalTimeSaved": "2.5m 30s",
"blockedByType": {
"ads"
