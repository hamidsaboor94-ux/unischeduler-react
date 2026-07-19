const os = require('os');
const app = require('./app');
const { init } = require('./db');

const PORT = process.env.PORT || 4000;

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
  })
  .catch((err) => {
    console.error('Failed to initialize the database:', err.message);
    process.exit(1);
  });
