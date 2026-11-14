const urlParams = new URLSearchParams(window.location.search);
const orderId = urlParams.get('id');

const trackOrderIdDisplay = document.getElementById('trackOrderIdDisplay');
const trackCustomerInfo = document.getElementById('trackCustomerInfo');
const trackStatusBadge = document.getElementById('trackStatusBadge');
const trackLiveSocketBadge = document.getElementById('trackLiveSocketBadge');
const stepperProgressBar = document.getElementById('stepperProgressBar');
const trackLiveMessageBanner = document.getElementById('trackLiveMessageBanner');
const trackBannerTitle = document.getElementById('trackBannerTitle');
const trackBannerDesc = document.getElementById('trackBannerDesc');
const trackDocumentsList = document.getElementById('trackDocumentsList');
const trackSheetsSummary = document.getElementById('trackSheetsSummary');
const trackPaymentMethodNote = document.getElementById('trackPaymentMethodNote');
const trackGrandTotalDisplay = document.getElementById('trackGrandTotalDisplay');

// Ready notification modal & banner elements
const customerReadyModal = document.getElementById('customerReadyModal');
const customerReadyDesc = document.getElementById('customerReadyDesc');
const customerReadyPaymentNote = document.getElementById('customerReadyPaymentNote');
const btnCloseReadyModal = document.getElementById('btnCloseReadyModal');
const customerNotifBanner = document.getElementById('customerNotifBanner');
const btnEnableCustomerNotif = document.getElementById('btnEnableCustomerNotif');

let currentOrder = null;
let pollInterval = null;
let hasNotifiedReady = false;
let titleFlashTimer = null;
const originalDocTitle = document.title;

// Web Audio Context for Customer Celebration Chime
let customerAudioCtx = null;
function getCustomerAudioContext() {
  if (!customerAudioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      customerAudioCtx = new AudioContextClass();
    }
  }
  if (customerAudioCtx && customerAudioCtx.state === 'suspended') {
    customerAudioCtx.resume().catch(() => {});
  }
  return customerAudioCtx;
}

// Unlock audio on any touch/click
window.addEventListener('click', () => getCustomerAudioContext(), { once: false });
window.addEventListener('touchstart', () => getCustomerAudioContext(), { once: false });

if (!orderId) {
  trackOrderIdDisplay.textContent = 'Order ID Missing';
  trackCustomerInfo.textContent = 'Please provide a valid Order ID in the URL, e.g. track.html?id=CC-1001';
} else {
  trackOrderIdDisplay.textContent = orderId;
  initTracking();
}

function initTracking() {
  setupCustomerNotifications();
  fetchOrderDetails();
  setupWebSocket();
  // Fallback poll every 3 seconds
  pollInterval = setInterval(fetchOrderDetails, 3000);

  if (btnCloseReadyModal) {
    btnCloseReadyModal.onclick = () => {
      customerReadyModal.classList.remove('active');
      stopTitleFlash();
    };
  }
}

// Notification Permissions Prompt
function setupCustomerNotifications() {
  if (!customerNotifBanner || !btnEnableCustomerNotif) return;

  if ('Notification' in window) {
    if (Notification.permission === 'default') {
      customerNotifBanner.style.display = 'flex';
      btnEnableCustomerNotif.onclick = async () => {
        getCustomerAudioContext();
        try {
          const perm = await Notification.requestPermission();
          if (perm === 'granted') {
            customerNotifBanner.innerHTML = `
              <div style="display: flex; align-items: center; gap: 8px; font-size: 0.88rem; color: #137333; font-weight: 600;">
                <span>✓</span>
                <span>Push notifications enabled! We'll alert you the instant your print finishes.</span>
              </div>
            `;
            setTimeout(() => {
              customerNotifBanner.style.display = 'none';
            }, 3500);
          } else {
            customerNotifBanner.style.display = 'none';
          }
        } catch (e) {
          customerNotifBanner.style.display = 'none';
        }
      };
    } else {
      customerNotifBanner.style.display = 'none';
    }
  }
}

async function fetchOrderDetails() {
  try {
    const res = await fetch(`/api/orders/${orderId}`);
    if (!res.ok) throw new Error('Order not found');
    const order = await res.json();
    currentOrder = order;
    renderOrderTracking(order);
  } catch (e) {
    console.warn('Could not fetch order:', e);
  }
}

function setupWebSocket() {
  try {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ action: 'join', room: `order:${orderId}` }));
      if (trackLiveSocketBadge) {
        trackLiveSocketBadge.textContent = '● Live Real-Time Connection Active';
        trackLiveSocketBadge.style.color = '#188038';
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.event === 'ORDER_STATUS_CHANGED' && (msg.payload.orderId === orderId || msg.payload.id === orderId)) {
          fetchOrderDetails();
        }
      } catch (err) {}
    };

    ws.onclose = () => {
      if (trackLiveSocketBadge) {
        trackLiveSocketBadge.textContent = '○ Live Polling Fallback';
        trackLiveSocketBadge.style.color = '#e37400';
      }
    };
  } catch (err) {
    console.warn('WebSocket init warning:', err);
  }
}

// Audio Chime when Printing is Completed
function playPickupCelebrationChime() {
  try {
    const audioCtx = getCustomerAudioContext();
    if (!audioCtx) return;

    const playTone = (freq, startTime, duration, vol = 0.28) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(vol, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const now = audioCtx.currentTime;
    // Celebratory 4-tone ascending major chord (C5 -> E5 -> G5 -> C6)
    playTone(523.25, now, 0.40, 0.25);        // C5
    playTone(659.25, now + 0.15, 0.45, 0.28);  // E5
    playTone(783.99, now + 0.30, 0.50, 0.32);  // G5
    playTone(1046.50, now + 0.48, 0.95, 0.38); // C6
  } catch (e) {
    console.warn('Customer chime error:', e);
  }
}

// Browser / Phone Push Notification
function triggerCustomerPushNotification(order) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try {
      new Notification('🎉 Your Prints are Ready for Pickup!', {
        body: `Order #${order.id} is finished! Please collect your prints at Counter 1.`,
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2334A853"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>',
        tag: `ready-${order.id}`,
        requireInteraction: true
      });
    } catch (e) {}
  }
}

// Flashing title alert on the browser tab
function startTitleFlash() {
  if (titleFlashTimer) return;
  let toggle = false;
  titleFlashTimer = setInterval(() => {
    document.title = toggle ? '🎉 PRINTS READY! - Copycat Copiers' : '🔔 COLLECT AT COUNTER 1';
    toggle = !toggle;
  }, 1000);
}

function stopTitleFlash() {
  if (titleFlashTimer) {
    clearInterval(titleFlashTimer);
    titleFlashTimer = null;
    document.title = originalDocTitle;
  }
}

window.addEventListener('focus', () => {
  stopTitleFlash();
});

function renderOrderTracking(order) {
  trackOrderIdDisplay.textContent = order.id;
  trackCustomerInfo.textContent = `Customer: ${order.customer.name} • ${order.customer.phone} • Placed: ${new Date(order.createdAt).toLocaleTimeString()}`;

  // Update Status Badge
  trackStatusBadge.className = `status-badge ${order.status}`;
  let statusText = order.status.replace(/_/g, ' ');
  if (order.status === 'ready_for_pickup') statusText = 'Ready for Pickup';
  trackStatusBadge.textContent = statusText;

  // Stepper State Logic
  const step1 = document.getElementById('step-node-1');
  const step2 = document.getElementById('step-node-2');
  const step3 = document.getElementById('step-node-3');
  const step4 = document.getElementById('step-node-4');
  const step5 = document.getElementById('step-node-5');

  // Reset classes
  [step1, step2, step3, step4, step5].forEach(el => {
    el.className = 'timeline-step';
  });

  step1.classList.add('completed');

  const isPaid = order.paymentStatus === 'completed' || order.paymentMethod === 'online';

  if (order.status === 'pending_approval') {
    if (isPaid) {
      step2.classList.add('completed');
      step3.classList.add('active');
      stepperProgressBar.style.width = '50%';
      trackBannerTitle.textContent = 'Payment Received • Waiting for Shop Approval';
      trackBannerDesc.textContent = 'Your order is queued in the Copycat Copiers spooler. The operator is reviewing your print options to dispatch to the copier.';
      trackLiveMessageBanner.style.borderColor = '#4285F4';
      trackLiveMessageBanner.style.background = '#e8f0fe';
    } else {
      step2.classList.add('active');
      stepperProgressBar.style.width = '30%';
      trackBannerTitle.textContent = 'Order Placed • Pay at Shop Counter';
      trackBannerDesc.textContent = 'Please let the operator know your Order ID. You can pay with Cash or UPI upon collecting your prints.';
      trackLiveMessageBanner.style.borderColor = '#FBBC05';
      trackLiveMessageBanner.style.background = '#fef7e0';
    }
  } else if (order.status === 'printing') {
    step1.classList.add('completed');
    step2.classList.add('completed');
    step3.classList.add('completed');
    step4.classList.add('active');
    stepperProgressBar.style.width = '75%';

    const printerName = order.assignedPrinter || 'Commercial Laser Copier';
    trackBannerTitle.textContent = `🖨️ Printing in Progress on ${printerName}!`;
    trackBannerDesc.textContent = 'Your documents are currently being printed by our high-speed commercial printers. Please be ready at Counter 1.';
    trackLiveMessageBanner.style.borderColor = '#4285F4';
    trackLiveMessageBanner.style.background = '#e8f0fe';
  } else if (order.status === 'ready_for_pickup') {
    step1.classList.add('completed');
    step2.classList.add('completed');
    step3.classList.add('completed');
    step4.classList.add('completed');
    step5.classList.add('active');
    step5.classList.add('step-node-ready-flash');
    stepperProgressBar.style.width = '100%';

    trackBannerTitle.textContent = '🎉 Your Prints are Ready for Pickup!';
    trackBannerDesc.textContent = `Please collect your printed copies from Counter 1. Order ID: ${order.id}. Thank you for choosing Copycat Copiers!`;
    trackLiveMessageBanner.style.borderColor = '#34A853';
    trackLiveMessageBanner.style.background = '#e6f4ea';

    // TRIGGER CELEBRATION NOTIFICATIONS (ONLY ONCE)
    if (!hasNotifiedReady) {
      hasNotifiedReady = true;

      // 1. Play Joyful Celebration Chime
      playPickupCelebrationChime();

      // 2. Mobile Vibration Haptics
      if (navigator.vibrate) {
        try {
          navigator.vibrate([250, 100, 250, 100, 450]);
        } catch (e) {}
      }

      // 3. Browser Push Notification
      triggerCustomerPushNotification(order);

      // 4. Tab Title Alert Flashing
      startTitleFlash();

      // 5. Open Celebration Modal Popup
      if (customerReadyModal) {
        if (customerReadyDesc) {
          customerReadyDesc.innerHTML = `Order <strong>#${order.id}</strong> has finished printing successfully on our high-speed commercial copiers. Please walk over to <strong>Counter 1</strong> to collect your documents.`;
        }
        if (customerReadyPaymentNote) {
          const payStr = (order.paymentStatus === 'completed' || order.paymentMethod === 'online')
            ? `✓ Payment Settled Online: ₹${order.summary.totalAmount.toFixed(2)}`
            : `Cash / UPI Payable at Counter: ₹${order.summary.totalAmount.toFixed(2)}`;
          customerReadyPaymentNote.innerHTML = `Order ID: <strong>#${order.id}</strong> • ${payStr}`;
        }
        customerReadyModal.classList.add('active');
      }
    }
  } else if (order.status === 'completed') {
    step1.classList.add('completed');
    step2.classList.add('completed');
    step3.classList.add('completed');
    step4.classList.add('completed');
    step5.classList.add('completed');
    stepperProgressBar.style.width = '100%';

    trackBannerTitle.textContent = '✓ Order Collected';
    trackBannerDesc.textContent = 'This order has been completed and collected. Have a great day!';
    trackLiveMessageBanner.style.borderColor = '#5f6368';
    trackLiveMessageBanner.style.background = '#f1f3f4';
  }

  // Render Documents List
  trackDocumentsList.innerHTML = order.documents.map((doc, idx) => {
    const isDuplex = doc.sides === 'duplex';
    const isColor = doc.colorMode === 'color';
    return `
      <div style="background: #f8f9fa; border: 1px solid var(--border-light); border-radius: 8px; padding: 0.85rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <strong style="color: #202124;">${doc.originalName}</strong>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.2rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <span class="hero-pill" style="font-size: 0.72rem; padding: 1px 6px;">${doc.paperType}</span>
            <span class="hero-pill" style="font-size: 0.72rem; padding: 1px 6px; ${isColor ? 'color: #ea4335;' : ''}">${isColor ? 'Color' : 'B&W'}</span>
            <span class="hero-pill" style="font-size: 0.72rem; padding: 1px 6px;">${isDuplex ? 'Duplex (Front & Back)' : 'Single Sided'}</span>
            <span class="hero-pill" style="font-size: 0.72rem; padding: 1px 6px;">${doc.copies} ${doc.copies === 1 ? 'copy' : 'copies'}</span>
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-weight: 700; color: #188038;">₹${doc.pricing?.subtotal?.toFixed(2) || '0.00'}</div>
          <div style="font-size: 0.72rem; color: var(--text-muted);">${doc.pricing?.sheets || 1} sheet(s)</div>
        </div>
      </div>
    `;
  }).join('');

  trackSheetsSummary.textContent = `Total: ${order.summary.totalPages} pages (${order.summary.totalSheets} physical paper sheets)`;
  trackPaymentMethodNote.textContent = `Payment: ${order.paymentMethod === 'online' ? 'Online UPI' : 'Pay at Shop Counter'} (${order.paymentStatus})`;
  trackGrandTotalDisplay.textContent = `₹${order.summary.totalAmount.toFixed(2)}`;
}
