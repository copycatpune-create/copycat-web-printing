const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const BRIDGE_PRINTERS_FILE = path.join(DATA_DIR, 'bridge-printers.json');

const DEFAULT_RATES = {
  A4: {
    bw: {
      single: 2.0,   // ₹2 per page
      duplex: 3.0    // ₹3 per sheet (2 pages front & back)
    },
    color: {
      single: 10.0,  // ₹10 per page
      duplex: 18.0   // ₹18 per sheet (2 pages front & back)
    }
  },
  A3: {
    bw: {
      single: 5.0,   // ₹5 per page
      duplex: 8.0    // ₹8 per sheet
    },
    color: {
      single: 25.0,  // ₹25 per page
      duplex: 45.0   // ₹45 per sheet
    }
  }
};

const DEFAULT_SETTINGS = {
  shop: {
    name: "Copycat Copiers",
    tagline: "Instant Self-Service Web & Mobile Printing",
    upiId: "paytm.s45iush@pty",
    phone: "+91 98200 12345",
    address: "Copycat Copiers, Main Market Counter 1",
    googleRating: "4.9 ★★★★★ (250+ reviews)"
  },
  admin: {
    username: "Admin",
    password: "Copycat@55"
  },
  printers: {
    defaultBw: "ADVANCE 6575",
    defaultColor: "Canon - C5560"
  },
  rates: DEFAULT_RATES
};

const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

function verifyAdminCredentials(username, password) {
  const settings = getSettingsRaw();
  const configuredUser = (settings.admin?.username || DEFAULT_SETTINGS.admin.username).trim().toLowerCase();
  const configuredPass = settings.admin?.password || DEFAULT_SETTINGS.admin.password;

  const validUser = (username || '').trim().toLowerCase() === configuredUser;
  const validPass = password === configuredPass;

  return validUser && validPass;
}

function getActiveSessions() {
  ensureInitialized();
  if (!fs.existsSync(SESSIONS_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
    return JSON.parse(raw) || [];
  } catch (e) {
    return [];
  }
}

function saveActiveSessions(sessions) {
  ensureInitialized();
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
}

function createAdminSession() {
  const token = 'cat_adm_' + uuidv4().replace(/-/g, '');
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const sessions = getActiveSessions().filter(s => (Date.now() - (s.createdAt || 0)) < thirtyDays);
  sessions.push({ token, createdAt: Date.now() });
  saveActiveSessions(sessions);
  return token;
}

function isValidAdminSession(token) {
  if (!token || typeof token !== 'string') return false;
  const sessions = getActiveSessions();
  const session = sessions.find(s => s.token === token);
  if (!session) return false;
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const isExpired = (Date.now() - (session.createdAt || 0)) > thirtyDays;
  if (isExpired) {
    deleteAdminSession(token);
    return false;
  }
  return true;
}

function deleteAdminSession(token) {
  if (!token) return;
  const sessions = getActiveSessions().filter(s => s.token !== token);
  saveActiveSessions(sessions);
}

function getBridgePrinters() {
  ensureInitialized();
  if (!fs.existsSync(BRIDGE_PRINTERS_FILE)) {
    return {
      printers: [
        { name: "Canon - C5560", driverName: "Canon Generic Plus PCL6", status: "Ready (Shop Local)", isOnline: true, jobCount: 0 },
        { name: "ADVANCE 6575", driverName: "Canon Generic Plus PCL6", status: "Ready (Shop Local)", isOnline: true, jobCount: 0 }
      ],
      defaultBw: "ADVANCE 6575",
      defaultColor: "Canon - C5560"
    };
  }
  try {
    const raw = fs.readFileSync(BRIDGE_PRINTERS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function saveBridgePrinters(data) {
  ensureInitialized();
  fs.writeFileSync(BRIDGE_PRINTERS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function ensureInitialized() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8');
  }

  if (!fs.existsSync(DB_FILE)) {
    const initialDb = {
      orders: [],
      orderCounter: 1000
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2), 'utf8');
  }
}

function getSettingsRaw() {
  ensureInitialized();
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) {
    return DEFAULT_SETTINGS;
  }
}

function getSettings() {
  const raw = getSettingsRaw();
  const safe = { ...raw };
  if (safe.admin) {
    // Strip password and any hint so clients never see it
    safe.admin = { username: safe.admin.username };
  }
  delete safe.adminPin;
  return safe;
}

function updateSettings(updates) {
  ensureInitialized();
  const current = getSettingsRaw();
  const merged = {
    ...current,
    ...updates,
    shop: { ...current.shop, ...(updates.shop || {}) },
    admin: { ...current.admin, ...(updates.admin || {}) },
    printers: { ...current.printers, ...(updates.printers || {}) },
    rates: updates.rates || current.rates
  };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf8');
  return getSettings();
}

function getDb() {
  ensureInitialized();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { orders: [], orderCounter: 1000 };
  }
}

function saveDb(db) {
  ensureInitialized();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function generateOrderId(db) {
  db.orderCounter = (db.orderCounter || 1000) + 1;
  return `CC-${db.orderCounter}`;
}

function calculateItemPrice(item, rates) {
  const paper = item.paperType || 'A4';
  const mode = (item.colorMode === 'color') ? 'color' : 'bw';
  const isDuplex = item.sides === 'duplex';
  const copies = parseInt(item.copies, 10) || 1;
  const pageCount = Array.isArray(item.selectedPages) && item.selectedPages.length > 0 
    ? item.selectedPages.length 
    : (parseInt(item.totalDocumentPages, 10) || 1);

  const rateConfig = (rates[paper] && rates[paper][mode]) || DEFAULT_RATES[paper][mode];
  let pricePerUnit = 0;
  let sheets = pageCount;

  if (isDuplex) {
    sheets = Math.ceil(pageCount / 2);
    // duplex rate is per sheet
    pricePerUnit = rateConfig.duplex;
  } else {
    // single side rate is per page/sheet
    pricePerUnit = rateConfig.single;
  }

  const subtotal = sheets * pricePerUnit * copies;

  return {
    pageCount,
    sheets,
    copies,
    unitPrice: pricePerUnit,
    subtotal: Math.round(subtotal * 100) / 100
  };
}

function createOrder(orderPayload) {
  const db = getDb();
  const settings = getSettings();
  const orderId = generateOrderId(db);

  let totalAmount = 0;
  let totalPages = 0;
  let totalSheets = 0;

  const enrichedDocs = (orderPayload.documents || []).map((doc, idx) => {
    const calc = calculateItemPrice(doc, settings.rates);
    totalAmount += calc.subtotal;
    totalPages += calc.pageCount * calc.copies;
    totalSheets += calc.sheets * calc.copies;
    
    // Choose appropriate default printer based on color vs bw
    const defaultPrinter = doc.colorMode === 'color' 
      ? settings.printers.defaultColor 
      : settings.printers.defaultBw;

    return {
      id: doc.id || `doc_${idx + 1}`,
      originalName: doc.originalName || 'Document',
      filePath: doc.filePath,
      mimeType: doc.mimeType,
      fileSize: doc.fileSize,
      paperType: doc.paperType || 'A4',
      colorMode: doc.colorMode || 'bw',
      sides: doc.sides || 'single', // 'single' | 'duplex'
      pageRangeMode: doc.pageRangeMode || 'all', // 'all' | 'custom' | 'visual'
      customRangeText: doc.customRangeText || '',
      selectedPages: doc.selectedPages || [], // 1-based page numbers
      totalDocumentPages: doc.totalDocumentPages || 1,
      copies: parseInt(doc.copies, 10) || 1,
      assignedPrinter: doc.assignedPrinter || defaultPrinter,
      pricing: calc
    };
  });

  const newOrder = {
    id: orderId,
    createdAt: new Date().toISOString(),
    customer: {
      name: orderPayload.customer?.name || 'Customer',
      phone: orderPayload.customer?.phone || ''
    },
    paymentMethod: orderPayload.paymentMethod || 'shop', // 'online' | 'shop'
    paymentStatus: orderPayload.paymentStatus || (orderPayload.paymentMethod === 'online' ? 'completed' : 'pending_at_shop'),
    paymentRef: orderPayload.paymentRef || (orderPayload.paymentMethod === 'online' ? `UPI-${Date.now().toString().slice(-6)}` : 'Pay at Counter'),
    status: 'pending_approval', // 'pending_approval' | 'printing' | 'ready_for_pickup' | 'completed' | 'cancelled'
    statusTimeline: [
      {
        status: 'order_placed',
        label: 'Order Placed & Files Uploaded',
        time: new Date().toISOString(),
        note: `Payment: ${orderPayload.paymentMethod === 'online' ? 'Paid Online via UPI' : 'Pay at Shop'}`
      }
    ],
    documents: enrichedDocs,
    summary: {
      documentCount: enrichedDocs.length,
      totalPages,
      totalSheets,
      totalAmount: Math.round(totalAmount * 100) / 100
    },
    printResults: []
  };

  db.orders.unshift(newOrder);
  saveDb(db);
  return newOrder;
}

function getOrder(id) {
  const db = getDb();
  return db.orders.find(o => o.id === id || o.id.toLowerCase() === id.toLowerCase());
}

function getOrdersByPhone(phone) {
  const db = getDb();
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  return db.orders.filter(o => {
    const oPhone = (o.customer?.phone || '').replace(/[^0-9]/g, '');
    return oPhone.length >= 4 && (oPhone.includes(cleanPhone) || cleanPhone.includes(oPhone));
  });
}

function getOrders(filter = 'all') {
  const db = getDb();
  if (filter === 'all') return db.orders;
  return db.orders.filter(o => o.status === filter);
}

function updateOrderStatus(id, newStatus, note = '') {
  const db = getDb();
  const order = db.orders.find(o => o.id === id);
  if (!order) return null;

  order.status = newStatus;
  order.updatedAt = new Date().toISOString();

  let label = newStatus;
  if (newStatus === 'printing') label = 'Approved by Admin - Printing in Progress';
  if (newStatus === 'ready_for_pickup') label = 'Printing Completed - Ready for Pickup at Counter';
  if (newStatus === 'completed') label = 'Order Collected by Customer';
  if (newStatus === 'cancelled') label = 'Order Cancelled';

  order.statusTimeline.push({
    status: newStatus,
    label,
    time: new Date().toISOString(),
    note
  });

  saveDb(db);
  return order;
}

function updateOrder(id, patch) {
  const db = getDb();
  const order = db.orders.find(o => o.id === id);
  if (!order) return null;

  Object.assign(order, patch);
  order.updatedAt = new Date().toISOString();
  saveDb(db);
  return order;
}

function deleteOrder(id) {
  const db = getDb();
  const idx = db.orders.findIndex(o => o.id === id || o.id.toLowerCase() === id.toLowerCase());
  if (idx === -1) return null;

  const [deletedOrder] = db.orders.splice(idx, 1);
  saveDb(db);
  return deletedOrder;
}

function clearAllOrders() {
  const db = getDb();
  const deletedOrders = [...db.orders];
  db.orders = [];
  saveDb(db);
  return deletedOrders;
}

function updateDocumentPrinter(orderId, docId, printerName) {
  const db = getDb();
  const order = db.orders.find(o => o.id === orderId || o.id.toLowerCase() === orderId.toLowerCase());
  if (!order) return null;

  let docUpdated = false;
  if (order.documents && Array.isArray(order.documents)) {
    for (const doc of order.documents) {
      if (!docId || doc.id === docId) {
        doc.assignedPrinter = printerName;
        docUpdated = true;
      }
    }
  }

  order.assignedPrinter = printerName;
  order.updatedAt = new Date().toISOString();
  saveDb(db);
  return order;
}

module.exports = {
  getSettings,
  updateSettings,
  getDb,
  saveDb,
  createOrder,
  getOrder,
  getOrders,
  getOrdersByPhone,
  updateOrderStatus,
  updateOrder,
  deleteOrder,
  clearAllOrders,
  updateDocumentPrinter,
  verifyAdminCredentials,
  createAdminSession,
  isValidAdminSession,
  deleteAdminSession,
  getBridgePrinters,
  saveBridgePrinters,
  calculateItemPrice,
  DEFAULT_RATES
};
