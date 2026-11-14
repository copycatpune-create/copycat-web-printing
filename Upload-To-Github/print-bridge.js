/**
 * Copycat Copiers - Local Windows Print Bridge
 * -------------------------------------------
 * Connects your physical shop Windows printers (Canon - C5560, ADVANCE 6575, etc.)
 * directly to the free Cloud-Hosted Web App (Render / Railway / Vercel).
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const printerService = require('./src/printer-service');

const CONFIG_FILE = path.join(__dirname, 'bridge-config.json');
const DOWNLOADS_DIR = path.join(__dirname, 'print_jobs', 'bridge_downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

function loadConfig() {
  let config = {
    serverUrl: 'http://localhost:3005',
    bridgeToken: 'copycat_bridge_key_2026'
  };

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const fileData = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      config = { ...config, ...fileData };
    } catch (e) {}
  } else {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  }

  if (process.env.SERVER_URL) config.serverUrl = process.env.SERVER_URL;
  if (process.env.BRIDGE_TOKEN) config.bridgeToken = process.env.BRIDGE_TOKEN;

  // Clean trailing slash
  config.serverUrl = config.serverUrl.replace(/\/+$/, '');
  return config;
}

const config = loadConfig();
let wsClient = null;
let pollTimer = null;
const processingJobs = new Set();

// Helper: Make HTTP/HTTPS requests
function apiRequest(endpoint, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${config.serverUrl}${endpoint}`);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const payload = data ? JSON.stringify(data) : null;
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'x-bridge-token': config.bridgeToken,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };

    const req = client.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Helper: Download document file from Cloud Server
function downloadFile(filename, destination) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${config.serverUrl}/api/bridge/download/${encodeURIComponent(filename)}`);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const fileStream = fs.createWriteStream(destination);
    const req = client.get(url, { headers: { 'x-bridge-token': config.bridgeToken } }, (res) => {
      if (res.statusCode !== 200) {
        fileStream.close();
        fs.unlinkSync(destination);
        return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
      }
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve(destination);
      });
    });

    req.on('error', err => {
      fileStream.close();
      if (fs.existsSync(destination)) fs.unlinkSync(destination);
      reject(err);
    });
  });
}

// Step 1: Scan and register physical Windows printers with Cloud Server
async function syncPrintersWithCloud() {
  try {
    const printerData = await printerService.listPrinters();
    console.log(`[PrintBridge] Detected ${printerData.printers.length} local Windows printers.`);
    const res = await apiRequest('/api/bridge/register-printers', 'POST', printerData);
    if (res.status === 200) {
      console.log(`[PrintBridge] ✓ Successfully registered physical printers with Cloud Server: ${config.serverUrl}`);
    } else {
      console.warn(`[PrintBridge] Warning registering printers (${res.status}):`, res.data || res.raw);
    }
  } catch (err) {
    console.warn(`[PrintBridge] Could not sync printers to cloud: ${err.message}`);
  }
}

// Step 2: Process a Print Job locally
async function processOrderPrint(order, printerOverrides = {}) {
  if (!order || !order.id) return;
  if (processingJobs.has(order.id)) return;
  processingJobs.add(order.id);

  console.log(`\n======================================================`);
  console.log(`  🖨️ [PrintBridge] NEW PRINT JOB RECEIVED: #${order.id}`);
  console.log(`  Customer: ${order.customer?.name} (${order.customer?.phone})`);
  console.log(`  Documents: ${order.documents?.length || 0}`);
  console.log(`======================================================`);

  try {
    const printResults = [];
    const settingsRes = await apiRequest('/api/settings');
    const settings = settingsRes.data || {};
    const defaultPrinters = settings.printers || { defaultBw: 'ADVANCE 6575', defaultColor: 'Canon - C5560' };

    for (let i = 0; i < order.documents.length; i++) {
      const doc = order.documents[i];
      const filename = path.basename(doc.filePath);
      const localDest = path.join(DOWNLOADS_DIR, `${order.id}_doc${i + 1}_${filename}`);

      console.log(`[PrintBridge] Downloading Doc ${i + 1}/${order.documents.length}: "${doc.originalName}"...`);
      await downloadFile(filename, localDest);

      // Point doc filePath to the locally downloaded file
      const localDoc = { ...doc, filePath: localDest };

      // Determine target printer
      let targetPrinter = (printerOverrides && printerOverrides[doc.id]) || doc.assignedPrinter;
      if (!targetPrinter) {
        targetPrinter = doc.colorMode === 'color' ? defaultPrinters.defaultColor : defaultPrinters.defaultBw;
      }

      console.log(`[PrintBridge] Preparing and spooling to Windows printer "${targetPrinter}"...`);
      const prep = await printerService.preparePrintJobFile(localDoc, order.id, i + 1);

      await printerService.printDocument(prep.outputPath, {
        printerName: targetPrinter,
        copies: doc.copies || 1,
        paperSize: doc.paperType || 'A4',
        isDuplex: doc.sides === 'duplex',
        isColor: doc.colorMode === 'color',
        pagesSetting: prep.pagesSetting || null
      });

      console.log(`[PrintBridge] ✓ Successfully spooled "${doc.originalName}" (${prep.pageCount} pages) to ${targetPrinter}!`);

      printResults.push({
        docId: doc.id,
        originalName: doc.originalName,
        printer: targetPrinter,
        paperType: doc.paperType,
        colorMode: doc.colorMode,
        sides: doc.sides,
        copies: doc.copies,
        pagesPrinted: prep.pageCount,
        timestamp: new Date().toISOString(),
        success: true
      });
    }

    // Report completion to Cloud Server
    await apiRequest(`/api/bridge/orders/${order.id}/complete`, 'POST', {
      printResults,
      note: `All ${order.documents.length} document(s) printed on physical shop machine. Ready for pickup!`
    });

    console.log(`[PrintBridge] ✓ Order #${order.id} COMPLETED and confirmed to Cloud Server!\n`);
  } catch (err) {
    console.error(`[PrintBridge] ❌ Error printing Order #${order.id}:`, err.message);
    try {
      await apiRequest(`/api/bridge/orders/${order.id}/error`, 'POST', { error: err.message });
    } catch (e) {}
  } finally {
    processingJobs.delete(order.id);
  }
}

// Step 3: Polling Fallback (every 10 seconds)
async function pollPendingJobs() {
  try {
    const res = await apiRequest('/api/bridge/pending-jobs');
    if (res.status === 200 && res.data?.jobs) {
      for (const job of res.data.jobs) {
        if (!processingJobs.has(job.id)) {
          processOrderPrint(job);
        }
      }
    }
  } catch (e) {}
}

// Step 4: WebSocket Real-Time Push Connection
function connectWebSocket() {
  const wsUrl = config.serverUrl.replace(/^http/, 'ws');
  console.log(`[PrintBridge] Connecting real-time live channel to ${wsUrl}...`);

  try {
    wsClient = new WebSocket(wsUrl);

    wsClient.on('open', () => {
      console.log('[PrintBridge] ✓ Live WebSocket channel CONNECTED to Cloud Server!');
      wsClient.send(JSON.stringify({ action: 'join', room: 'print_bridge' }));
      syncPrintersWithCloud();
    });

    wsClient.on('message', (msgStr) => {
      try {
        const msg = JSON.parse(msgStr);
        if (msg.event === 'DISPATCH_PRINT_JOB') {
          const { order, printerOverrides } = msg.payload || {};
          if (order) processOrderPrint(order, printerOverrides);
        }
      } catch (e) {}
    });

    wsClient.on('close', () => {
      console.log('[PrintBridge] Connection lost. Reconnecting in 5 seconds...');
      setTimeout(connectWebSocket, 5000);
    });

    wsClient.on('error', (err) => {
      console.warn('[PrintBridge] Connection notice:', err.message);
    });
  } catch (err) {
    setTimeout(connectWebSocket, 5000);
  }
}

// Startup
console.log('========================================================');
console.log('   COPYCAT COPIERS - LOCAL WINDOWS PRINT BRIDGE        ');
console.log('========================================================');
console.log(`Cloud Server URL: ${config.serverUrl}`);
console.log(`Config File:      ${CONFIG_FILE}`);
console.log('========================================================');

syncPrintersWithCloud();
connectWebSocket();
pollTimer = setInterval(pollPendingJobs, 10000);
