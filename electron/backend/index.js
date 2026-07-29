const os = require('os');
const app = require('./app');
const { init } = require('./db');
const { runNoticeScheduler } = require('./noticeScheduler');

const PORT = process.env.PORT || 4000;
const NOTICE_SCHEDULER_INTERVAL_MS = 60 * 1000;

/** Prints every non-internal IPv4 address this machine has — whichever of these is on the
    same network as another device is what that device should use to reach this server
    (e.g. a desktop app in "client mode", or the website's VITE_API_BASE). listen() with no
    host already binds all interfaces, so nothing else needs to change for this to work. */
function logNetworkAddresses() {
  const nets = os.networkInterfaces();
  for (const addrs of Object.values(nets)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        console.log(`  On your network: http://${addr.address}:${PORT}`);
      }
    }
  }
}

init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`API server listening on http://localhost:${PORT}`);
      logNetworkAddresses();
    });
    // Publishes due scheduled announcements and expires overdue ones — see noticeScheduler.js
    // for why an interval is enough (this process is already long-running, unlike a browser tab).
    runNoticeScheduler();
    setInterval(runNoticeScheduler, NOTICE_SCHEDULER_INTERVAL_MS);
  })
  .catch((err) => {
    console.error('Failed to initialize the database:', err.message);
    process.exit(1);
  });
