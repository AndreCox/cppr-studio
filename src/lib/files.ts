/** Download / file utilities. No external dependencies. */

export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'cppr'
  );
}

/* ------------------------------------------------------------------ */
/* Minimal ZIP (store method)                                          */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()): { time: number; date: number } {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const date = ((d.getFullYear() - 1980) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

export interface ZipEntry {
  name: string;
  content: string | Uint8Array;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    if (typeof CompressionStream === 'undefined') return null;
    const cs = new CompressionStream('deflate-raw');
    const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/** Build a valid ZIP archive (deflate where available, stored otherwise). */
export async function makeZip(entries: ZipEntry[]): Promise<Blob> {
  const enc = new TextEncoder();
  const now = dosDateTime();
  const files = await Promise.all(entries.map(async (e) => {
    const raw = typeof e.content === 'string' ? enc.encode(e.content) : e.content;
    const compressed = await deflateRaw(raw);
    return {
      name: enc.encode(e.name),
      raw,
      data: compressed ?? raw,
      method: compressed ? 8 : 0,
      crc: crc32(raw),
    };
  }));

  const localSize = files.reduce((a, f) => a + 30 + f.name.length + f.data.length, 0);
  const centralSize = files.reduce((a, f) => a + 46 + f.name.length, 0);
  const total = localSize + centralSize + 22;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  let off = 0;
  const u16 = (v: number) => { view.setUint16(off, v, true); off += 2; };
  const u32 = (v: number) => { view.setUint32(off, v >>> 0, true); off += 4; };
  const bytes = (b: Uint8Array) => { buf.set(b, off); off += b.length; };

  const offsets: number[] = [];
  for (const f of files) {
    offsets.push(off);
    u32(0x04034b50);
    u16(20); u16(0); u16(f.method);
    u16(now.time); u16(now.date);
    u32(f.crc); u32(f.data.length); u32(f.raw.length);
    u16(f.name.length); u16(0);
    bytes(f.name);
    bytes(f.data);
  }
  const centralStart = off;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    u32(0x02014b50);
    u16(20); u16(20); u16(0); u16(f.method);
    u16(now.time); u16(now.date);
    u32(f.crc); u32(f.data.length); u32(f.raw.length);
    u16(f.name.length); u16(0); u16(0);
    u16(0); u16(0); u32(0);
    u32(offsets[i]);
    bytes(f.name);
  }
  const centralEnd = off;
  u32(0x06054b50);
  u16(0); u16(0);
  u16(files.length); u16(files.length);
  u32(centralEnd - centralStart); u32(centralStart);
  u16(0);
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return new Blob([copy], { type: 'application/zip' });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
