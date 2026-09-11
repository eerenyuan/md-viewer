// Ensure the Electron binary is downloaded via the China mirror.
// Runs as npm postinstall; idempotent when the binary already exists.
process.env.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/'
require('electron/install.js')
