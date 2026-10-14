import { badRequest } from './errors.js';

/**
 * An .xlsx file is a zip. A tiny zip can claim to hold gigabytes ("zip bomb") and exhaust the server's memory the moment it
 * is opened. This reads only the zip's table of contents, which costs nothing, and refuses anything suspicious before the
 * spreadsheet library ever touches it.
 */
export function assertSafeZip(buf: Buffer, { maxUncompressed = 60 * 1024 * 1024, maxEntries = 300, maxRatio = 200 } = {}) {
  const bad = () => badRequest('This spreadsheet could not be read safely. Export it again from Excel and try once more.', 'BAD_SPREADSHEET');
  if (buf.length < 22) throw bad();
  // The "end of central directory" record sits at the very end; its signature is PK\x05\x06.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw bad();
  const total = buf.readUInt16LE(eocd + 10);
  const dirSize = buf.readUInt32LE(eocd + 12);
  const dirOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) throw bad(); // zip64: not needed for a normal sheet
  if (total > maxEntries || dirOffset + dirSize > buf.length) throw bad();

  let pos = dirOffset, sum = 0;
  for (let n = 0; n < total; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) throw bad();
    const compressed = buf.readUInt32LE(pos + 20);
    const uncompressed = buf.readUInt32LE(pos + 24);
    if (uncompressed === 0xffffffff || compressed === 0xffffffff) throw bad();
    if (compressed > 0 && uncompressed / compressed > maxRatio && uncompressed > 1024 * 1024) throw bad();
    sum += uncompressed;
    if (sum > maxUncompressed) throw bad();
    pos += 46 + buf.readUInt16LE(pos + 28) + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
  }
}
