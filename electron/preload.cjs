/**
 * Tells the frontend where its API is — either this app's own embedded
 * backend on a random localhost port, or a shared server elsewhere on the
 * network, depending on which mode main.cjs resolved at startup (see
 * server-config.cjs). Either way main passes the full base URL here through
 * additionalArguments; src/api.js picks up UNISCHEDULER_API_BASE when present
 * and falls back to localhost:4000 in plain-browser development.
 */
const { contextBridge, ipcRenderer } = require('electron');

const arg = process.argv.find(a => a.startsWith('--unischeduler-api-base='));
const base = arg && decodeURIComponent(arg.slice('--unischeduler-api-base='.length));

if (base) {
  contextBridge.exposeInMainWorld('UNISCHEDULER_API_BASE', base);
}

// Renders the current page (whatever's on screen, filtered through @media print CSS) to a real
// PDF file via a native save dialog — see main.cjs's 'print-to-pdf' handler. Used by the Finance
// receipt's "Download as PDF" button; src/components/ReceiptView.jsx falls back to window.print()
// when this isn't present (plain browser dev, no Electron).
contextBridge.exposeInMainWorld('UNISCHEDULER_PRINT_TO_PDF', () => ipcRenderer.invoke('print-to-pdf'));
