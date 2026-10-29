// Unpack a .zip that was downloaded into the sample folder, on the device.
//
// Why not a binary: the firmware's own /usr/bin/unzip is BusyBox, and the Debian
// one only exists inside the chroot, so using it would mean either depending on a
// firmware detail or making every install pay for a sysroot rebuild. Node's zlib
// is already here and cannot go missing, so the reading is done in this file.
//
// Scope is what a sample pack actually is: stored and deflate entries, one file
// at a time. Anything else - a password, a compression method zlib does not have,
// a disk-spanning archive - is refused with a reason, before a single file is
// written, rather than half-extracted and left for the user to find.
//
// The name of every entry is checked against escaping the destination. A zip is
// an untrusted file from the internet and its member names are just bytes a
// stranger chose: "..\" and a leading "/" are how an archive writes outside the
// folder it was opened into.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Transform, PassThrough } = require('stream');
const { pipeline } = require('stream/promises');

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOC = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const MAX_ENTRIES = 200000;

// CRC32, because inflate alone does not notice a flipped bit in a stored entry:
// a corrupt wav would unpack "successfully" and click. The table is built once.
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = (buf, prev) => {
  let c = ~prev;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
};

// Reads exactly len bytes at start, or fewer at end of file. Positional, so one
// descriptor can be used for headers and then for streaming without seeking
// assumptions.
function readAt(fd, start, len) {
  const b = Buffer.alloc(len);
  let off = 0;
  while (off < len) {
    let n;
    try {
      n = fs.readSync(fd, b, off, len - off, start + off);
    } catch (e) {
      if (e.code === 'EOF') break;
      throw e;
    }
    if (!n) break;
    off += n;
  }
  return off === len ? b : b.subarray(0, off);
}

// The end-of-central-directory record is the only fixed point in a zip: it sits
// at the end, after a comment that can be up to 64 KB, so it is found by looking
// backwards for its signature.
function findEocd(fd, size) {
  const tailLen = Math.min(size, 66000);
  const at = size - tailLen;
  const buf = readAt(fd, at, tailLen);
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) !== SIG_EOCD) continue;
    return { at: at + i, buf, i };
  }
  return null;
}

function directory(fd, size) {
  const eocd = findEocd(fd, size);
  if (!eocd) throw new Error('that is not a zip file');

  const { buf, i, at } = eocd;
  let count = buf.readUInt16LE(i + 10);
  let cdSize = buf.readUInt32LE(i + 12);
  let cdAt = buf.readUInt32LE(i + 16);

  // 0xffff / 0xffffffff are the "look in the zip64 record" markers. That record
  // is located from a 20-byte locator immediately before the EOCD.
  if (count === 0xffff || cdSize === 0xffffffff || cdAt === 0xffffffff) {
    const locAt = at - 20;
    if (locAt >= 0) {
      const loc = readAt(fd, locAt, 20);
      if (loc.length === 20 && loc.readUInt32LE(0) === SIG_EOCD64_LOC) {
        const z64At = Number(loc.readBigUInt64LE(8));
        const z64 = readAt(fd, z64At, 56);
        if (z64.length === 56 && z64.readUInt32LE(0) === SIG_EOCD64) {
          count = Number(z64.readBigUInt64LE(32));
          cdSize = Number(z64.readBigUInt64LE(40));
          cdAt = Number(z64.readBigUInt64LE(48));
        }
      }
    }
  }

  if (!count) throw new Error('that zip has no files in it');
  if (count > MAX_ENTRIES) throw new Error(`that zip has ${count} files, more than this will open`);
  if (cdAt + cdSize > size) throw new Error('that zip is damaged: its file list is past the end');

  const cd = readAt(fd, cdAt, cdSize);
  const entries = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== SIG_CENTRAL) {
      throw new Error('that zip is damaged: its file list stops early');
    }
    const flags = cd.readUInt16LE(p + 8);
    const method = cd.readUInt16LE(p + 10);
    const crc = cd.readUInt32LE(p + 16);
    let csize = cd.readUInt32LE(p + 20);
    let usize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const disk = cd.readUInt16LE(p + 34);
    let offset = cd.readUInt32LE(p + 42);
    const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    // Only a single-file archive is readable through one descriptor; a set of
    // disks would put this entry's bytes in a file that is not here.
    if (disk !== 0) throw new Error('that is part of a multi-disk archive');
    const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);

    // zip64 stores any value that was too big for 32 bits in the extra field,
    // in this fixed order, and only for the fields that overflowed.
    if (usize === 0xffffffff || csize === 0xffffffff || offset === 0xffffffff) {
      const need = { usize: usize === 0xffffffff, csize: csize === 0xffffffff, offset: offset === 0xffffffff };
      let q = 0;
      while (q + 4 <= extra.length) {
        const id = extra.readUInt16LE(q);
        const len = extra.readUInt16LE(q + 2);
        if (id === 0x0001) {
          let r = q + 4;
          const end = Math.min(r + len, extra.length);
          for (const key of ['usize', 'csize', 'offset']) {
            if (!need[key] || r + 8 > end) continue;
            const v = Number(extra.readBigUInt64LE(r));
            r += 8;
            if (key === 'usize') usize = v;
            else if (key === 'csize') csize = v;
            else offset = v;
          }
          break;
        }
        q += 4 + len;
      }
      if (usize === 0xffffffff || csize === 0xffffffff || offset === 0xffffffff) {
        throw new Error(`"${name}" is a zip64 entry this cannot size`);
      }
    }

    entries.push({ name, flags, method, crc, csize, usize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// A member name is data from a stranger. Reject anything that is not a plain
// relative path of ordinary segments before it is used to build a path.
function safeName(name) {
  if (!name || name === '/') return 'empty name';
  if (name.startsWith('/')) return 'absolute path';
  if (name.includes('\\')) return 'backslash in the path';
  if (/^[a-zA-Z]:/.test(name)) return 'drive letter in the path';
  if (/[\u0000-\u001f]/.test(name)) return 'control character in the name';
  const parts = name.split('/');
  if (parts.some((s) => s === '..')) return '".." in the path';
  return null;
}

const baseName = (file) => path.basename(file).replace(/\.zip$/i, '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) || 'pack';

// What the panel shows before anything is written: how many, how big, where it
// would land, and whether it is something this can open at all.
function inspect(file) {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  let entries;
  try {
    entries = directory(fd, size);
  } finally {
    fs.closeSync(fd);
  }

  const files = [];
  const folders = [];
  let bytes = 0;
  for (const e of entries) {
    const isDir = e.name.endsWith('/');
    const name = isDir ? e.name.slice(0, -1) : e.name;
    const bad = safeName(name);
    if (bad) throw new Error(`that zip is not safe to unpack: ${bad} ("${e.name}")`);
    // A folder is only a name to make. Its own header fields are not used.
    if (isDir) { folders.push({ name }); continue; }
    if (e.flags & 1) throw new Error(`"${e.name}" is password protected`);
    if (e.method !== 0 && e.method !== 8) {
      throw new Error(`"${e.name}" uses compression this cannot unpack (method ${e.method})`);
    }
    files.push(e);
    bytes += e.usize;
  }
  if (!files.length) throw new Error('that zip has no files in it');

  // A pack almost always holds one folder of its own. Extracting it inside a
  // second folder of the same name would give Samples/Pack/Pack/Drums. Every
  // entry has to be under that one name, and the bare name - if the archive has
  // it - has to be the folder itself, or a file would be folded away with it.
  const names = [...files, ...folders].map((e) => e.name);
  const firsts = [...new Set(names.map((n) => n.split('/')[0]))];
  const bare = firsts.length === 1 ? firsts[0] : null;
  const bareIsFolder = bare !== null &&
    (folders.some((f) => f.name === bare) || !files.some((f) => f.name === bare));
  const root = bareIsFolder && names.every((n) => n === bare || n.startsWith(bare + '/'))
    ? bare
    : null;

  // The name the folder will get, before a clash with something already there
  // is resolved. The panel shows it while the unpack is still running.
  return { files, folders, count: files.length, bytes, root, dest: root || baseName(file) };
}

// "Pack", then "Pack 2", because unpacking the same download twice must not
// overwrite the first attempt - the folder may already be loaded in the MPC.
function uniquePath(dir, name) {
  let target = path.join(dir, name);
  for (let n = 2; fs.existsSync(target) && n < 100; n++) target = path.join(dir, `${name} ${n}`);
  return target;
}

const crcCheck = (expected) => {
  let crc = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      crc = crc32(chunk, crc);
      cb(null, chunk);
    },
    flush(cb) {
      if (crc !== expected) return cb(new Error('a file in that zip is damaged'));
      cb();
    }
  });
};

// Extracts into a scratch folder inside the destination's own filesystem and then
// moves the result into place. A pack is many files, and a half-unpacked folder
// appearing in the MPC's library under the real name is worse than nothing: the
// move is the point at which it becomes visible, and it is atomic.
async function unpack(file, onProgress = () => {}) {
  const { files, folders, count, bytes, root, dest: name } = inspect(file);
  const parent = path.dirname(file);
  const dest = uniquePath(parent, name);
  const scratch = path.join(parent, `.unpack-${process.pid}-${Date.now()}`);

  fs.mkdirSync(scratch, { recursive: true });
  let done = 0;
  let written = 0;
  try {
    for (const e of files) {
      const out = path.join(scratch, e.name);
      const rel = path.relative(scratch, out);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`that zip is not safe to unpack ("${e.name}")`);
      }
      fs.mkdirSync(path.dirname(out), { recursive: true });

      const fd = fs.openSync(file, 'r');
      try {
        const lh = readAt(fd, e.offset, 30);
        if (lh.length !== 30 || lh.readUInt32LE(0) !== SIG_LOCAL) {
          throw new Error(`that zip is damaged at "${e.name}"`);
        }
        // The local header's own name and extra lengths are what say where the
        // data starts; the version in the directory can legally differ.
        const dataAt = e.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
        const rs = fs.createReadStream(file, {
          fd, start: dataAt, end: dataAt + e.csize - 1, autoClose: false
        });
        const body = e.method === 8 ? zlib.createInflateRaw() : new PassThrough();
        await pipeline(rs, body, crcCheck(e.crc), fs.createWriteStream(out));
      } catch (err) {
        try { fs.unlinkSync(out); } catch (_) {}
        throw err;
      } finally {
        fs.closeSync(fd);
      }
      done++;
      written += e.usize;
      onProgress({ done, count, written, bytes });
    }

    // Folder entries exist only as names; a pack with an empty folder in it
    // should unpack with that folder in it.
    for (const d of folders) fs.mkdirSync(path.join(scratch, d.name), { recursive: true });

    // With one root the folder itself is the pack, so it is what gets moved into
    // place; otherwise the scratch folder becomes the pack.
    const landed = root ? path.join(scratch, root) : scratch;
    fs.renameSync(landed, dest);
    return { dest: path.basename(dest), dir: dest, count, bytes };
  } finally {
    try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (_) {}
  }
}

module.exports = { inspect, unpack };
