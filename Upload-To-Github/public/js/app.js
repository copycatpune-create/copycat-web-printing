// Set PDF.js worker path
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
}

// Global App State
const state = {
  documents: [],
  stagedFilenames: new Set(),
  orderSubmitted: false,
  rates: null,
  shopInfo: null,
  activeVisualDocId: null,
  tempVisualSelectedPages: new Set(),
  activeStep: 'configure' // 'configure' | 'payment'
};

// DOM Elements
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const uploadSpinner = document.getElementById('uploadSpinner');
const batchToolbar = document.getElementById('batchToolbar');
const chkApplyAll = document.getElementById('chkApplyAll');
const documentsList = document.getElementById('documentsList');

// Summary elements
const summaryDocCountBadge = document.getElementById('summaryDocCountBadge');
const summaryItemsList = document.getElementById('summaryItemsList');
const summaryTotalPages = document.getElementById('summaryTotalPages');
const summaryTotalSheets = document.getElementById('summaryTotalSheets');
const summaryGrandTotal = document.getElementById('summaryGrandTotal');
const btnProceedToPayment = document.getElementById('btnProceedToPayment');

// Payment step elements
const stepConfigure = document.getElementById('stepConfigure');
const stepPayment = document.getElementById('stepPayment');
const btnBackToFiles = document.getElementById('btnBackToFiles');
const custName = document.getElementById('custName');
const custPhone = document.getElementById('custPhone');
const optPaymentOnline = document.getElementById('optPaymentOnline');
const optPaymentShop = document.getElementById('optPaymentShop');
const upiQrSection = document.getElementById('upiQrSection');
const upiQrCodeContainer = document.getElementById('upiQrCodeContainer');
const upiAmountTag = document.getElementById('upiAmountTag');
const upiIdDisplay = document.getElementById('upiIdDisplay');
const checkoutTotalDisplay = document.getElementById('checkoutTotalDisplay');
const btnSimulateUpiSuccess = document.getElementById('btnSimulateUpiSuccess');
const btnSubmitOrder = document.getElementById('btnSubmitOrder');
const btnDirectUpiPay = document.getElementById('btnDirectUpiPay');

// Mobile Bottom Bar elements
const mobileBottomBar = document.getElementById('mobileBottomBar');
const mobileBottomPrice = document.getElementById('mobileBottomPrice');
const mobileBottomSheets = document.getElementById('mobileBottomSheets');
const btnMobileProceed = document.getElementById('btnMobileProceed');

// Visual Picker Modal elements
const visualPickerModal = document.getElementById('visualPickerModal');
const visualModalDocName = document.getElementById('visualModalDocName');
const visualPagesGrid = document.getElementById('visualPagesGrid');
const visualSelectedCount = document.getElementById('visualSelectedCount');
const visualTotalCount = document.getElementById('visualTotalCount');
const btnVisualSelectAll = document.getElementById('btnVisualSelectAll');
const btnVisualDeselectAll = document.getElementById('btnVisualDeselectAll');
const btnVisualSelectOdd = document.getElementById('btnVisualSelectOdd');
const btnVisualSelectEven = document.getElementById('btnVisualSelectEven');
const btnApplyVisualSelection = document.getElementById('btnApplyVisualSelection');
const btnCloseVisualPicker = document.getElementById('btnCloseVisualPicker');

// Modals
const btnOpenRates = document.getElementById('btnOpenRates');
const ratesModal = document.getElementById('ratesModal');
const btnCloseRatesModal = document.getElementById('btnCloseRatesModal');
const btnDismissRates = document.getElementById('btnDismissRates');
const ratesTableBody = document.getElementById('ratesTableBody');

const btnOpenTrack = document.getElementById('btnOpenTrack');
const trackModal = document.getElementById('trackModal');
const btnCloseTrackModal = document.getElementById('btnCloseTrackModal');
const btnSearchTrack = document.getElementById('btnSearchTrack');
const trackQueryInput = document.getElementById('trackQueryInput');
const trackSearchResults = document.getElementById('trackSearchResults');

// Initialize App
async function initApp() {
  setupEventListeners();
  await loadShopConfig();
}

// Load Rates & Shop Info from server
async function loadShopConfig() {
  try {
    const res = await fetch('/api/network-info');
    const data = await res.json();
    state.shopInfo = data.shop;
    if (upiIdDisplay && state.shopInfo.upiId) {
      upiIdDisplay.textContent = state.shopInfo.upiId;
    }

    const ratesRes = await fetch('/api/rates');
    const ratesData = await ratesRes.json();
    state.rates = ratesData.rates;
    renderRatesTable();
  } catch (err) {
    console.warn('Failed to load shop config, using defaults:', err);
  }
}

// Setup Event Listeners
function setupEventListeners() {
  // Dropzone drag & drop
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileSelect);

  ['dragenter', 'dragover'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length) uploadFiles(files);
  });

  // Step transition
  btnProceedToPayment.addEventListener('click', showPaymentStep);
  if (btnMobileProceed) btnMobileProceed.addEventListener('click', showPaymentStep);
  btnBackToFiles.addEventListener('click', showConfigureStep);

  // Payment Options Toggle
  optPaymentOnline.addEventListener('click', () => selectPaymentOption('online'));
  optPaymentShop.addEventListener('click', () => selectPaymentOption('shop'));

  // Mock UPI simulation
  btnSimulateUpiSuccess.addEventListener('click', () => {
    alert('Simulated UPI Payment Approved! Settle reference recorded.');
    state.simulatedUpiPaid = true;
    btnSimulateUpiSuccess.textContent = '✓ Simulated UPI Paid Successfully!';
    btnSimulateUpiSuccess.style.background = '#e6f4ea';
  });

  // Submit Order
  btnSubmitOrder.addEventListener('click', submitPrintOrder);

  // Visual Picker controls
  btnVisualSelectAll.addEventListener('click', visualSelectAll);
  btnVisualDeselectAll.addEventListener('click', visualDeselectAll);
  btnVisualSelectOdd.addEventListener('click', visualSelectOdd);
  btnVisualSelectEven.addEventListener('click', visualSelectEven);
  btnApplyVisualSelection.addEventListener('click', applyVisualSelection);
  btnCloseVisualPicker.addEventListener('click', closeVisualPickerModal);

  // Rate card modal
  btnOpenRates.addEventListener('click', () => ratesModal.classList.add('active'));
  btnCloseRatesModal.addEventListener('click', () => ratesModal.classList.remove('active'));
  btnDismissRates.addEventListener('click', () => ratesModal.classList.remove('active'));

  // Track order modal
  btnOpenTrack.addEventListener('click', () => trackModal.classList.add('active'));
  btnCloseTrackModal.addEventListener('click', () => trackModal.classList.remove('active'));
  btnSearchTrack.addEventListener('click', searchOrder);
  trackQueryInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchOrder(); });
}

// Handle File Selection
function handleFileSelect(e) {
  const files = e.target.files;
  if (files.length) uploadFiles(files);
}

// Upload Files to backend with no file size limit
async function uploadFiles(fileList) {
  const formData = new FormData();
  let validCount = 0;

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    const ext = file.name.split('.').pop().toLowerCase();
    if (['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) {
      formData.append('files', file);
      validCount++;
    }
  }

  if (validCount === 0) {
    alert('Please upload only PDF, JPEG, JPG, or PNG files.');
    return;
  }

  uploadSpinner.style.display = 'block';

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Upload failed');

    // Add newly uploaded files to state
    for (const file of data.files) {
      state.stagedFilenames.add(file.filename);
      state.documents.push({
        id: file.id,
        originalName: file.originalName,
        filename: file.filename,
        filePath: file.filePath,
        fileUrl: file.fileUrl,
        mimeType: file.mimeType,
        fileSize: file.fileSize,
        totalDocumentPages: file.pageCount || 1,
        paperType: 'A4',       // 'A4' | 'A3'
        colorMode: 'bw',       // 'bw' | 'color'
        sides: 'single',       // 'single' | 'duplex'
        pageRangeMode: 'all',  // 'all' | 'custom' | 'visual'
        customRangeText: '',
        selectedPages: Array.from({ length: file.pageCount || 1 }, (_, i) => i + 1),
        copies: 1
      });
    }

    renderDocuments();
    recalculateAllPrices();
    batchToolbar.style.display = state.documents.length > 1 ? 'flex' : 'none';
  } catch (err) {
    console.error('Upload error:', err);
    alert('File upload failed: ' + err.message);
  } finally {
    uploadSpinner.style.display = 'none';
    fileInput.value = '';
  }
}

// Render Document Items
function renderDocuments() {
  documentsList.innerHTML = '';

  state.documents.forEach((doc, idx) => {
    const isPdf = doc.originalName.toLowerCase().endsWith('.pdf');
    const extUpper = doc.originalName.split('.').pop().toUpperCase();
    const sizeKb = Math.round(doc.fileSize / 1024);
    const sizeStr = sizeKb > 1024 ? (sizeKb / 1024).toFixed(1) + ' MB' : sizeKb + ' KB';

    const card = document.createElement('div');
    card.className = 'document-item-card';
    card.id = `doc-card-${doc.id}`;

    card.innerHTML = `
      <div class="doc-header">
        <div class="doc-file-info">
          <div class="doc-thumb">
            ${isPdf ? 'PDF' : extUpper}
          </div>
          <div class="doc-title-box">
            <div class="doc-name" title="${doc.originalName}">${doc.originalName}</div>
            <div class="doc-meta">
              <span>${sizeStr}</span> • 
              <span class="doc-badge-pages">${doc.totalDocumentPages} ${doc.totalDocumentPages === 1 ? 'Page' : 'Pages'}</span>
            </div>
          </div>
        </div>

        <div>
          <button class="btn btn-outline btn-sm" onclick="removeDocument('${doc.id}')" title="Remove Document" style="color: #d93025;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Remove
          </button>
        </div>
      </div>

      <div class="doc-options-grid">
        <!-- 2.1 Paper Type A4 / A3 -->
        <div class="option-group">
          <label class="option-label">Paper Size</label>
          <div class="segment-control">
            <button class="segment-btn ${doc.paperType === 'A4' ? 'active' : ''}" onclick="updateDocOption('${doc.id}', 'paperType', 'A4')">A4</button>
            <button class="segment-btn ${doc.paperType === 'A3' ? 'active' : ''}" onclick="updateDocOption('${doc.id}', 'paperType', 'A3')">A3</button>
          </div>
        </div>

        <!-- 2.2 Color Option -->
        <div class="option-group">
          <label class="option-label">Print Color</label>
          <div class="segment-control">
            <button class="segment-btn ${doc.colorMode === 'bw' ? 'active' : ''}" onclick="updateDocOption('${doc.id}', 'colorMode', 'bw')">B & W</button>
            <button class="segment-btn ${doc.colorMode === 'color' ? 'active' : ''}" onclick="updateDocOption('${doc.id}', 'colorMode', 'color')">🎨 Color</button>
          </div>
        </div>

        <!-- 2.3 Single / Duplex Side -->
        <div class="option-group">
          <label class="option-label">Sides</label>
          <div class="segment-control">
            <button class="segment-btn ${doc.sides === 'single' ? 'active' : ''}" onclick="updateDocOption('${doc.id}', 'sides', 'single')">Single Side</button>
            <button class="segment-btn ${doc.sides === 'duplex' ? 'active' : ''}" onclick="updateDocOption('${doc.id}', 'sides', 'duplex')">Both Sides (Duplex)</button>
          </div>
        </div>

        <!-- 2.5 Number of Copies -->
        <div class="option-group">
          <label class="option-label">Copies</label>
          <div class="stepper-control">
            <button class="stepper-btn" onclick="stepCopies('${doc.id}', -1)">-</button>
            <input type="number" class="stepper-input" value="${doc.copies}" min="1" max="999" onchange="setCopies('${doc.id}', this.value)">
            <button class="stepper-btn" onclick="stepCopies('${doc.id}', 1)">+</button>
          </div>
        </div>

        <!-- 2.4 Page Range Selector -->
        <div class="range-picker-row">
          <div class="range-options">
            <span class="option-label" style="margin-right: 5px;">Pages:</span>
            
            <label class="range-radio-label">
              <input type="radio" name="rangeMode_${doc.id}" value="all" ${doc.pageRangeMode === 'all' ? 'checked' : ''} onchange="updateDocOption('${doc.id}', 'pageRangeMode', 'all')">
              All (${doc.totalDocumentPages})
            </label>

            <label class="range-radio-label">
              <input type="radio" name="rangeMode_${doc.id}" value="custom" ${doc.pageRangeMode === 'custom' ? 'checked' : ''} onchange="updateDocOption('${doc.id}', 'pageRangeMode', 'custom')">
              Custom Range:
            </label>

            <input type="text" class="range-custom-input" placeholder="e.g. 1-3, 5" value="${doc.customRangeText || ''}" onfocus="selectCustomMode('${doc.id}')" oninput="updateCustomRange('${doc.id}', this.value)">
          </div>

          <div>
            <button class="visual-picker-trigger-btn" onclick="openVisualPickerModal('${doc.id}')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m10 15 5-3-5-3v6Z"/></svg>
              ${doc.pageRangeMode === 'visual' ? `✓ Picked Visually (${doc.selectedPages.length} Pages)` : 'Pick Pages Visually'}
            </button>
          </div>
        </div>
      </div>

      <div class="doc-footer-summary">
        <div id="doc-calc-info-${doc.id}">
          Calculating...
        </div>
        <div class="doc-price-tag" id="doc-price-${doc.id}">
          ₹0.00
        </div>
      </div>
    `;

    documentsList.appendChild(card);
  });
}

// Remove document from queue & delete file from server
window.removeDocument = function(docId) {
  const doc = state.documents.find(d => d.id === docId);
  if (doc && doc.filename) {
    state.stagedFilenames.delete(doc.filename);
    fetch('/api/upload/cancel-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: doc.filename })
    }).catch(() => {});
  }
  state.documents = state.documents.filter(d => d.id !== docId);
  renderDocuments();
  recalculateAllPrices();
  batchToolbar.style.display = state.documents.length > 1 ? 'flex' : 'none';
};

// Update Document Option with "Apply for all Documents" support
window.updateDocOption = function(docId, key, value) {
  const targetDoc = state.documents.find(d => d.id === docId);
  if (!targetDoc) return;

  targetDoc[key] = value;

  // If "Apply for all Documents" is checked, update all files!
  if (chkApplyAll.checked) {
    state.documents.forEach(doc => {
      doc[key] = value;
    });
  }

  renderDocuments();
  recalculateAllPrices();
};

window.stepCopies = function(docId, delta) {
  const doc = state.documents.find(d => d.id === docId);
  if (!doc) return;
  const newCopies = Math.max(1, (doc.copies || 1) + delta);
  updateDocOption(docId, 'copies', newCopies);
};

window.setCopies = function(docId, val) {
  const parsed = parseInt(val, 10);
  const newCopies = isNaN(parsed) || parsed < 1 ? 1 : parsed;
  updateDocOption(docId, 'copies', newCopies);
};

window.selectCustomMode = function(docId) {
  const doc = state.documents.find(d => d.id === docId);
  if (doc && doc.pageRangeMode !== 'custom') {
    doc.pageRangeMode = 'custom';
    renderDocuments();
    recalculateAllPrices();
  }
};

window.updateCustomRange = function(docId, text) {
  const doc = state.documents.find(d => d.id === docId);
  if (!doc) return;
  doc.customRangeText = text;
  doc.pageRangeMode = 'custom';
  doc.selectedPages = parsePageRange(text, doc.totalDocumentPages);
  recalculateAllPrices();
};

// Parse range text helper
function parsePageRange(rangeStr, totalPages) {
  if (!rangeStr || !rangeStr.trim()) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = new Set();
  const parts = rangeStr.split(',');
  for (let part of parts) {
    part = part.trim();
    if (!part) continue;
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end)) {
        const from = Math.max(1, Math.min(start, end));
        const to = Math.min(totalPages, Math.max(start, end));
        for (let p = from; p <= to; p++) pages.add(p);
      }
    } else {
      const p = parseInt(part, 10);
      if (!isNaN(p) && p >= 1 && p <= totalPages) pages.add(p);
    }
  }
  const res = Array.from(pages).sort((a, b) => a - b);
  return res.length > 0 ? res : Array.from({ length: totalPages }, (_, i) => i + 1);
}

// Visual Page Picker Modal logic
window.openVisualPickerModal = async function(docId) {
  const doc = state.documents.find(d => d.id === docId);
  if (!doc) return;

  state.activeVisualDocId = docId;
  state.tempVisualSelectedPages = new Set(doc.selectedPages);

  visualModalDocName.textContent = doc.originalName;
  visualTotalCount.textContent = doc.totalDocumentPages;
  visualSelectedCount.textContent = state.tempVisualSelectedPages.size;

  visualPagesGrid.innerHTML = '<div style="padding: 2rem; color: #5f6368; text-align: center; width: 100%;">Rendering page thumbnails...</div>';
  visualPickerModal.classList.add('active');

  const isPdf = doc.originalName.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    try {
      const loadingTask = pdfjsLib.getDocument(doc.fileUrl);
      const pdf = await loadingTask.promise;
      visualPagesGrid.innerHTML = '';

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const pageCard = document.createElement('div');
        pageCard.className = `page-card ${state.tempVisualSelectedPages.has(pageNum) ? 'selected' : ''}`;
        pageCard.id = `visual-page-${pageNum}`;
        pageCard.onclick = () => toggleVisualPage(pageNum);

        const canvasWrapper = document.createElement('div');
        canvasWrapper.className = 'page-canvas-wrapper';

        const canvas = document.createElement('canvas');
        canvasWrapper.appendChild(canvas);

        const footer = document.createElement('div');
        footer.className = 'page-card-footer';
        footer.innerHTML = `
          <span>Page ${pageNum}</span>
          <div class="page-check-indicator">✓</div>
        `;

        pageCard.appendChild(canvasWrapper);
        pageCard.appendChild(footer);
        visualPagesGrid.appendChild(pageCard);

        // Render page thumbnail onto canvas
        renderPdfPageToCanvas(pdf, pageNum, canvas);
      }
    } catch (e) {
      console.error('Error rendering PDF pages:', e);
      visualPagesGrid.innerHTML = '<div style="color: red; padding: 1rem;">Could not render PDF preview.</div>';
    }
  } else {
    // Image file (1 page)
    visualPagesGrid.innerHTML = `
      <div class="page-card selected" onclick="toggleVisualPage(1)" style="max-width: 200px; margin: 0 auto;">
        <div class="page-canvas-wrapper">
          <img src="${doc.fileUrl}" alt="Photo">
        </div>
        <div class="page-card-footer">
          <span>Full Image</span>
          <div class="page-check-indicator">✓</div>
        </div>
      </div>
    `;
    state.tempVisualSelectedPages = new Set([1]);
    visualSelectedCount.textContent = 1;
  }
};

async function renderPdfPageToCanvas(pdf, pageNum, canvas) {
  try {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 0.35 });
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
  } catch (err) {
    console.warn(`Failed to render page ${pageNum}:`, err);
  }
}

function toggleVisualPage(pageNum) {
  if (state.tempVisualSelectedPages.has(pageNum)) {
    state.tempVisualSelectedPages.delete(pageNum);
  } else {
    state.tempVisualSelectedPages.add(pageNum);
  }

  const card = document.getElementById(`visual-page-${pageNum}`);
  if (card) {
    card.classList.toggle('selected', state.tempVisualSelectedPages.has(pageNum));
  }
  visualSelectedCount.textContent = state.tempVisualSelectedPages.size;
}

function visualSelectAll() {
  const doc = state.documents.find(d => d.id === state.activeVisualDocId);
  if (!doc) return;
  for (let p = 1; p <= doc.totalDocumentPages; p++) {
    state.tempVisualSelectedPages.add(p);
    const c = document.getElementById(`visual-page-${p}`);
    if (c) c.classList.add('selected');
  }
  visualSelectedCount.textContent = state.tempVisualSelectedPages.size;
}

function visualDeselectAll() {
  state.tempVisualSelectedPages.clear();
  const doc = state.documents.find(d => d.id === state.activeVisualDocId);
  if (!doc) return;
  for (let p = 1; p <= doc.totalDocumentPages; p++) {
    const c = document.getElementById(`visual-page-${p}`);
    if (c) c.classList.remove('selected');
  }
  visualSelectedCount.textContent = 0;
}

function visualSelectOdd() {
  visualDeselectAll();
  const doc = state.documents.find(d => d.id === state.activeVisualDocId);
  if (!doc) return;
  for (let p = 1; p <= doc.totalDocumentPages; p += 2) {
    state.tempVisualSelectedPages.add(p);
    const c = document.getElementById(`visual-page-${p}`);
    if (c) c.classList.add('selected');
  }
  visualSelectedCount.textContent = state.tempVisualSelectedPages.size;
}

function visualSelectEven() {
  visualDeselectAll();
  const doc = state.documents.find(d => d.id === state.activeVisualDocId);
  if (!doc) return;
  for (let p = 2; p <= doc.totalDocumentPages; p += 2) {
    state.tempVisualSelectedPages.add(p);
    const c = document.getElementById(`visual-page-${p}`);
    if (c) c.classList.add('selected');
  }
  visualSelectedCount.textContent = state.tempVisualSelectedPages.size;
}

function applyVisualSelection() {
  const doc = state.documents.find(d => d.id === state.activeVisualDocId);
  if (!doc) return;

  const selectedArray = Array.from(state.tempVisualSelectedPages).sort((a, b) => a - b);
  if (selectedArray.length === 0) {
    alert('Please select at least one page to print.');
    return;
  }

  doc.selectedPages = selectedArray;
  doc.pageRangeMode = 'visual';

  closeVisualPickerModal();
  renderDocuments();
  recalculateAllPrices();
}

function closeVisualPickerModal() {
  visualPickerModal.classList.remove('active');
  state.activeVisualDocId = null;
}

// Price Calculation
function calculateDocPrice(doc) {
  if (!state.rates) return { subtotal: 0, pages: 1, sheets: 1, unitRate: 0 };

  const paper = doc.paperType || 'A4';
  const color = doc.colorMode || 'bw';
  const isDuplex = doc.sides === 'duplex';
  const copies = parseInt(doc.copies, 10) || 1;

  let pageCount = 1;
  if (doc.pageRangeMode === 'all') {
    pageCount = doc.totalDocumentPages;
  } else {
    pageCount = (doc.selectedPages && doc.selectedPages.length) || 1;
  }

  const paperRates = state.rates[paper] || { bw: { single: 2, duplex: 3 }, color: { single: 10, duplex: 18 } };
  const modeRates = paperRates[color] || { single: 2, duplex: 3 };

  let sheets = pageCount;
  let unitRate = 0;

  if (isDuplex) {
    sheets = Math.ceil(pageCount / 2);
    unitRate = modeRates.duplex; // duplex rate is per physical sheet
  } else {
    unitRate = modeRates.single; // single rate is per page/sheet
  }

  const subtotal = sheets * unitRate * copies;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    pages: pageCount * copies,
    sheets: sheets * copies,
    unitRate,
    singleDocPages: pageCount,
    singleDocSheets: sheets
  };
}

function recalculateAllPrices() {
  let grandTotal = 0;
  let grandPages = 0;
  let grandSheets = 0;

  summaryItemsList.innerHTML = '';

  state.documents.forEach(doc => {
    const calc = calculateDocPrice(doc);
    grandTotal += calc.subtotal;
    grandPages += calc.pages;
    grandSheets += calc.sheets;

    // Update document card badge
    const infoEl = document.getElementById(`doc-calc-info-${doc.id}`);
    const priceEl = document.getElementById(`doc-price-${doc.id}`);

    if (infoEl) {
      infoEl.innerHTML = `
        <strong>${calc.singleDocPages}</strong> pgs • 
        <strong>${calc.singleDocSheets}</strong> ${doc.paperType} sheets • 
        ${doc.copies} ${doc.copies === 1 ? 'copy' : 'copies'} 
        (@ ₹${calc.unitRate.toFixed(2)}/${doc.sides === 'duplex' ? 'sheet' : 'pg'})
      `;
    }
    if (priceEl) {
      priceEl.textContent = `₹${calc.subtotal.toFixed(2)}`;
    }

    // Add item row to summary
    const itemRow = document.createElement('div');
    itemRow.className = 'summary-item-row';
    itemRow.innerHTML = `
      <div class="summary-item-name" title="${doc.originalName}">
        ${doc.originalName} (${doc.paperType} ${doc.colorMode.toUpperCase()} ${doc.sides === 'duplex' ? 'Duplex' : 'Single'})
      </div>
      <strong>₹${calc.subtotal.toFixed(2)}</strong>
    `;
    summaryItemsList.appendChild(itemRow);
  });

  if (state.documents.length === 0) {
    summaryItemsList.innerHTML = `
      <p style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 1.5rem 0;">
        No files uploaded yet. Drag & drop your PDF or photos on the left!
      </p>
    `;
  }

  summaryDocCountBadge.textContent = `${state.documents.length} ${state.documents.length === 1 ? 'File' : 'Files'}`;
  summaryTotalPages.textContent = grandPages;
  summaryTotalSheets.textContent = grandSheets;
  summaryGrandTotal.textContent = `₹${grandTotal.toFixed(2)}`;
  checkoutTotalDisplay.textContent = `₹${grandTotal.toFixed(2)}`;
  upiAmountTag.textContent = `₹${grandTotal.toFixed(2)}`;

  btnProceedToPayment.disabled = state.documents.length === 0;
  state.grandTotal = grandTotal;

  // Update Mobile Floating Bottom Bar
  if (mobileBottomBar) {
    if (state.documents.length > 0 && stepConfigure.style.display !== 'none') {
      mobileBottomBar.style.display = 'flex';
      if (mobileBottomPrice) mobileBottomPrice.textContent = `₹${grandTotal.toFixed(2)}`;
      if (mobileBottomSheets) {
        const fileWord = state.documents.length === 1 ? 'file' : 'files';
        const sheetWord = grandSheets === 1 ? 'sheet' : 'sheets';
        mobileBottomSheets.textContent = `${state.documents.length} ${fileWord} • ${grandSheets} ${sheetWord}`;
      }
    } else {
      mobileBottomBar.style.display = 'none';
    }
  }
}

// Step Navigation
function showPaymentStep() {
  if (state.documents.length === 0) return;
  stepConfigure.style.display = 'none';
  stepPayment.style.display = 'block';
  if (mobileBottomBar) mobileBottomBar.style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  generateUpiQr();
}

function showConfigureStep() {
  stepPayment.style.display = 'none';
  stepConfigure.style.display = 'block';
  if (mobileBottomBar && state.documents.length > 0) {
    mobileBottomBar.style.display = 'flex';
  }
}

function selectPaymentOption(option) {
  state.selectedPayment = option;
  if (option === 'online') {
    optPaymentOnline.classList.add('selected');
    optPaymentShop.classList.remove('selected');
    upiQrSection.style.display = 'block';
    generateUpiQr();
  } else {
    optPaymentShop.classList.add('selected');
    optPaymentOnline.classList.remove('selected');
    upiQrSection.style.display = 'none';
  }
}

// Generate Dynamic UPI QR Code
function generateUpiQr() {
  if (!window.QRCode) return;
  upiQrCodeContainer.innerHTML = '';

  const upiId = (state.shopInfo && state.shopInfo.upiId) || 'paytm.s45iush@pty';
  const shopName = (state.shopInfo && state.shopInfo.name) || 'Copycat Copiers';
  const amount = (state.grandTotal || 0).toFixed(2);

  // Update visible amount tag and ID display
  if (upiAmountTag) {
    upiAmountTag.textContent = `₹${amount}`;
  }
  if (upiIdDisplay) {
    upiIdDisplay.textContent = upiId;
  }

  // UPI standard intent URI with exact order amount and merchant UPI ID
  const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(shopName)}&am=${amount}&cu=INR&tn=${encodeURIComponent('Print Order')}`;

  if (btnDirectUpiPay) {
    btnDirectUpiPay.href = upiUri;
  }

  new QRCode(upiQrCodeContainer, {
    text: upiUri,
    width: 170,
    height: 170,
    colorDark: "#202124",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M
  });
}

// Submit Print Order
async function submitPrintOrder() {
  const name = custName.value.trim();
  const phone = custPhone.value.trim();

  if (!name) {
    alert('Please enter your name.');
    custName.focus();
    return;
  }
  if (!phone || phone.length < 10) {
    alert('Please enter a valid 10-digit mobile number.');
    custPhone.focus();
    return;
  }

  const paymentMethod = optPaymentOnline.classList.contains('selected') ? 'online' : 'shop';

  btnSubmitOrder.disabled = true;
  btnSubmitOrder.textContent = 'Submitting order...';

  const payload = {
    customer: { name, phone },
    paymentMethod,
    paymentStatus: paymentMethod === 'online' ? 'completed' : 'pending_at_shop',
    paymentRef: paymentMethod === 'online' ? `UPI-${Date.now().toString().slice(-6)}` : 'Pay at Shop Counter',
    documents: state.documents.map(doc => ({
      id: doc.id,
      originalName: doc.originalName,
      filePath: doc.filePath,
      mimeType: doc.mimeType,
      fileSize: doc.fileSize,
      paperType: doc.paperType,
      colorMode: doc.colorMode,
      sides: doc.sides,
      pageRangeMode: doc.pageRangeMode,
      customRangeText: doc.customRangeText,
      selectedPages: doc.selectedPages,
      totalDocumentPages: doc.totalDocumentPages,
      copies: doc.copies
    }))
  };

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Order creation failed');

    // Mark as submitted so beforeunload/pagehide does not purge files
    state.orderSubmitted = true;
    state.stagedFilenames.clear();

    // Redirect to Live Order Tracking
    window.location.href = `track.html?id=${data.order.id}`;
  } catch (err) {
    console.error('Submit order error:', err);
    alert('Could not submit order: ' + err.message);
    btnSubmitOrder.disabled = false;
    btnSubmitOrder.textContent = 'Submit & Start Printing';
  }
}

// Render Rate Card Table
function renderRatesTable() {
  if (!state.rates || !ratesTableBody) return;
  ratesTableBody.innerHTML = `
    <tr>
      <td><strong>A4</strong></td>
      <td>Black & White</td>
      <td>Single Side</td>
      <td><strong>₹${state.rates.A4.bw.single.toFixed(2)}</strong> / page</td>
    </tr>
    <tr>
      <td><strong>A4</strong></td>
      <td>Black & White</td>
      <td>Front & Back (Duplex)</td>
      <td><strong>₹${state.rates.A4.bw.duplex.toFixed(2)}</strong> / sheet</td>
    </tr>
    <tr>
      <td><strong>A4</strong></td>
      <td>Color</td>
      <td>Single Side</td>
      <td><strong>₹${state.rates.A4.color.single.toFixed(2)}</strong> / page</td>
    </tr>
    <tr>
      <td><strong>A4</strong></td>
      <td>Color</td>
      <td>Front & Back (Duplex)</td>
      <td><strong>₹${state.rates.A4.color.duplex.toFixed(2)}</strong> / sheet</td>
    </tr>
    <tr>
      <td><strong>A3</strong></td>
      <td>Black & White</td>
      <td>Single Side</td>
      <td><strong>₹${state.rates.A3.bw.single.toFixed(2)}</strong> / page</td>
    </tr>
    <tr>
      <td><strong>A3</strong></td>
      <td>Black & White</td>
      <td>Front & Back (Duplex)</td>
      <td><strong>₹${state.rates.A3.bw.duplex.toFixed(2)}</strong> / sheet</td>
    </tr>
    <tr>
      <td><strong>A3</strong></td>
      <td>Color</td>
      <td>Single Side</td>
      <td><strong>₹${state.rates.A3.color.single.toFixed(2)}</strong> / page</td>
    </tr>
    <tr>
      <td><strong>A3</strong></td>
      <td>Color</td>
      <td>Front & Back (Duplex)</td>
      <td><strong>₹${state.rates.A3.color.duplex.toFixed(2)}</strong> / sheet</td>
    </tr>
  `;
}

// Search Order Lookup
async function searchOrder() {
  const query = trackQueryInput.value.trim();
  if (!query) return;

  trackSearchResults.innerHTML = '<p style="font-size: 0.85rem; color: #5f6368;">Searching orders...</p>';

  try {
    const res = await fetch(`/api/orders/track-lookup/${encodeURIComponent(query)}`);
    const data = await res.json();

    if (!data.orders || data.orders.length === 0) {
      trackSearchResults.innerHTML = '<p style="color: #d93025; font-size: 0.85rem;">No active order found with that ID or Phone number.</p>';
      return;
    }

    trackSearchResults.innerHTML = data.orders.map(o => `
      <div style="background: #f8f9fa; border: 1px solid var(--border-light); border-radius: 8px; padding: 0.75rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong>${o.id}</strong> - ${o.customer.name}
          <div style="font-size: 0.75rem; color: var(--text-muted);">${o.documents.length} doc(s) • ₹${o.summary.totalAmount.toFixed(2)} • Status: ${o.status.replace('_', ' ')}</div>
        </div>
        <a href="track.html?id=${o.id}" class="btn btn-primary btn-sm">View Live</a>
      </div>
    `).join('');
  } catch (e) {
    trackSearchResults.innerHTML = '<p style="color: red;">Search error: ' + e.message + '</p>';
  }
}

// Window Close / Refresh Cleanup
function handleWindowAbandon() {
  if (state.orderSubmitted) return;
  if (!state.stagedFilenames || state.stagedFilenames.size === 0) return;

  const filenames = Array.from(state.stagedFilenames);
  const payload = JSON.stringify({ filenames });

  if (navigator.sendBeacon) {
    const blob = new Blob([payload], { type: 'application/json' });
    navigator.sendBeacon('/api/upload/abandon-session', blob);
  } else {
    fetch('/api/upload/abandon-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true
    }).catch(() => {});
  }
}

window.addEventListener('beforeunload', handleWindowAbandon);
window.addEventListener('pagehide', handleWindowAbandon);

// Start
initApp();
