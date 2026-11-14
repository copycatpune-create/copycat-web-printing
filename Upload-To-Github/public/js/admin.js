// Admin Portal Client Logic with Session Authentication

const state = {
  orders: [],
  printers: [],
  defaultBw: '',
  defaultColor: '',
  rates: null,
  activeFilter: 'all',
  activeTab: 'tabOrders',
  audioEnabled: true,
  networkInfo: null,
  isAuthenticated: false
};

// Auth Elements
const adminLoginSection = document.getElementById('adminLoginSection');
const adminMainContent = document.getElementById('adminMainContent');
const adminNavTabs = document.getElementById('adminNavTabs');
const btnAdminLogout = document.getElementById('btnAdminLogout');
const loginUsername = document.getElementById('loginUsername');
const loginPassword = document.getElementById('loginPassword');
const loginErrorMsg = document.getElementById('loginErrorMsg');
const btnLoginSubmit = document.getElementById('btnLoginSubmit');

// Elements
const adminOrdersContainer = document.getElementById('adminOrdersContainer');
const printersGrid = document.getElementById('printersGrid');
const selDefaultBw = document.getElementById('selDefaultBw');
const selDefaultColor = document.getElementById('selDefaultColor');
const btnSavePrinterDefaults = document.getElementById('btnSavePrinterDefaults');
const btnRefreshPrinters = document.getElementById('btnRefreshPrinters');
const btnSaveRates = document.getElementById('btnSaveRates');
const btnRefreshOrders = document.getElementById('btnRefreshOrders');
const adminSearchInput = document.getElementById('adminSearchInput');
const btnAudioToggle = document.getElementById('btnAudioToggle');
const navPendingBadge = document.getElementById('navPendingBadge');

// Stat elements
const statPendingCount = document.getElementById('statPendingCount');
const statPrintingCount = document.getElementById('statPrintingCount');
const statCompletedCount = document.getElementById('statCompletedCount');
const statTotalRevenue = document.getElementById('statTotalRevenue');
const statPrintersOnline = document.getElementById('statPrintersOnline');

// QR elements
const adminQrStandContainer = document.getElementById('adminQrStandContainer');
const adminWifiSsid = document.getElementById('adminWifiSsid');
const adminWebUrlDisplay = document.getElementById('adminWebUrlDisplay');

// Preview modal
const docPreviewModal = document.getElementById('docPreviewModal');
const previewDocTitle = document.getElementById('previewDocTitle');
const previewIframe = document.getElementById('previewIframe');
const btnClosePreviewModal = document.getElementById('btnClosePreviewModal');

let refreshTimer = null;

// Admin Session Token Helpers (Persisted across refreshes)
function getAdminToken() {
  try {
    return localStorage.getItem('cat_admin_token') || sessionStorage.getItem('cat_admin_token') || '';
  } catch (e) {
    return '';
  }
}

function setAdminToken(token) {
  try { localStorage.setItem('cat_admin_token', token); } catch (e) {}
  try { sessionStorage.setItem('cat_admin_token', token); } catch (e) {}
}

function removeAdminToken() {
  try { localStorage.removeItem('cat_admin_token'); } catch (e) {}
  try { sessionStorage.removeItem('cat_admin_token'); } catch (e) {}
}

// Authenticated Fetch Wrapper
async function adminFetch(url, options = {}) {
  const token = getAdminToken();
  const headers = {
    ...(options.headers || {}),
    'x-admin-token': token || '',
    'Authorization': token ? `Bearer ${token}` : ''
  };

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401 && !url.includes('/login') && !url.includes('/verify-token')) {
    removeAdminToken();
    showLoginView('Session expired. Please sign in again.');
    throw new Error('Unauthorized');
  }
  return res;
}

// Authentication Views
function showLoginView(errorText = '') {
  state.isAuthenticated = false;
  if (refreshTimer) clearInterval(refreshTimer);

  if (adminLoginSection) adminLoginSection.style.display = 'block';
  if (adminMainContent) adminMainContent.style.display = 'none';
  if (adminNavTabs) adminNavTabs.style.display = 'none';
  if (btnAdminLogout) btnAdminLogout.style.display = 'none';

  if (errorText && loginErrorMsg) {
    loginErrorMsg.textContent = errorText;
    loginErrorMsg.style.display = 'block';
  } else if (loginErrorMsg) {
    loginErrorMsg.style.display = 'none';
  }

  if (loginPassword) loginPassword.value = '';
}

function showDashboardView() {
  state.isAuthenticated = true;
  if (adminLoginSection) adminLoginSection.style.display = 'none';
  if (adminMainContent) adminMainContent.style.display = 'block';
  if (adminNavTabs) adminNavTabs.style.display = 'flex';
  if (btnAdminLogout) btnAdminLogout.style.display = 'inline-flex';
}

// Submit Admin Login
window.submitAdminLogin = async function() {
  const username = loginUsername.value.trim();
  const password = loginPassword.value;

  loginErrorMsg.style.display = 'none';
  btnLoginSubmit.disabled = true;
  btnLoginSubmit.textContent = 'Signing in...';

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (res.ok && data.success && data.token) {
      setAdminToken(data.token);
      showDashboardView();
      await initDashboardData();
    } else {
      loginErrorMsg.textContent = data.error || 'Invalid username or password';
      loginErrorMsg.style.display = 'block';
    }
  } catch (err) {
    loginErrorMsg.textContent = 'Connection error: ' + err.message;
    loginErrorMsg.style.display = 'block';
  } finally {
    btnLoginSubmit.disabled = false;
    btnLoginSubmit.textContent = 'Sign In';
  }
};

// Logout Admin
window.logoutAdmin = async function() {
  const token = getAdminToken();
  try {
    await fetch('/api/admin/logout', {
      method: 'POST',
      headers: { 'x-admin-token': token || '' }
    });
  } catch (e) {}
  removeAdminToken();
  showLoginView();
};

// Check Existing Session
async function checkAuthAndStart() {
  const token = getAdminToken();
  if (!token) {
    showLoginView();
    return;
  }

  try {
    const res = await fetch('/api/admin/verify-token', {
      method: 'POST',
      headers: { 'x-admin-token': token }
    });
    const data = await res.json();
    if (data.success && data.valid) {
      showDashboardView();
      await initDashboardData();
    } else {
      removeAdminToken();
      showLoginView();
    }
  } catch (err) {
    showLoginView();
  }
}

// Initialize Dashboard Data after Auth
async function initDashboardData() {
  setupNavigation();
  setupAudio();
  await loadNetworkInfo();
  await loadPrinters();
  await loadRates();
  await loadOrders();
  setupWebSocket();

  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(loadOrders, 5000);
}

// Setup Tab Navigation
function setupNavigation() {
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none');

      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      document.getElementById(tabId).style.display = 'block';
      state.activeTab = tabId;

      if (tabId === 'tabQrStand') renderAdminQr();
    });
  });

  // Filter Buttons
  document.querySelectorAll('.order-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.order-filter-btn').forEach(b => {
        b.classList.remove('active', 'btn-primary');
        b.classList.add('btn-outline');
      });
      btn.classList.add('active', 'btn-primary');
      btn.classList.remove('btn-outline');
      state.activeFilter = btn.getAttribute('data-filter');
      renderOrders();
    });
  });

  const btnClearAllOrders = document.getElementById('btnClearAllOrders');
  if (btnClearAllOrders) {
    btnClearAllOrders.onclick = clearAllOrders;
  }

  if (btnAdminLogout) {
    btnAdminLogout.onclick = logoutAdmin;
  }

  btnRefreshOrders.onclick = loadOrders;
  btnRefreshPrinters.onclick = loadPrinters;
  btnSavePrinterDefaults.onclick = savePrinterDefaults;
  btnSaveRates.onclick = saveRates;

  if (adminSearchInput) {
    adminSearchInput.oninput = renderOrders;
  }

  // Preview Modal Close
  btnClosePreviewModal.onclick = () => {
    docPreviewModal.classList.remove('active');
    previewIframe.src = '';
  };
}

// Audio Chime & Web Audio API
let globalAdminAudioCtx = null;
const shownOrderToasts = new Set();

function getAdminAudioContext() {
  if (!globalAdminAudioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      globalAdminAudioCtx = new AudioContextClass();
    }
  }
  if (globalAdminAudioCtx && globalAdminAudioCtx.state === 'suspended') {
    globalAdminAudioCtx.resume().catch(() => {});
  }
  return globalAdminAudioCtx;
}

// Global user interaction listener to unlock AudioContext
window.addEventListener('click', () => {
  getAdminAudioContext();
}, { once: false });

function setupAudio() {
  const chimePulseDot = document.getElementById('chimePulseDot');
  const btnAudioToggleText = document.getElementById('btnAudioToggleText');
  const btnEnableDesktopNotif = document.getElementById('btnEnableDesktopNotif');

  // Load saved chime preference (defaults to true)
  const savedChime = localStorage.getItem('copycat_admin_chime');
  state.audioEnabled = savedChime !== 'false';

  function updateChimeUI() {
    if (state.audioEnabled) {
      btnAudioToggle.className = 'btn btn-sm audio-btn-on';
      if (chimePulseDot) chimePulseDot.style.display = 'inline-block';
      if (btnAudioToggleText) btnAudioToggleText.textContent = '🔔 Chime: ON';
      else btnAudioToggle.textContent = '🔔 Chime: ON';
    } else {
      btnAudioToggle.className = 'btn btn-sm audio-btn-off';
      if (chimePulseDot) chimePulseDot.style.display = 'none';
      if (btnAudioToggleText) btnAudioToggleText.textContent = '🔕 Chime: MUTED';
      else btnAudioToggle.textContent = '🔕 Chime: MUTED';
    }
  }

  updateChimeUI();

  btnAudioToggle.onclick = () => {
    state.audioEnabled = !state.audioEnabled;
    localStorage.setItem('copycat_admin_chime', state.audioEnabled ? 'true' : 'false');
    updateChimeUI();

    if (state.audioEnabled) {
      // Play a preview chime so the admin immediately confirms audio is active!
      playNewOrderChime(true);
    }
  };

  // Setup Desktop Notifications permission button
  if (btnEnableDesktopNotif && 'Notification' in window) {
    if (Notification.permission === 'default') {
      btnEnableDesktopNotif.style.display = 'inline-flex';
      btnEnableDesktopNotif.onclick = async () => {
        try {
          const perm = await Notification.requestPermission();
          if (perm === 'granted') {
            btnEnableDesktopNotif.style.display = 'none';
            new Notification('Copycat Copiers: Notifications Enabled', {
              body: 'You will receive desktop alerts when customers submit print jobs.',
              icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%234285F4"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>'
            });
          }
        } catch (e) {}
      };
    } else {
      btnEnableDesktopNotif.style.display = 'none';
    }
  }
}

// Multi-tone counter bell sound synthesis
function playNewOrderChime(isPreview = false) {
  if (!state.audioEnabled && !isPreview) return;

  try {
    const audioCtx = getAdminAudioContext();
    if (!audioCtx) return;

    const playTone = (freq, startTime, duration, vol = 0.25) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle'; // Warm counter bell sound
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(vol, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const now = audioCtx.currentTime;
    // Four-tone commercial counter chime (D5 -> F#5 -> A5 -> D6)
    playTone(587.33, now, 0.35, 0.25);
    playTone(739.99, now + 0.12, 0.40, 0.28);
    playTone(880.00, now + 0.24, 0.45, 0.30);
    playTone(1174.66, now + 0.38, 0.85, 0.35);
  } catch (e) {
    console.warn('Admin chime error:', e);
  }
}

// Show Floating Pop-up Notification Card
window.showOrderPopupNotification = function(order) {
  if (!order || !order.id) return;
  if (shownOrderToasts.has(order.id)) return;
  shownOrderToasts.add(order.id);

  const container = document.getElementById('adminNotificationContainer');
  if (!container) return;

  const toastId = `toast-order-${order.id}`;
  const totalAmount = (order.summary?.totalAmount || 0).toFixed(2);
  const docCount = order.documents?.length || 1;
  const payLabel = (order.paymentStatus === 'completed' || order.paymentMethod === 'online') ? 'Paid Online (UPI)' : 'Pay at Counter';

  const toastEl = document.createElement('div');
  toastEl.className = 'admin-order-toast';
  toastEl.id = toastId;
  toastEl.innerHTML = `
    <div class="toast-accent-bar"></div>
    <div class="toast-content-wrap">
      <div class="toast-top-row">
        <span class="toast-badge-pill">
          <span class="chime-pulse-dot" style="width: 7px; height: 7px;"></span>
          NEW ORDER RECEIVED
        </span>
        <button class="toast-close-btn" onclick="dismissToast('${toastId}')" title="Dismiss notification">&times;</button>
      </div>
      <div class="toast-title">
        🔔 Order #${order.id}
      </div>
      <div class="toast-info-text">
        <strong>${order.customer?.name || 'Customer'}</strong> • <a href="tel:${order.customer?.phone || ''}" style="color: inherit; text-decoration: underline;">${order.customer?.phone || ''}</a>
      </div>
      <div class="toast-meta-row">
        <span>📄 ${docCount} Document${docCount > 1 ? 's' : ''}</span>
        <span>•</span>
        <span style="font-weight: 800; color: #188038;">₹${totalAmount}</span>
        <span>•</span>
        <span>${payLabel}</span>
      </div>
      <div class="toast-actions">
        <button class="btn btn-primary btn-sm" onclick="jumpToOrderCard('${order.id}'); dismissToast('${toastId}')" style="flex: 1; font-weight: 700;">
          👁️ Review & Approve
        </button>
        <button class="btn btn-outline btn-sm" onclick="dismissToast('${toastId}')">
          Dismiss
        </button>
      </div>
    </div>
  `;

  container.appendChild(toastEl);

  // Auto-dismiss after 14 seconds
  setTimeout(() => {
    dismissToast(toastId);
  }, 14000);

  // Trigger browser desktop notification if permitted
  triggerDesktopNotification(order);
};

window.dismissToast = function(toastId) {
  const toast = document.getElementById(toastId);
  if (toast) {
    toast.classList.add('toast-hiding');
    setTimeout(() => {
      if (toast && toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 250);
  }
};

window.jumpToOrderCard = function(orderId) {
  // If order is hidden by active filter, switch filter to all
  const existingCard = document.getElementById(`order-card-${orderId}`);
  if (!existingCard) {
    state.activeFilter = 'all';
    document.querySelectorAll('.filter-pill').forEach(p => {
      p.classList.toggle('active', p.getAttribute('data-filter') === 'all');
    });
    renderOrders();
  }

  const targetCard = document.getElementById(`order-card-${orderId}`);
  if (targetCard) {
    targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    targetCard.classList.remove('highlight-order-pulse');
    void targetCard.offsetWidth; // Force CSS reflow
    targetCard.classList.add('highlight-order-pulse');
  }
};

function triggerDesktopNotification(order) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try {
      const n = new Notification(`New Print Order: #${order.id}`, {
        body: `${order.customer?.name} • ₹${(order.summary?.totalAmount || 0).toFixed(2)} (${order.documents?.length || 1} docs)`,
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%234285F4"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>',
        tag: `order-${order.id}`
      });
      n.onclick = () => {
        window.focus();
        jumpToOrderCard(order.id);
      };
    } catch (e) {}
  }
}

// WebSocket Live Updates
function setupWebSocket() {
  try {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ action: 'join', room: 'admin_stream' }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.event === 'ORDER_CREATED') {
          playNewOrderChime();
          showOrderPopupNotification(msg.payload);
          loadOrders();
        } else if (msg.event === 'ORDER_STATUS_CHANGED' || msg.event === 'ORDER_DELETED' || msg.event === 'ALL_ORDERS_CLEARED') {
          loadOrders();
        } else if (msg.event === 'NETWORK_INFO_UPDATED') {
          loadNetworkInfo();
        }
      } catch (e) {}
    };
  } catch (err) {}
}

// Load Network Info & QR
async function loadNetworkInfo() {
  try {
    const res = await adminFetch('/api/network-info');
    state.networkInfo = await res.json();
    if (adminWifiSsid && state.networkInfo.wifi) adminWifiSsid.textContent = state.networkInfo.wifi.ssid;
    if (adminWebUrlDisplay) adminWebUrlDisplay.textContent = state.networkInfo.webAppUrl;
    renderAdminQr();
  } catch (err) {}
}

function renderAdminQr() {
  if (!adminQrStandContainer || !window.QRCode || !state.networkInfo) return;
  adminQrStandContainer.innerHTML = '';
  new QRCode(adminQrStandContainer, {
    text: state.networkInfo.webAppUrl,
    width: 220,
    height: 220,
    colorDark: "#202124",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });
}

// Load Live Printers
async function loadPrinters() {
  try {
    const res = await adminFetch('/api/printers');
    const data = await res.json();
    state.printers = data.printers || [];
    state.defaultBw = data.defaultBw || (state.printers[0]?.name || '');
    state.defaultColor = data.defaultColor || (state.printers[1]?.name || state.printers[0]?.name || '');

    statPrintersOnline.textContent = state.printers.length;
    populateDefaultDropdowns();
    renderPrintersGrid();
  } catch (err) {}
}

function populateDefaultDropdowns() {
  if (!selDefaultBw || !selDefaultColor) return;

  selDefaultBw.innerHTML = '';
  selDefaultColor.innerHTML = '';

  state.printers.forEach(p => {
    const optBw = document.createElement('option');
    optBw.value = p.name;
    optBw.textContent = `${p.name} (${p.driverName || 'PCL Driver'})`;
    if (p.name === state.defaultBw) optBw.selected = true;
    selDefaultBw.appendChild(optBw);

    const optColor = document.createElement('option');
    optColor.value = p.name;
    optColor.textContent = `${p.name} (${p.driverName || 'Color Driver'})`;
    if (p.name === state.defaultColor) optColor.selected = true;
    selDefaultColor.appendChild(optColor);
  });
}

async function savePrinterDefaults() {
  const defaultBw = selDefaultBw.value;
  const defaultColor = selDefaultColor.value;

  btnSavePrinterDefaults.disabled = true;
  btnSavePrinterDefaults.textContent = 'Saving...';

  try {
    const res = await adminFetch('/api/printers/defaults', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultBw, defaultColor })
    });
    const data = await res.json();
    if (data.success) {
      state.defaultBw = defaultBw;
      state.defaultColor = defaultColor;
      showToast(`Default printers saved: B&W: ${defaultBw}, Color: ${defaultColor}`);
      renderOrders();
    }
  } catch (e) {
    alert('Failed to save defaults: ' + e.message);
  } finally {
    btnSavePrinterDefaults.disabled = false;
    btnSavePrinterDefaults.textContent = 'Save Default Printers';
  }
}

function renderPrintersGrid() {
  if (!printersGrid) return;
  printersGrid.innerHTML = state.printers.map(p => {
    const isDefaultBw = p.name === state.defaultBw;
    const isDefaultColor = p.name === state.defaultColor;

    return `
      <div class="printer-card">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <h4 style="font-size: 1.05rem; font-weight: 700; color: #202124;">${p.name}</h4>
            <div style="font-size: 0.78rem; color: var(--text-muted);">${p.driverName}</div>
          </div>
          <span class="status-badge" style="background: ${p.isOnline ? '#e6f4ea' : '#fce8e6'}; color: ${p.isOnline ? '#137333' : '#c5221f'};">
            ${p.status}
          </span>
        </div>

        <div style="font-size: 0.8rem; color: #5f6368; margin-top: 0.35rem; display: flex; flex-direction: column; gap: 0.2rem;">
          <div>Port: <code>${p.portName}</code></div>
          <div>Active Spool Queue: <strong>${p.jobCount} jobs</strong></div>
        </div>

        <div style="display: flex; gap: 0.4rem; margin-top: 0.5rem; flex-wrap: wrap;">
          ${isDefaultBw ? '<span class="status-badge" style="background: #202124; color: white;">Default B&W</span>' : ''}
          ${isDefaultColor ? '<span class="status-badge" style="background: #ea4335; color: white;">Default Color</span>' : ''}
        </div>

        <div style="margin-top: 0.75rem; border-top: 1px solid var(--border-light); padding-top: 0.75rem; display: flex; justify-content: flex-end; gap: 0.5rem; flex-wrap: wrap;">
          <button class="btn btn-outline btn-sm" onclick="checkPrinterLive('${p.name.replace(/'/g, "\\'")}')">
            🔍 Check Connection
          </button>
          <button class="btn btn-outline btn-sm" onclick="sendTestPrint('${p.name.replace(/'/g, "\\'")}')">
            🖨️ Send Test Print
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.checkPrinterLive = async function(printerName) {
  try {
    const res = await adminFetch('/api/printers/check-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printerName })
    });
    const data = await res.json();
    if (data.success) {
      alert(`[Hardware Connection Check]\nPrinter: ${data.printer}\nPort: ${data.port}\nStatus: ${data.status || 'Normal'}\nActive Spool Jobs: ${data.jobCount}\n\n✓ Connection between Web App and Windows Print Driver is ACTIVE!`);
      loadPrinters();
    } else {
      alert(`Connection Check: ${data.message}`);
    }
  } catch (e) {
    alert(`Could not verify printer connection: ${e.message}`);
  }
};

window.sendTestPrint = async function(printerName) {
  if (!confirm(`Send test alignment print to "${printerName}"?`)) return;

  try {
    const res = await adminFetch('/api/printers/test-print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printerName })
    });
    const data = await res.json();
    if (data.success) {
      alert(`Test page sent successfully to ${printerName}!`);
    } else {
      alert(`Test print error: ${data.error}`);
    }
  } catch (e) {
    alert(`Failed to test print: ${e.message}`);
  }
};

// Load & Manage Rates
async function loadRates() {
  try {
    const res = await adminFetch('/api/rates');
    const data = await res.json();
    state.rates = data.rates;

    document.getElementById('rate_A4_bw_single').value = state.rates.A4.bw.single;
    document.getElementById('rate_A4_bw_duplex').value = state.rates.A4.bw.duplex;
    document.getElementById('rate_A4_color_single').value = state.rates.A4.color.single;
    document.getElementById('rate_A4_color_duplex').value = state.rates.A4.color.duplex;

    document.getElementById('rate_A3_bw_single').value = state.rates.A3.bw.single;
    document.getElementById('rate_A3_bw_duplex').value = state.rates.A3.bw.duplex;
    document.getElementById('rate_A3_color_single').value = state.rates.A3.color.single;
    document.getElementById('rate_A3_color_duplex').value = state.rates.A3.color.duplex;
  } catch (err) {}
}

async function saveRates() {
  const updatedRates = {
    A4: {
      bw: {
        single: parseFloat(document.getElementById('rate_A4_bw_single').value) || 2,
        duplex: parseFloat(document.getElementById('rate_A4_bw_duplex').value) || 3
      },
      color: {
        single: parseFloat(document.getElementById('rate_A4_color_single').value) || 10,
        duplex: parseFloat(document.getElementById('rate_A4_color_duplex').value) || 18
      }
    },
    A3: {
      bw: {
        single: parseFloat(document.getElementById('rate_A3_bw_single').value) || 5,
        duplex: parseFloat(document.getElementById('rate_A3_bw_duplex').value) || 8
      },
      color: {
        single: parseFloat(document.getElementById('rate_A3_color_single').value) || 25,
        duplex: parseFloat(document.getElementById('rate_A3_color_duplex').value) || 45
      }
    }
  };

  btnSaveRates.disabled = true;
  btnSaveRates.textContent = 'Saving...';

  try {
    const res = await adminFetch('/api/rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rates: updatedRates })
    });
    const data = await res.json();
    if (data.success) {
      state.rates = data.rates;
      showToast('Rate Card saved successfully!');
    }
  } catch (e) {
    alert('Failed to save rate card: ' + e.message);
  } finally {
    btnSaveRates.disabled = false;
    btnSaveRates.textContent = 'Save Rate Card';
  }
}

// Load & Manage Orders
async function loadOrders() {
  if (!state.isAuthenticated) return;

  const activeEl = document.activeElement;
  const isEditing = activeEl && activeEl.closest && activeEl.closest('#adminOrdersContainer') && (activeEl.tagName === 'SELECT' || activeEl.tagName === 'INPUT');

  try {
    const res = await adminFetch('/api/admin/orders');
    const data = await res.json();
    const fetchedOrders = data.orders || [];

    // Check for newly arrived orders to trigger pop-up and chime
    if (Array.isArray(fetchedOrders)) {
      fetchedOrders.forEach(ord => {
        if (ord.status === 'pending_approval' && !shownOrderToasts.has(ord.id)) {
          if (state.orders.length > 0) {
            playNewOrderChime();
            showOrderPopupNotification(ord);
          } else {
            shownOrderToasts.add(ord.id);
          }
        }
      });
    }

    state.orders = fetchedOrders;
    updateMetrics();
    if (!isEditing) {
      renderOrders();
    }
  } catch (err) {}
}

function updateMetrics() {
  const pending = state.orders.filter(o => o.status === 'pending_approval');
  const printing = state.orders.filter(o => o.status === 'printing');
  const completed = state.orders.filter(o => o.status === 'completed' || o.status === 'ready_for_pickup');
  const totalRev = state.orders
    .filter(o => o.status !== 'cancelled')
    .reduce((sum, o) => sum + (o.summary?.totalAmount || 0), 0);

  statPendingCount.textContent = pending.length;
  statPrintingCount.textContent = printing.length;
  statCompletedCount.textContent = completed.length;
  statTotalRevenue.textContent = `₹${totalRev.toFixed(2)}`;

  if (navPendingBadge) {
    if (pending.length > 0) {
      navPendingBadge.textContent = pending.length;
      navPendingBadge.style.display = 'inline-block';
    } else {
      navPendingBadge.style.display = 'none';
    }
  }
}

function renderOrders() {
  let filtered = state.orders;

  if (state.activeFilter !== 'all') {
    filtered = filtered.filter(o => o.status === state.activeFilter);
  }

  const search = adminSearchInput ? adminSearchInput.value.trim().toLowerCase() : '';
  if (search) {
    filtered = filtered.filter(o => 
      o.id.toLowerCase().includes(search) ||
      o.customer.name.toLowerCase().includes(search) ||
      o.customer.phone.includes(search)
    );
  }

  if (filtered.length === 0) {
    adminOrdersContainer.innerHTML = `
      <div style="background: white; border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 3rem 1.5rem; text-align: center; color: var(--text-muted);">
        <p style="font-size: 1.1rem; font-weight: 600;">No orders found in this filter.</p>
        <p style="font-size: 0.85rem; margin-top: 0.35rem;">When customers scan the QR code and submit prints, they will appear here live.</p>
      </div>
    `;
    return;
  }

  adminOrdersContainer.innerHTML = filtered.map(order => {
    const isPending = order.status === 'pending_approval';
    const isPrinting = order.status === 'printing';
    const isReady = order.status === 'ready_for_pickup';
    const isCompleted = order.status === 'completed';

    const isPaid = order.paymentStatus === 'completed' || order.paymentMethod === 'online';

    const docRows = order.documents.map((doc) => {
      const isDuplex = doc.sides === 'duplex';
      const isColor = doc.colorMode === 'color';
      
      const defaultSuggestedPrinter = isColor ? state.defaultColor : state.defaultBw;
      const assigned = doc.assignedPrinter || defaultSuggestedPrinter;

      const printerOptions = state.printers.map(p => `
        <option value="${p.name}" ${p.name === assigned ? 'selected' : ''}>
          ${p.name}
        </option>
      `).join('');

      return `
        <tr style="border-bottom: 1px solid var(--border-light); font-size: 0.85rem;">
          <td style="padding: 0.6rem 0.75rem;">
            <div style="font-weight: 600; color: #202124;" title="${doc.originalName}">${doc.originalName}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">
              ${doc.pageRangeMode === 'all' ? `All ${doc.totalDocumentPages} pages` : `${doc.selectedPages?.length || 1} pages chosen`}
            </div>
          </td>
          <td style="padding: 0.6rem 0.75rem;">
            <span class="hero-pill" style="font-size: 0.75rem;">${doc.paperType}</span>
            <span class="hero-pill" style="font-size: 0.75rem; ${isColor ? 'color: #ea4335;' : ''}">${isColor ? 'Color' : 'B&W'}</span>
            <span class="hero-pill" style="font-size: 0.75rem;">${isDuplex ? 'Duplex' : 'Single'}</span>
          </td>
          <td style="padding: 0.6rem 0.75rem;">
            ${doc.copies} ${doc.copies === 1 ? 'copy' : 'copies'}
          </td>
          <td style="padding: 0.6rem 0.75rem; font-weight: 700; color: #188038;">
            ₹${doc.pricing?.subtotal?.toFixed(2) || '0.00'}
          </td>
          <td style="padding: 0.6rem 0.75rem;">
            <div style="display: flex; align-items: center; gap: 4px;">
              <select class="order-printer-select" data-order-id="${order.id}" data-doc-id="${doc.id}" onchange="changeDocumentPrinter('${order.id}', '${doc.id}', this.value)" style="padding: 0.35rem 0.5rem; font-size: 0.8rem; border: 1px solid var(--border-color); border-radius: 6px; background: white; max-width: 180px;">
                ${printerOptions}
              </select>
              <span id="printer-save-tag-${order.id}-${doc.id}" style="font-size: 0.72rem; color: #137333; font-weight: 700; display: none;">✓ Saved</span>
            </div>
          </td>
          <td style="padding: 0.6rem 0.75rem; text-align: right;">
            <button class="btn btn-outline btn-sm" onclick="previewDocumentFile('${doc.originalName.replace(/'/g, "\\'")}', '${doc.filePath.replace(/\\/g, '/').replace(/'/g, "\\'")}')">
              👁️ Preview
            </button>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="document-item-card" id="order-card-${order.id}" style="margin-bottom: 1.5rem; border-left: 5px solid ${isPending ? '#fbbc05' : (isPrinting ? '#4285f4' : (isReady ? '#34a853' : '#dadce0'))};">
        
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem; border-bottom: 1px solid var(--border-light); padding-bottom: 0.85rem; margin-bottom: 1rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <h3 style="font-size: 1.3rem; font-weight: 800; color: #1a73e8;">${order.id}</h3>
              ${isCompleted 
                ? '<span class="status-badge" style="background: #e6f4ea; color: #137333; font-weight: 700; border: 1px solid #ceead6;">✓ Collected / Done</span>'
                : `<span class="status-badge ${order.status}">${order.status.replace(/_/g, ' ')}</span>`
              }
              <span class="status-badge" style="background: ${isPaid ? '#e6f4ea' : '#fef7e0'}; color: ${isPaid ? '#137333' : '#b06000'};">
                ${isPaid ? '✓ Paid Online (UPI)' : 'Cash / Counter (Pending)'}
              </span>
            </div>

            <div style="font-size: 0.85rem; color: #3c4043; margin-top: 0.25rem;">
              <strong>${order.customer.name}</strong> • Phone: <a href="tel:${order.customer.phone}" style="color: inherit; text-decoration: underline;">${order.customer.phone}</a> • Placed at: ${new Date(order.createdAt).toLocaleTimeString()}
            </div>
          </div>

          <div style="text-align: right;">
            <div style="font-size: 1.3rem; font-weight: 800; color: #188038;">
              ₹${order.summary.totalAmount.toFixed(2)}
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">
              ${order.summary.totalPages} pages (${order.summary.totalSheets} sheets)
            </div>
          </div>
        </div>

        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 1rem;">
            <thead>
              <tr style="background: #f8f9fa; font-size: 0.78rem; text-transform: uppercase; color: var(--text-muted); text-align: left;">
                <th style="padding: 0.5rem 0.75rem;">File Details</th>
                <th style="padding: 0.5rem 0.75rem;">Specifications</th>
                <th style="padding: 0.5rem 0.75rem;">Qty</th>
                <th style="padding: 0.5rem 0.75rem;">Price</th>
                <th style="padding: 0.5rem 0.75rem;">Assigned Printer (Override)</th>
                <th style="padding: 0.5rem 0.75rem; text-align: right;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${docRows}
            </tbody>
          </table>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-light); padding-top: 0.85rem; flex-wrap: wrap; gap: 0.75rem;">
          <div>
            ${order.assignedPrinter ? `<span style="font-size: 0.8rem; color: #5f6368;">Dispatched to: <strong>${order.assignedPrinter}</strong></span>` : ''}
          </div>

          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            ${isPending ? `
              <button class="btn btn-primary" onclick="approveAndStartPrint('${order.id}')" style="box-shadow: 0 2px 6px rgba(26,115,232,0.3);">
                ⚡ Approve & Start Live Printing
              </button>
              <button class="btn btn-success btn-sm" onclick="markOrderCollected('${order.id}')">
                ✓ Mark Completed / Collected
              </button>
            ` : ''}

            ${isPrinting ? `
              <button class="btn btn-outline btn-sm" disabled style="color: var(--primary);">
                🖨️ Printing Spooling...
              </button>
              <button class="btn btn-outline btn-sm" onclick="updateOrderStatusManual('${order.id}', 'ready_for_pickup')">
                Mark as Ready for Pickup
              </button>
              <button class="btn btn-success btn-sm" onclick="markOrderCollected('${order.id}')">
                ✓ Mark Completed / Collected
              </button>
            ` : ''}

            ${isReady ? `
              <button class="btn btn-success btn-sm" onclick="markOrderCollected('${order.id}')" style="box-shadow: 0 2px 6px rgba(52,168,83,0.3); font-weight: 700;">
                ✓ Mark Completed / Collected
              </button>
              <button class="btn btn-outline btn-sm" onclick="approveAndStartPrint('${order.id}')" title="Reprint again">
                ↻ Reprint
              </button>
            ` : ''}

            ${isCompleted ? `
              <button class="btn btn-outline btn-sm" onclick="approveAndStartPrint('${order.id}')" title="Reprint again">
                ↻ Reprint
              </button>
            ` : ''}

            <button class="btn btn-outline btn-sm" onclick="clearSingleOrder('${order.id}')" style="color: #d93025; border-color: #f28b82; background: #fff8f8;" title="Delete this order and its uploaded files from disk">
              🗑️ Clear Order
            </button>

            <a href="track.html?id=${order.id}" target="_blank" class="btn btn-outline btn-sm">
              Live Customer View ↗
            </a>
          </div>
        </div>

      </div>
    `;
  }).join('');
}

// Preview uploaded document
window.previewDocumentFile = function(title, filePath) {
  previewDocTitle.textContent = title;
  const filename = filePath.split('/').pop().split('\\').pop();
  previewIframe.src = `/api/files/${encodeURIComponent(filename)}`;
  docPreviewModal.classList.add('active');
};

// Approve and Start Live Printing
window.approveAndStartPrint = async function(orderId) {
  const printerOverrides = {};
  document.querySelectorAll(`.order-printer-select[data-order-id="${orderId}"]`).forEach(sel => {
    const docId = sel.getAttribute('data-doc-id');
    printerOverrides[docId] = sel.value;
  });

  if (!confirm(`Approve Order ${orderId} and send print job immediately to live local Windows printer?`)) {
    return;
  }

  try {
    const res = await adminFetch(`/api/admin/orders/${orderId}/approve-and-print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printerOverrides })
    });

    const data = await res.json();
    if (data.success) {
      alert(`Print job sent successfully!\nOrder ${orderId} is being printed on locally installed printers.`);
      loadOrders();
    } else {
      alert(`Print Error: ${data.error}`);
      loadOrders();
    }
  } catch (err) {
    alert(`Could not start print job: ${err.message}`);
    loadOrders();
  }
};

window.updateOrderStatusManual = async function(orderId, newStatus) {
  try {
    const res = await adminFetch(`/api/admin/orders/${orderId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (data.success) {
      loadOrders();
    }
  } catch (err) {
    alert(`Failed to update status: ${err.message}`);
  }
};

// Change Assigned Printer & Save
window.changeDocumentPrinter = async function(orderId, docId, printerName) {
  const order = state.orders.find(o => o.id === orderId);
  if (order) {
    if (order.documents) {
      const doc = order.documents.find(d => d.id === docId);
      if (doc) doc.assignedPrinter = printerName;
    }
    order.assignedPrinter = printerName;
  }

  try {
    const res = await adminFetch(`/api/admin/orders/${orderId}/update-printer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docId, printer: printerName })
    });
    const data = await res.json();
    if (data.success) {
      const tag = document.getElementById(`printer-save-tag-${orderId}-${docId}`);
      if (tag) {
        tag.style.display = 'inline';
        setTimeout(() => { if (tag) tag.style.display = 'none'; }, 2500);
      }
      showToast(`Assigned printer for ${orderId} changed to: ${printerName}`);
    } else {
      alert(`Could not save printer override: ${data.error}`);
    }
  } catch (err) {
    console.error('Failed to save printer selection:', err);
    alert('Failed to save printer override: ' + err.message);
  }
};

// Mark Order as Collected / Completed
window.markOrderCollected = async function(orderId) {
  try {
    const res = await adminFetch(`/api/admin/orders/${orderId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'completed',
        note: 'Order collected by customer - Marked Completed & Done.'
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Order ${orderId} marked as Collected / Done!`);
      loadOrders();
    }
  } catch (err) {
    alert(`Failed to mark order as collected: ${err.message}`);
  }
};

// Clear Single Order & Delete its uploaded files
window.clearSingleOrder = async function(orderId) {
  if (!confirm(`Are you sure you want to CLEAR Order ${orderId}?\n\nThis will permanently remove the order record and delete all uploaded customer files and print jobs for this order from the computer disk.`)) {
    return;
  }

  try {
    const res = await adminFetch(`/api/admin/orders/${orderId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message);
      loadOrders();
    } else {
      alert('Delete error: ' + data.error);
    }
  } catch (err) {
    alert('Failed to delete order: ' + err.message);
  }
};

// Clear All Orders & Delete all uploaded files
window.clearAllOrders = async function() {
  if (!confirm(`⚠️ WARNING: Are you sure you want to CLEAR ALL ORDERS?\n\nThis will permanently delete every order in the system and remove all uploaded customer files and print jobs from the computer disk.\n\nThis action cannot be undone.`)) {
    return;
  }

  try {
    const res = await adminFetch('/api/admin/orders/clear-all', {
      method: 'POST'
    });
    const data = await res.json();
    if (data.success) {
      alert(data.message);
      loadOrders();
    } else {
      alert('Clear error: ' + data.error);
    }
  } catch (err) {
    alert('Failed to clear all orders: ' + err.message);
  }
};

// Floating Toast Notification
function showToast(message) {
  let toast = document.getElementById('adminToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'adminToast';
    toast.style.position = 'fixed';
    toast.style.bottom = '24px';
    toast.style.right = '24px';
    toast.style.background = '#202124';
    toast.style.color = '#fff';
    toast.style.padding = '12px 20px';
    toast.style.borderRadius = '8px';
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
    toast.style.fontSize = '0.9rem';
    toast.style.fontWeight = '500';
    toast.style.zIndex = '9999';
    toast.style.transition = 'opacity 0.25s ease';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.style.opacity = '0';
  }, 3000);
}

// Start with authentication check
checkAuthAndStart();
