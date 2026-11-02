// The Node-side half of the board profile.
//
// board.sh is for the shell scripts; this is for the long-running Node
// processes (control-server.js and recorder.js) that need the same documents
// path. It must not depend on anything that is only mounted while browse mode
// is running, because the control server starts at boot.
//
// Gen 1: /media/acvs-content/MPC Documents
// Gen 2: /nvme/MPC Documents
//
// Override with MPC_DOCS_ROOT / MPC_FILES_ROOT, or force a profile with
// CRATESURF_BOARD=gen1 / gen2. The environment wins so a future board can be
// diagnosed without changing the payload.
const fs = require('fs')
const os = require('os')
const path = require('path')

function deviceTree(name) {
  try {
    return fs.readFileSync(`/proc/device-tree/${name}`, 'utf8').replace(/\0/g, ' ').trim()
  } catch {
    return ''
  }
}

const arch = os.arch()
const compatible = deviceTree('compatible')
const model = deviceTree('model')
const forced = (process.env.CRATESURF_BOARD || '').toLowerCase()

let gen
if (forced === 'gen1' || forced === '1' || forced === 'armv7' || forced === 'armhf') {
  gen = 1
} else if (forced === 'gen2' || forced === '2' || forced === 'arm64' || forced === 'aarch64' || forced === 'xl') {
  gen = 2
} else if (forced) {
  // Match board.sh: an unknown explicit value falls back to Gen 1 rather than
  // silently auto-detecting something different from the shell profile.
  process.stderr.write(`board.js: unknown CRATESURF_BOARD='${forced}', using Gen 1\n`)
  gen = 1
} else if (
  arch === 'arm64' ||
  /rk3588|inmusic,acvc|MPC XL|MPC Live III/i.test(`${compatible} ${model}`)
) {
  gen = 2
} else {
  gen = 1
}

const docs = process.env.MPC_DOCS_ROOT || process.env.CRATESURF_DOCS ||
  (gen === 2 ? '/nvme/MPC Documents' : '/media/acvs-content/MPC Documents')
const files = process.env.MPC_FILES_ROOT || path.join(docs, 'Samples')
const gpuDefault = process.env.CRATESURF_GPU_DEFAULT
  ? process.env.CRATESURF_GPU_DEFAULT === '1'
  : gen === 2

module.exports = {
  gen,
  arch,
  compatible,
  model,
  docs,
  files,
  gpuDefault,
  boot: gen === 2 ? 'hook' : 'systemd'
}
