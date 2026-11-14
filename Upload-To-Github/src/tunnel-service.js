const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const CLOUDFLARED_BIN = path.join(__dirname, '..', 'bin', 'cloudflared.exe');

let tunnelProcess = null;
let activePublicUrl = null;
let isStopping = false;
let restartTimeout = null;
let urlCallback = null;

/**
 * Returns current public tunnel URL (or null if not yet established)
 */
function getPublicUrl() {
  return activePublicUrl;
}

/**
 * Starts the Cloudflare Tunnel to expose local port to the public internet
 */
function startTunnel(port = 3005, onUrlDiscovered = null) {
  if (onUrlDiscovered) {
    urlCallback = onUrlDiscovered;
  }

  if (!fs.existsSync(CLOUDFLARED_BIN)) {
    console.warn(`[TunnelService] cloudflared binary not found at ${CLOUDFLARED_BIN}. Public tunneling inactive.`);
    return;
  }

  if (tunnelProcess) {
    console.log('[TunnelService] Tunnel process already running.');
    return;
  }

  isStopping = false;
  console.log(`[TunnelService] Initializing Cloudflare Public Tunnel for port ${port}...`);

  try {
    tunnelProcess = spawn(
      CLOUDFLARED_BIN,
      ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    const handleData = (chunk) => {
      const text = chunk.toString();
      // Search for *.trycloudflare.com url in logs
      const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match && match[0]) {
        const foundUrl = match[0];
        if (foundUrl !== activePublicUrl) {
          activePublicUrl = foundUrl;
          console.log('\n==========================================================');
          console.log('  🌐 PUBLIC CLOUDFLARE HTTPS TUNNEL IS ACTIVE!');
          console.log('  Access From Anywhere in the World (Mobile/Broadband):');
          console.log(`  👉 ${activePublicUrl}`);
          console.log('==========================================================\n');

          if (urlCallback) {
            try {
              urlCallback(activePublicUrl);
            } catch (cbErr) {
              console.warn('[TunnelService] Callback error:', cbErr.message);
            }
          }
        }
      }
    };

    tunnelProcess.stdout.on('data', handleData);
    tunnelProcess.stderr.on('data', handleData);

    tunnelProcess.on('error', (err) => {
      console.warn('[TunnelService] Failed to spawn cloudflared:', err.message);
      tunnelProcess = null;
    });

    tunnelProcess.on('close', (code) => {
      console.log(`[TunnelService] Tunnel process exited (code: ${code}).`);
      tunnelProcess = null;
      activePublicUrl = null;

      if (!isStopping) {
        console.log('[TunnelService] Reconnecting public tunnel in 5 seconds...');
        clearTimeout(restartTimeout);
        restartTimeout = setTimeout(() => {
          startTunnel(port, urlCallback);
        }, 5000);
      }
    });

  } catch (err) {
    console.error('[TunnelService] Error starting tunnel:', err.message);
  }
}

/**
 * Stops the tunnel process cleanly
 */
function stopTunnel() {
  isStopping = true;
  clearTimeout(restartTimeout);
  if (tunnelProcess) {
    console.log('[TunnelService] Stopping tunnel process...');
    try {
      tunnelProcess.kill('SIGTERM');
    } catch (e) {}
    tunnelProcess = null;
  }
  activePublicUrl = null;
}

process.on('exit', () => stopTunnel());
process.on('SIGINT', () => {
  stopTunnel();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopTunnel();
  process.exit(0);
});

module.exports = {
  startTunnel,
  getPublicUrl,
  stopTunnel
};
