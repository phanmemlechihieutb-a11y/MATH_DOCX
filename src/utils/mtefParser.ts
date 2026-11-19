// Pure TypeScript parser for Microsoft OLE2 Compound File Binary Format (CFBF),
// MathType "Equation Native" / WMF AppsMFC streams, and MTEF v3/v4/v5 -> LaTeX.

const CFBF_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;
const DIFSECT = 0xfffffffc;
const MAXREGSECT = 0xfffffffa;

function isCfbf(bytes: Uint8Array): boolean {
  if (bytes.length < 512) return false;
  for (let i = 0; i < CFBF_MAGIC.length; i++) {
    if (bytes[i] !== CFBF_MAGIC[i]) return false;
  }
  return true;
}

function readUtf16LeZ(bytes: Uint8Array, offset: number, maxBytes: number): string {
  const end = Math.min(bytes.length, offset + maxBytes);
  let out = '';
  for (let i = offset; i + 1 < end; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

export function extractStreamFromCfbf(
  bytes: Uint8Array,
  targetStreamName: string
): Uint8Array | null {
  if (!isCfbf(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const majorVer = view.getUint16(0x1a, true);
  const sectorShift = view.getUint16(0x1e, true);
  const miniSectorShift = view.getUint16(0x20, true);
  if (sectorShift < 7 || sectorShift > 16 || miniSectorShift < 4 || miniSectorShift > 12) {
    return null;
  }

  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << miniSectorShift;
  const firstDirSector = view.getUint32(0x30, true);
  const miniStreamCutoff = view.getUint32(0x38, true) || 4096;
  const firstMiniFatSector = view.getUint32(0x3c, true);
  const numMiniFatSectors = view.getUint32(0x40, true);
  const firstDifatSector = view.getUint32(0x44, true);
  const numDifatSectors = view.getUint32(0x48, true);

  const sectorOffset = (secId: number) => (secId + 1) * sectorSize;

  // 1. Collect FAT sector indices from header DIFAT (109 entries) + DIFAT chain
  const fatSectorIds: number[] = [];
  for (let i = 0; i < 109; i++) {
    const secId = view.getUint32(0x4c + i * 4, true);
    if (secId < MAXREGSECT) {
      fatSectorIds.push(secId);
    }
  }

  let difatSec = firstDifatSector;
  let difatGuard = 0;
  const difatPerSector = Math.floor(sectorSize / 4) - 1;
  while (
    difatSec < MAXREGSECT &&
    difatGuard < Math.max(16, numDifatSectors + 2)
  ) {
    difatGuard++;
    const off = sectorOffset(difatSec);
    if (off + sectorSize > bytes.length) break;
    for (let i = 0; i < difatPerSector; i++) {
      const secId = view.getUint32(off + i * 4, true);
      if (secId < MAXREGSECT) fatSectorIds.push(secId);
    }
    difatSec = view.getUint32(off + difatPerSector * 4, true);
  }

  // 2. Build FAT table
  const entriesPerFatSector = Math.floor(sectorSize / 4);
  const fat = new Uint32Array(fatSectorIds.length * entriesPerFatSector);
  for (let s = 0; s < fatSectorIds.length; s++) {
    const off = sectorOffset(fatSectorIds[s]);
    if (off + sectorSize > bytes.length) continue;
    for (let i = 0; i < entriesPerFatSector; i++) {
      fat[s * entriesPerFatSector + i] = view.getUint32(off + i * 4, true);
    }
  }

  const readFatChain = (startSec: number, expectedLen?: number): Uint8Array => {
    if (startSec >= MAXREGSECT) return new Uint8Array(0);
    const chunks: Uint8Array[] = [];
    const seen = new Set<number>();
    let cur = startSec;
    let total = 0;
    while (cur < MAXREGSECT && !seen.has(cur) && seen.size < 65536) {
      seen.add(cur);
      const off = sectorOffset(cur);
      if (off < bytes.length) {
        const avail = Math.min(sectorSize, bytes.length - off);
        chunks.push(bytes.subarray(off, off + avail));
        total += avail;
        if (expectedLen !== undefined && total >= expectedLen) break;
      }
      if (cur >= fat.length) break;
      const next = fat[cur];
      if (next === ENDOFCHAIN || next === FREESECT || next === FATSECT || next === DIFSECT) {
        break;
      }
      cur = next;
    }
    const outLen = expectedLen !== undefined ? Math.min(expectedLen, total) : total;
    const out = new Uint8Array(outLen);
    let pos = 0;
    for (const c of chunks) {
      const take = Math.min(c.length, outLen - pos);
      if (take <= 0) break;
      out.set(c.subarray(0, take), pos);
      pos += take;
    }
    return out;
  };

  // 3. Build MiniFAT table
  const miniFatBytes =
    firstMiniFatSector < MAXREGSECT && numMiniFatSectors > 0
      ? readFatChain(firstMiniFatSector)
      : new Uint8Array(0);
  const miniFatCount = Math.floor(miniFatBytes.length / 4);
  const miniFat = new Uint32Array(miniFatCount);
  if (miniFatCount > 0) {
    const mfView = new DataView(
      miniFatBytes.buffer,
      miniFatBytes.byteOffset,
      miniFatBytes.byteLength
    );
    for (let i = 0; i < miniFatCount; i++) {
      miniFat[i] = mfView.getUint32(i * 4, true);
    }
  }

  // 4. Parse Directory Stream
  const dirBytes = readFatChain(firstDirSector);
  if (dirBytes.length < 128) return null;
  const dirView = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);

  interface DirEntry {
    name: string;
    objType: number;
    startSec: number;
    size: number;
  }
  const entries: DirEntry[] = [];
  for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
    const objType = dirBytes[off + 0x42];
    if (objType === 0) continue;
    const nameLen = dirView.getUint16(off + 0x40, true);
    const name = readUtf16LeZ(dirBytes, off, Math.min(64, nameLen));
    const startSec = dirView.getUint32(off + 0x74, true);
    const sizeLow = dirView.getUint32(off + 0x78, true);
    const sizeHigh = majorVer >= 4 ? dirView.getUint32(off + 0x7c, true) : 0;
    const size = sizeHigh === 0 ? sizeLow : sizeLow;
    entries.push({ name, objType, startSec, size });
  }

  const rootEntry = entries.find((e) => e.objType === 5);
  const miniStream = rootEntry
    ? readFatChain(rootEntry.startSec, rootEntry.size)
    : new Uint8Array(0);

  const readMiniChain = (startSec: number, expectedLen: number): Uint8Array => {
    if (startSec >= MAXREGSECT || miniStream.length === 0) return new Uint8Array(0);
    const out = new Uint8Array(expectedLen);
    const seen = new Set<number>();
    let cur = startSec;
    let pos = 0;
    while (cur < MAXREGSECT && !seen.has(cur) && pos < expectedLen && seen.size < 65536) {
      seen.add(cur);
      const off = cur * miniSectorSize;
      if (off < miniStream.length) {
        const take = Math.min(miniSectorSize, miniStream.length - off, expectedLen - pos);
        out.set(miniStream.subarray(off, off + take), pos);
        pos += take;
      }
      if (cur >= miniFat.length) break;
      const next = miniFat[cur];
      if (next === ENDOFCHAIN || next === FREESECT) break;
      cur = next;
    }
    return pos === expectedLen ? out : out.subarray(0, pos);
  };

  const readEntryData = (entry: DirEntry): Uint8Array => {
    if (entry.size === 0) return new Uint8Array(0);
    if (entry.size < miniStreamCutoff && entry.objType !== 5 && miniFat.length > 0) {
      return readMiniChain(entry.startSec, entry.size);
    }
    return readFatChain(entry.startSec, entry.size);
  };

  const targetLower = targetStreamName.toLowerCase();
  const exact = entries.find(
    (e) => e.objType === 2 && e.name.trim().toLowerCase() === targetLower
  );
  if (exact) {
    return readEntryData(exact);
  }

  // Fallback: inspect streams for EQNOLEFILEHDR, raw MTEF, or Ole10Native
  for (const e of entries) {
    if (e.objType !== 2 || e.size < 16 || e.size > 1024 * 512) continue;
    const data = readEntryData(e);
    if (looksLikeEqnOleOrMtef(data)) {
      return data;
    }
    if (e.name.toLowerCase().includes('ole10native')) {
      for (let off = 4; off + 34 < Math.min(data.length, 256); off++) {
        if (
          data[off] === 28 &&
          data[off + 1] === 0 &&
          data[off + 28] >= 1 &&
          data[off + 28] <= 5 &&
          (data[off + 29] === 0 || data[off + 29] === 1)
        ) {
          return data.subarray(off);
        }
      }
    }
  }
  return null;
}

function looksLikeEqnOleOrMtef(buf: Uint8Array): boolean {
  if (buf.length < 10) return false;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const cbHdr = view.getUint16(0, true);
  if (cbHdr >= 16 && cbHdr <= 64 && cbHdr + 6 < buf.length) {
    const ver = buf[cbHdr];
    if (ver >= 1 && ver <= 5) return true;
  }
  if ((buf[0] === 5 || buf[0] === 3) && (buf[1] === 0 || buf[1] === 1) && (buf[2] === 0 || buf[2] === 1)) {
    return true;
  }
  return false;
}

export function extractMtefFromEquationNative(raw: Uint8Array): Uint8Array | null {
  if (raw.length < 8) return null;
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const cbHdr = view.getUint16(0, true);
  if (cbHdr >= 12 && cbHdr <= 64 && cbHdr + 5 <= raw.length) {
    const cbObject = view.getUint32(8, true);
    const end =
      cbObject > 0 && cbHdr + cbObject <= raw.length ? cbHdr + cbObject : raw.length;
    const candidate = raw.subarray(cbHdr, end);
    if (candidate.length >= 5 && candidate[0] >= 1 && candidate[0] <= 5) {
      return candidate;
    }
  }
  // Check raw MTEF without EQNOLEFILEHDR
  if (raw[0] >= 1 && raw[0] <= 5 && (raw[1] === 0 || raw[1] === 1)) {
    return raw;
  }
  return null;
}

// Extract MTEF chunks embedded in MathType WMF "AppsMFC" MFCOMMENT escape records
export function extractMtefFromWmf(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 22) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;

  // Aldus Placeable WMF header magic: D7 CD C6 9A
  if (
    bytes[0] === 0xd7 &&
    bytes[1] === 0xcd &&
    bytes[2] === 0xc6 &&
    bytes[3] === 0x9a
  ) {
    pos = 22;
  }
  if (pos + 18 > bytes.length) return null;
  const mtHeaderWords = view.getUint16(pos + 2, true);
  pos += Math.max(9, mtHeaderWords) * 2;

  const chunks: Uint8Array[] = [];
  while (pos + 6 <= bytes.length) {
    const rdSizeWords = view.getUint32(pos, true);
    const rdFunc = view.getUint16(pos + 4, true);
    if (rdSizeWords < 3 || rdFunc === 0) break;
    const recBytes = rdSizeWords * 2;
    if (pos + recBytes > bytes.length) break;

    // META_ESCAPE = 0x0626, escape MFCOMMENT = 15
    if (rdFunc === 0x0626 && pos + 10 <= bytes.length) {
      const escFunc = view.getUint16(pos + 6, true);
      const cbData = view.getUint16(pos + 8, true);
      if (escFunc === 15 && pos + 10 + cbData <= bytes.length && cbData >= 12) {
        const p = bytes.subarray(pos + 10, pos + 10 + cbData);
        // Signature "AppsMFC"
        const sig = String.fromCharCode(p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
        if (sig === 'AppsMFC') {
          // Format 1: "AppsMFC\0" (8 bytes) + type (uint16) + totalSize (uint32) + chunkSize (uint32) + data
          // Format 2: "AppsMFC" (7 bytes) + version (1 byte) + type (uint16) + ...
          if (p[7] === 0 && p.length >= 18) {
            const pView = new DataView(p.buffer, p.byteOffset, p.byteLength);
            const cType = pView.getUint16(8, true);
            const chunkSize = pView.getUint32(14, true);
            if (cType === 1 && chunkSize > 0 && 18 + chunkSize <= p.length) {
              chunks.push(p.subarray(18, 18 + chunkSize));
            } else if (cType === 1 && p.length > 18) {
              chunks.push(p.subarray(18));
            }
          } else {
            // Heuristic scan for EQNOLEFILEHDR or MTEF header inside comment payload
            for (let k = 8; k + 6 < p.length; k++) {
              if (
                k + 34 < p.length &&
                p[k] === 28 &&
                p[k + 1] === 0 &&
                p[k + 28] >= 1 &&
                p[k + 28] <= 5 &&
                (p[k + 29] === 0 || p[k + 29] === 1)
              ) {
                chunks.push(p.subarray(k));
                break;
              }
              if (p[k] === 5 && (p[k + 1] === 0 || p[k + 1] === 1) && (p[k + 2] === 0 || p[k + 2] === 1)) {
                chunks.push(p.subarray(k));
                break;
              }
            }
          }
        }
      }
    }
    pos += recBytes;
  }

  if (chunks.length === 0) return null;
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const merged = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  return extractMtefFromEquationNative(merged) ?? merged;
}

export function extractLatexFromOleBuffer(bytes: Uint8Array): string | null {
  let mtef: Uint8Array | null = null;
  const eqNative = extractStreamFromCfbf(bytes, 'Equation Native');
  if (eqNative) {
    mtef = extractMtefFromEquationNative(eqNative);
  } else {
    mtef = extractMtefFromEquationNative(bytes);
  }
  if (!mtef) return null;
  return mtefToLatex(mtef);
}

export function extractLatexFromWmfBuffer(bytes: Uint8Array): string | null {
  const mtef = extractMtefFromWmf(bytes);
  if (!mtef) return null;
  return mtefToLatex(mtef);
}

// ==================== MTEF Binary -> AST -> LaTeX ====================

// Record tags
const REC_END = 0;
const REC_LINE = 1;
const REC_CHAR = 2;
const REC_TMPL = 3;
const REC_PILE = 4;
const REC_MATRIX = 5;
const REC_EMBELL = 6;
const REC_RULER = 7;
const REC_FONT_STYLE_DEF = 8;
const REC_SIZE = 9;
const REC_FULL = 10;
const REC_SUB = 11;
const REC_SUB2 = 12;
const REC_SYM = 13;
const REC_SUBSYM = 14;
const REC_COLOR = 15;
const REC_COLOR_DEF = 16;
const REC_FONT_DEF = 17;
const REC_EQN_PREFS = 18;
const REC_ENCODING_DEF = 19;

// Option flags
const OPT_NUDGE = 0x08;
const OPT_CHAR_EMBELL = 0x01;
const OPT_CHAR_FUNC_START = 0x02;
const OPT_CHAR_ENC_CHAR_8 = 0x04;
const OPT_CHAR_ENC_CHAR_16 = 0x10;
const OPT_CHAR_ENC_NO_MTCODE = 0x20;
const OPT_LINE_NULL = 0x01;
const OPT_LP_RULER = 0x02;
const OPT_LINE_LSPACE = 0x04;
const OPT_COLOR_CMYK = 0x01;
const OPT_COLOR_NAME = 0x04;

// Predefined Typefaces (1-based)
const FN_TEXT = 1;
const FN_FUNCTION = 2;
const FN_VARIABLE = 3;
const FN_LCGREEK = 4;
const FN_UCGREEK = 5;
const FN_SYMBOL = 6;
const FN_VECTOR = 7;
const FN_NUMBER = 8;
const FN_USER1 = 9;
const FN_USER2 = 10;
const FN_MTEXTRA = 11;
const FN_TEXT_FE = 12;

// Template selectors
const TM_ANGLE = 0;
const TM_PAREN = 1;
const TM_BRACE = 2;
const TM_BRACK = 3;
const TM_BAR = 4;
const TM_DBAR = 5;
const TM_FLOOR = 6;
const TM_CEILING = 7;
const TM_OBRACK = 8;
const TM_INTERVAL = 9;
const TM_ROOT = 10;
const TM_FRACT = 11;
const TM_UBAR = 12;
const TM_OBAR = 13;
const TM_ARROW = 14;
const TM_INTEG = 15;
const TM_SUM = 16;
const TM_PROD = 17;
const TM_COPROD = 18;
const TM_UNION = 19;
const TM_INTER = 20;
const TM_INTOP = 21;
const TM_SUMOP = 22;
const TM_LIM = 23;
const TM_HBRACE = 24;
const TM_HBRACK = 25;
const TM_LDIV = 26;
const TM_SUB = 27;
const TM_SUP = 28;
const TM_SUBSUP = 29;
const TM_DIRAC = 30;
const TM_VEC = 31;
const TM_TILDE = 32;
const TM_HAT = 33;
const TM_ARC = 34;
const TM_JSTRIKE = 35;
const TM_BOX = 36;

// Embellishments
const EMB_1DOT = 2;
const EMB_2DOT = 3;
const EMB_3DOT = 4;
const EMB_1PRIME = 5;
const EMB_2PRIME = 6;
const EMB_BPRIME = 7;
const EMB_TILDE = 8;
const EMB_HAT = 9;
const EMB_NOT = 10;
const EMB_RARROW = 11;
const EMB_LARROW = 12;
const EMB_BARROW = 13;
const EMB_R1ARROW = 14;
const EMB_L1ARROW = 15;
const EMB_MBAR = 16;
const EMB_OBAR = 17;
const EMB_3PRIME = 18;
const EMB_FROWN = 19;
const EMB_SMILE = 20;
const EMB_X_BARS = 21;
const EMB_UP_BAR = 22;
const EMB_DN_BAR = 23;
const EMB_4DOT = 24;
const EMB_U_1DOT = 25;
const EMB_U_2DOT = 26;
const EMB_U_3DOT = 27;
const EMB_U_4DOT = 28;
const EMB_U_BAR = 29;
const EMB_U_TILDE = 30;
const EMB_U_FROWN = 31;
const EMB_U_SMILE = 32;
const EMB_U_RARROW = 33;
const EMB_U_LARROW = 34;
const EMB_U_BARROW = 35;
const EMB_U_R1ARROW = 36;
const EMB_U_L1ARROW = 37;

type MtefNode =
  | { kind: 'line'; isNull: boolean; items: MtefNode[] }
  | {
      kind: 'char';
      char: string;
      rawChar?: number;
      mtcode?: number;
      typeface: number;
      isFuncStart: boolean;
      fontName?: string;
      embells: number[];
      colorHex?: string;
    }
  | {
      kind: 'tmpl';
      selector: number;
      variation: number;
      tmplOpts: number;
      items: MtefNode[];
    }
  | { kind: 'pile'; halign: number; valign: number; lines: MtefNode[] }
  | { kind: 'matrix'; rows: number; cols: number; cells: MtefNode[] };

class BinaryReader {
  pos = 0;
  private view: DataView;

  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get eof(): boolean {
    return this.pos >= this.bytes.length;
  }

  peekByte(): number {
    return this.pos < this.bytes.length ? this.bytes[this.pos] : 0;
  }

  readByte(): number {
    if (this.pos >= this.bytes.length) return 0;
    return this.bytes[this.pos++];
  }

  readInt8(): number {
    const b = this.readByte();
    return b >= 128 ? b - 256 : b;
  }

  readUint16LE(): number {
    if (this.pos + 2 > this.bytes.length) {
      this.pos = this.bytes.length;
      return 0;
    }
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  readInt16LE(): number {
    if (this.pos + 2 > this.bytes.length) {
      this.pos = this.bytes.length;
      return 0;
    }
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  readUint32LE(): number {
    if (this.pos + 4 > this.bytes.length) {
      this.pos = this.bytes.length;
      return 0;
    }
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  // MTEF v5 variable unsigned integer
  readMtefUint(): number {
    const b = this.readByte();
    return b === 0xff ? this.readUint16LE() : b;
  }

  // MTEF v5 variable signed integer
  readMtefSint(): number {
    const b = this.readByte();
    return b === 0xff ? this.readInt16LE() : b - 128;
  }

  readCString(): string {
    const start = this.pos;
    while (this.pos < this.bytes.length && this.bytes[this.pos] !== 0) {
      this.pos++;
    }
    const slice = this.bytes.subarray(start, this.pos);
    if (this.pos < this.bytes.length && this.bytes[this.pos] === 0) {
      this.pos++;
    }
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(slice);
    } catch {
      let s = '';
      for (let i = 0; i < slice.length; i++) s += String.fromCharCode(slice[i]);
      return s;
    }
  }

  skip(n: number): void {
    this.pos = Math.min(this.bytes.length, this.pos + Math.max(0, n));
  }

  readNudge(): void {
    const dx = this.readInt8();
    const dy = this.readInt8();
    if (dx === -128 && dy === -128) {
      this.readInt16LE();
      this.readInt16LE();
    }
  }

  skipNibbleDimensionArray(count: number): void {
    // Packed 4-bit nibbles, high nibble first per byte.
    // Each dimension consists of [units nibble (1..4)] + [digit/decimal nibbles] + [0xF terminator].
    let dimsRead = 0;
    let highNext = true;
    let curByte = 0;

    const nextNibble = (): number => {
      if (highNext) {
        if (this.eof) return 0x0f;
        curByte = this.readByte();
        highNext = false;
        return (curByte >> 4) & 0x0f;
      }
      highNext = true;
      return curByte & 0x0f;
    };

    let guard = 0;
    while (dimsRead < count && guard < 4096) {
      guard++;
      const nib = nextNibble();
      if (nib === 0x0f) {
        dimsRead++;
      }
    }
  }
}

interface ParserState {
  ver: number;
  fonts: string[]; // 1-based FONT_DEF names
  colors: string[]; // 1-based COLOR_DEF hexes
  currentColor?: string;
}

function skipRuler(r: BinaryReader): void {
  const nStops = r.readByte();
  for (let i = 0; i < nStops; i++) {
    r.readByte(); // tab stop type
    r.readUint16LE(); // tab stop offset
  }
}

function readRecordListV5(
  r: BinaryReader,
  state: ParserState,
  depth = 0
): MtefNode[] {
  const nodes: MtefNode[] = [];
  if (depth > 64) return nodes;

  let guard = 0;
  while (!r.eof && guard < 10000) {
    guard++;
    const tag = r.readByte();
    if (tag === REC_END) break;

    if (tag >= 100) {
      const skipLen = r.readMtefUint();
      r.skip(skipLen);
      continue;
    }

    switch (tag) {
      case REC_LINE: {
        const opts = r.readByte();
        if (opts & OPT_NUDGE) r.readNudge();
        if (opts & OPT_LINE_LSPACE) r.readInt16LE();
        if (opts & OPT_LP_RULER) {
          if (r.peekByte() === REC_RULER) r.readByte();
          skipRuler(r);
        }
        if (opts & OPT_LINE_NULL) {
          nodes.push({ kind: 'line', isNull: true, items: [] });
        } else {
          const items = readRecordListV5(r, state, depth + 1);
          nodes.push({ kind: 'line', isNull: false, items });
        }
        break;
      }

      case REC_CHAR: {
        const opts = r.readByte();
        if (opts & OPT_NUDGE) r.readNudge();
        const typeface = r.readMtefSint();
        let mtcode: number | undefined;
        if (!(opts & OPT_CHAR_ENC_NO_MTCODE)) {
          mtcode = r.readUint16LE();
        }
        let rawChar: number | undefined;
        if (opts & OPT_CHAR_ENC_CHAR_8) {
          rawChar = r.readByte();
        } else if (opts & OPT_CHAR_ENC_CHAR_16) {
          rawChar = r.readUint16LE();
        }

        const embells: number[] = [];
        if (opts & OPT_CHAR_EMBELL) {
          let embGuard = 0;
          while (!r.eof && embGuard < 32) {
            embGuard++;
            const eTag = r.readByte();
            if (eTag === REC_END) break;
            if (eTag === REC_EMBELL) {
              const eOpts = r.readByte();
              if (eOpts & OPT_NUDGE) r.readNudge();
              embells.push(r.readByte());
            } else if (eTag >= 100) {
              r.skip(r.readMtefUint());
            } else {
              break;
            }
          }
        }

        const fontName =
          typeface < 0 ? state.fonts[-typeface] : undefined;
        const code = mtcode ?? rawChar ?? 0;
        const char = code > 0 ? String.fromCharCode(code) : '';
        nodes.push({
          kind: 'char',
          char,
          rawChar,
          mtcode,
          typeface,
          isFuncStart: Boolean(opts & OPT_CHAR_FUNC_START),
          fontName,
          embells,
          colorHex: state.currentColor,
        });
        break;
      }

      case REC_TMPL: {
        const opts = r.readByte();
        if (opts & OPT_NUDGE) r.readNudge();
        const selector = r.readByte();
        const varLo = r.readByte();
        let variation = varLo;
        if (varLo & 0x80) {
          const varHi = r.readByte();
          variation = (varLo & 0x7f) | (varHi << 8);
        }
        const tmplOpts = r.readByte();
        const items = readRecordListV5(r, state, depth + 1);
        nodes.push({ kind: 'tmpl', selector, variation, tmplOpts, items });
        break;
      }

      case REC_PILE: {
        const opts = r.readByte();
        if (opts & OPT_NUDGE) r.readNudge();
        const halign = r.readByte();
        const valign = r.readByte();
        if (opts & OPT_LP_RULER) {
          if (r.peekByte() === REC_RULER) r.readByte();
          skipRuler(r);
        }
        const lines = readRecordListV5(r, state, depth + 1);
        nodes.push({ kind: 'pile', halign, valign, lines });
        break;
      }

      case REC_MATRIX: {
        const opts = r.readByte();
        if (opts & OPT_NUDGE) r.readNudge();
        r.readByte(); // valign
        r.readByte(); // hjust
        r.readByte(); // vjust
        const rows = r.readByte();
        const cols = r.readByte();
        const rowPartBytes = Math.ceil((2 * (rows + 1)) / 8);
        const colPartBytes = Math.ceil((2 * (cols + 1)) / 8);
        r.skip(rowPartBytes + colPartBytes);
        const cells = readRecordListV5(r, state, depth + 1);
        nodes.push({ kind: 'matrix', rows, cols, cells });
        break;
      }

      case REC_EMBELL: {
        const opts = r.readByte();
        if (opts & OPT_NUDGE) r.readNudge();
        r.readByte(); // embell type
        break;
      }

      case REC_RULER: {
        skipRuler(r);
        break;
      }

      case REC_FONT_STYLE_DEF: {
        r.readMtefUint(); // font_def_index
        r.readByte(); // char_style
        break;
      }

      case REC_SIZE: {
        const lsize = r.readByte();
        if (lsize === 101) {
          // explicit point size in 32nds of a pt
          r.readInt16LE();
        } else if (lsize === 100) {
          r.readByte(); // lsize
          r.readInt16LE(); // dsize
        } else {
          r.readByte(); // dsize + 128
        }
        break;
      }

      case REC_FULL:
      case REC_SUB:
      case REC_SUB2:
      case REC_SYM:
      case REC_SUBSYM:
        break;

      case REC_COLOR: {
        const colorIdx = r.readMtefUint();
        state.currentColor = colorIdx > 0 ? state.colors[colorIdx] : undefined;
        break;
      }

      case REC_COLOR_DEF: {
        const opts = r.readByte();
        const numVals = opts & OPT_COLOR_CMYK ? 4 : 3;
        const vals: number[] = [];
        for (let i = 0; i < numVals; i++) {
          vals.push(r.readUint16LE());
        }
        if (opts & OPT_COLOR_NAME) {
          r.readCString();
        }
        if (!(opts & OPT_COLOR_CMYK) && vals.length === 3) {
          const toHex = (v: number) =>
            Math.max(0, Math.min(255, Math.round((v / 1000) * 255)))
              .toString(16)
              .padStart(2, '0')
              .toUpperCase();
          const hex = `#${toHex(vals[0])}${toHex(vals[1])}${toHex(vals[2])}`;
          state.colors.push(hex);
        } else {
          state.colors.push('#000000');
        }
        break;
      }

      case REC_FONT_DEF: {
        r.readMtefUint(); // enc_def_index
        const fontName = r.readCString();
        state.fonts.push(fontName);
        break;
      }

      case REC_EQN_PREFS: {
        r.readByte(); // options
        const sizeCount = r.readByte();
        r.skipNibbleDimensionArray(sizeCount);
        const spaceCount = r.readByte();
        r.skipNibbleDimensionArray(spaceCount);
        const styleCount = r.readByte();
        for (let i = 0; i < styleCount; i++) {
          const fontIdx = r.readMtefUint();
          if (fontIdx !== 0) {
            r.readByte(); // char_style
          }
        }
        break;
      }

      case REC_ENCODING_DEF: {
        r.readCString();
        break;
      }

      default: {
        // Unknown record; stop safely to prevent corrupt stream hang
        return nodes;
      }
    }
  }
  return nodes;
}

// MTEF v3/v4 parser (Equation Editor 3.0 & MathType 3.x)
function readRecordListV3(
  r: BinaryReader,
  state: ParserState,
  depth = 0
): MtefNode[] {
  const nodes: MtefNode[] = [];
  if (depth > 64) return nodes;

  let guard = 0;
  while (!r.eof && guard < 10000) {
    guard++;
    const tagByte = r.readByte();
    const tag = tagByte & 0x0f;
    const xfNudge = (tagByte & 0x10) !== 0;

    if (tag === REC_END) break;

    switch (tag) {
      case REC_LINE: {
        if (xfNudge) r.readNudge();
        const isNull = (tagByte & 0x20) !== 0;
        if (tagByte & 0x40) skipRuler(r);
        if (isNull) {
          nodes.push({ kind: 'line', isNull: true, items: [] });
        } else {
          const items = readRecordListV3(r, state, depth + 1);
          nodes.push({ kind: 'line', isNull: false, items });
        }
        break;
      }

      case REC_CHAR: {
        if (xfNudge) r.readNudge();
        const typeface = r.readByte() - 128;
        const charCode = r.readUint16LE();
        const hasEmbell = (tagByte & 0x20) !== 0;
        const embells: number[] = [];
        if (hasEmbell) {
          let embGuard = 0;
          while (!r.eof && embGuard < 32) {
            embGuard++;
            const eb = r.readByte();
            if ((eb & 0x0f) === REC_END) break;
            if ((eb & 0x0f) === REC_EMBELL) {
              if (eb & 0x10) r.readNudge();
              embells.push(r.readByte());
            } else {
              break;
            }
          }
        }
        const fontName = typeface < 0 ? state.fonts[-typeface] : undefined;
        nodes.push({
          kind: 'char',
          char: charCode > 0 ? String.fromCharCode(charCode) : '',
          rawChar: charCode,
          mtcode: charCode,
          typeface,
          isFuncStart: false,
          fontName,
          embells,
        });
        break;
      }

      case REC_TMPL: {
        if (xfNudge) r.readNudge();
        const selector = r.readByte();
        const variation = r.readByte();
        const tmplOpts = r.readByte();
        const items = readRecordListV3(r, state, depth + 1);
        nodes.push({ kind: 'tmpl', selector, variation, tmplOpts, items });
        break;
      }

      case REC_PILE: {
        if (xfNudge) r.readNudge();
        const halign = r.readByte();
        const valign = r.readByte();
        if (tagByte & 0x40) skipRuler(r);
        const lines = readRecordListV3(r, state, depth + 1);
        nodes.push({ kind: 'pile', halign, valign, lines });
        break;
      }

      case REC_MATRIX: {
        if (xfNudge) r.readNudge();
        r.readByte(); // valign
        r.readByte(); // hjust
        r.readByte(); // vjust
        const rows = r.readByte();
        const cols = r.readByte();
        const rowPartBytes = Math.ceil((2 * (rows + 1)) / 8);
        const colPartBytes = Math.ceil((2 * (cols + 1)) / 8);
        r.skip(rowPartBytes + colPartBytes);
        const cells = readRecordListV3(r, state, depth + 1);
        nodes.push({ kind: 'matrix', rows, cols, cells });
        break;
      }

      case REC_EMBELL: {
        if (xfNudge) r.readNudge();
        r.readByte();
        break;
      }

      case REC_RULER:
        skipRuler(r);
        break;

      case 8: {
        // v3 FONT record: tface (1 byte) + style (1 byte) + name (C-string)
        r.readByte();
        r.readByte();
        const name = r.readCString();
        state.fonts.push(name);
        break;
      }

      case REC_SIZE: {
        const lsize = r.readByte();
        if (lsize === 101) {
          r.readInt16LE();
        } else if (lsize === 100) {
          r.readByte();
          r.readInt16LE();
        } else {
          r.readByte();
        }
        break;
      }

      case REC_FULL:
      case REC_SUB:
      case REC_SUB2:
      case REC_SYM:
      case REC_SUBSYM:
        break;

      default:
        return nodes;
    }
  }
  return nodes;
}

// ==================== Character & Encoding Tables ====================

// Windows Symbol font 8-bit positions (0x20..0xFF) & Unicode PUA 0xF020..0xF0FF
const SYMBOL_FONT_MAP: Record<number, string> = {
  0x20: ' ',
  0x21: '!',
  0x22: '\\forall ',
  0x23: '\\#',
  0x24: '\\exists ',
  0x25: '\\%',
  0x26: '\\&',
  0x27: '\\ni ',
  0x28: '(',
  0x29: ')',
  0x2a: '*',
  0x2b: '+',
  0x2c: ',',
  0x2d: '-',
  0x2e: '.',
  0x2f: '/',
  0x30: '0',
  0x31: '1',
  0x32: '2',
  0x33: '3',
  0x34: '4',
  0x35: '5',
  0x36: '6',
  0x37: '7',
  0x38: '8',
  0x39: '9',
  0x3a: ':',
  0x3b: ';',
  0x3c: '<',
  0x3d: '=',
  0x3e: '>',
  0x3f: '?',
  0x40: '\\cong ',
  0x41: '\\mathrm{A}',
  0x42: '\\mathrm{B}',
  0x43: '\\mathrm{X}',
  0x44: '\\Delta ',
  0x45: '\\mathrm{E}',
  0x46: '\\Phi ',
  0x47: '\\Gamma ',
  0x48: '\\mathrm{H}',
  0x49: '\\mathrm{I}',
  0x4a: '\\vartheta ',
  0x4b: '\\mathrm{K}',
  0x4c: '\\Lambda ',
  0x4d: '\\mathrm{M}',
  0x4e: '\\mathrm{N}',
  0x4f: '\\mathrm{O}',
  0x50: '\\Pi ',
  0x51: '\\Theta ',
  0x52: '\\mathrm{P}',
  0x53: '\\Sigma ',
  0x54: '\\mathrm{T}',
  0x55: '\\Upsilon ',
  0x56: '\\varsigma ',
  0x57: '\\Omega ',
  0x58: '\\Xi ',
  0x59: '\\Psi ',
  0x5a: '\\mathrm{Z}',
  0x5b: '[',
  0x5c: '\\therefore ',
  0x5d: ']',
  0x5e: '\\perp ',
  0x5f: '\\_',
  0x60: '\\overline{\\ }',
  0x61: '\\alpha ',
  0x62: '\\beta ',
  0x63: '\\chi ',
  0x64: '\\delta ',
  0x65: '\\varepsilon ',
  0x66: '\\phi ',
  0x67: '\\gamma ',
  0x68: '\\eta ',
  0x69: '\\iota ',
  0x6a: '\\varphi ',
  0x6b: '\\kappa ',
  0x6c: '\\lambda ',
  0x6d: '\\mu ',
  0x6e: '\\nu ',
  0x6f: 'o',
  0x70: '\\pi ',
  0x71: '\\theta ',
  0x72: '\\rho ',
  0x73: '\\sigma ',
  0x74: '\\tau ',
  0x75: '\\upsilon ',
  0x76: '\\varpi ',
  0x77: '\\omega ',
  0x78: '\\xi ',
  0x79: '\\psi ',
  0x7a: '\\zeta ',
  0x7b: '\\{',
  0x7c: '|',
  0x7d: '\\}',
  0x7e: '\\sim ',
  0xa0: '\\ ',
  0xa1: '\\Upsilon ',
  0xa2: "'",
  0xa3: '\\leq ',
  0xa4: '/',
  0xa5: '\\infty ',
  0xa6: 'f',
  0xa7: '\\clubsuit ',
  0xa8: '\\diamondsuit ',
  0xa9: '\\heartsuit ',
  0xaa: '\\spadesuit ',
  0xab: '\\leftrightarrow ',
  0xac: '\\leftarrow ',
  0xad: '\\uparrow ',
  0xae: '\\to ',
  0xaf: '\\downarrow ',
  0xb0: '^\\circ ',
  0xb1: '\\pm ',
  0xb2: "''",
  0xb3: '\\geq ',
  0xb4: '\\times ',
  0xb5: '\\propto ',
  0xb6: '\\partial ',
  0xb7: '\\bullet ',
  0xb8: '\\div ',
  0xb9: '\\neq ',
  0xba: '\\equiv ',
  0xbb: '\\approx ',
  0xbc: '\\dots ',
  0xbd: '|',
  0xbe: '-',
  0xbf: '\\hookleftarrow ',
  0xc0: '\\aleph ',
  0xc1: '\\Im ',
  0xc2: '\\Re ',
  0xc3: '\\wp ',
  0xc4: '\\otimes ',
  0xc5: '\\oplus ',
  0xc6: '\\emptyset ',
  0xc7: '\\cap ',
  0xc8: '\\cup ',
  0xc9: '\\supset ',
  0xca: '\\supseteq ',
  0xcb: '\\not\\subset ',
  0xcc: '\\subset ',
  0xcd: '\\subseteq ',
  0xce: '\\in ',
  0xcf: '\\notin ',
  0xd0: '\\angle ',
  0xd1: '\\nabla ',
  0xd6: '\\sqrt{}',
  0xd7: '\\cdot ',
  0xd8: '\\neg ',
  0xd9: '\\land ',
  0xda: '\\lor ',
  0xdb: '\\Leftrightarrow ',
  0xdc: '\\Leftarrow ',
  0xdd: '\\Uparrow ',
  0xde: '\\Rightarrow ',
  0xdf: '\\Downarrow ',
  0xe0: '\\diamond ',
  0xe1: '\\langle ',
  0xe5: '\\sum ',
  0xf1: '\\rangle ',
  0xf2: '\\int ',
};

// MT Extra 8-bit character mapping
const MTEXTRA_MAP: Record<number, string> = {
  0x22: '\\forall ',
  0x23: '\\leftrightarrow ',
  0x24: '\\nexists ',
  0x25: '%',
  0x28: '\\subset ',
  0x29: '\\supset ',
  0x2b: '\\triangle ',
  0x2f: '/',
  0x30: '\\hbar ',
  0x31: "'",
  0x32: "''",
  0x33: "'''",
  0x3c: '\\langle ',
  0x3d: '=',
  0x3e: '\\rangle ',
  0x41: '\\parallel ',
  0x42: '\\perp ',
  0x43: '^\\circ ',
  0x44: '\\Delta ',
  0x46: '\\perp ',
  0x47: '\\parallel ',
  0x48: '\\triangle ',
  0x49: '\\because ',
  0x4a: '\\therefore ',
  0x4c: '\\angle ',
  0x4d: '\\mp ',
  0x61: '\\dots ',
  0x62: '\\cdots ',
  0x63: '\\vdots ',
  0x64: '\\ddots ',
  0x6c: '\\ell ',
  0x6f: '\\circ ',
  0x70: '\\preceq ',
  0x71: '\\succeq ',
  0x73: '\\smile ',
  0x74: '\\frown ',
};

const UNICODE_MTCODE_TO_LATEX: Record<number, string> = {
  0x0009: ' ',
  0x000a: ' ',
  0x000d: ' ',
  0x0020: ' ',
  0x00a0: ' ',
  0x00b0: '^\\circ ',
  0x00b1: '\\pm ',
  0x00b7: '\\cdot ',
  0x00d7: '\\times ',
  0x00f7: '\\div ',
  0x0391: 'A',
  0x0392: 'B',
  0x0393: '\\Gamma ',
  0x0394: '\\Delta ',
  0x0395: 'E',
  0x0396: 'Z',
  0x0397: 'H',
  0x0398: '\\Theta ',
  0x0399: 'I',
  0x039a: 'K',
  0x039b: '\\Lambda ',
  0x039c: 'M',
  0x039d: 'N',
  0x039e: '\\Xi ',
  0x039f: 'O',
  0x03a0: '\\Pi ',
  0x03a1: 'P',
  0x03a3: '\\Sigma ',
  0x03a4: 'T',
  0x03a5: '\\Upsilon ',
  0x03a6: '\\Phi ',
  0x03a7: 'X',
  0x03a8: '\\Psi ',
  0x03a9: '\\Omega ',
  0x03b1: '\\alpha ',
  0x03b2: '\\beta ',
  0x03b3: '\\gamma ',
  0x03b4: '\\delta ',
  0x03b5: '\\varepsilon ',
  0x03b6: '\\zeta ',
  0x03b7: '\\eta ',
  0x03b8: '\\theta ',
  0x03b9: '\\iota ',
  0x03ba: '\\kappa ',
  0x03bb: '\\lambda ',
  0x03bc: '\\mu ',
  0x03bd: '\\nu ',
  0x03be: '\\xi ',
  0x03bf: 'o',
  0x03c0: '\\pi ',
  0x03c1: '\\rho ',
  0x03c2: '\\varsigma ',
  0x03c3: '\\sigma ',
  0x03c4: '\\tau ',
  0x03c5: '\\upsilon ',
  0x03c6: '\\varphi ',
  0x03c7: '\\chi ',
  0x03c8: '\\psi ',
  0x03c9: '\\omega ',
  0x03d1: '\\vartheta ',
  0x03d5: '\\phi ',
  0x03d6: '\\varpi ',
  0x03f5: '\\epsilon ',
  0x2000: ' ',
  0x2001: ' ',
  0x2002: ' ',
  0x2003: ' ',
  0x2004: ' ',
  0x2005: ' ',
  0x2006: ' ',
  0x2007: ' ',
  0x2008: ' ',
  0x2009: ' ',
  0x200a: '',
  0x200b: '',
  0x200c: '',
  0x200d: '',
  0x200e: '',
  0x200f: '',
  0x2013: '-',
  0x2014: '-',
  0x2022: '\\bullet ',
  0x2026: '\\dots ',
  0x202f: ' ',
  0x2032: "'",
  0x2033: "''",
  0x2034: "'''",
  0x205f: '\\:',
  0x2060: '',
  0x2061: '',
  0x2062: '',
  0x2063: '',
  0x2064: '',
  0x3000: ' ',
  0xfeff: '',
  0x2102: '\\mathbb{C}',
  0x210f: '\\hbar ',
  0x2111: '\\Im ',
  0x2113: '\\ell ',
  0x2115: '\\mathbb{N}',
  0x2118: '\\wp ',
  0x211a: '\\mathbb{Q}',
  0x211c: '\\Re ',
  0x211d: '\\mathbb{R}',
  0x2124: '\\mathbb{Z}',
  0x2135: '\\aleph ',
  0x2190: '\\leftarrow ',
  0x2191: '\\uparrow ',
  0x2192: '\\to ',
  0x2193: '\\downarrow ',
  0x2194: '\\leftrightarrow ',
  0x21a6: '\\mapsto ',
  0x21d0: '\\Leftarrow ',
  0x21d1: '\\Uparrow ',
  0x21d2: '\\Rightarrow ',
  0x21d3: '\\Downarrow ',
  0x21d4: '\\Leftrightarrow ',
  0x2200: '\\forall ',
  0x2202: '\\partial ',
  0x2203: '\\exists ',
  0x2204: '\\nexists ',
  0x2205: '\\emptyset ',
  0x2207: '\\nabla ',
  0x2208: '\\in ',
  0x2209: '\\notin ',
  0x220b: '\\ni ',
  0x220f: '\\prod ',
  0x2210: '\\coprod ',
  0x2211: '\\sum ',
  0x2212: '-',
  0x2213: '\\mp ',
  0x2215: '/',
  0x2216: '\\setminus ',
  0x2217: '*',
  0x2218: '\\circ ',
  0x2219: '\\cdot ',
  0x221d: '\\propto ',
  0x221e: '\\infty ',
  0x2220: '\\angle ',
  0x2223: '\\mid ',
  0x2225: '\\parallel ',
  0x2226: '\\nparallel ',
  0x2227: '\\land ',
  0x2228: '\\lor ',
  0x2229: '\\cap ',
  0x222a: '\\cup ',
  0x222b: '\\int ',
  0x222c: '\\iint ',
  0x222d: '\\iiint ',
  0x222e: '\\oint ',
  0x2234: '\\therefore ',
  0x2235: '\\because ',
  0x223c: '\\sim ',
  0x2243: '\\simeq ',
  0x2245: '\\cong ',
  0x2248: '\\approx ',
  0x2260: '\\neq ',
  0x2261: '\\equiv ',
  0x2264: '\\leq ',
  0x2265: '\\geq ',
  0x226a: '\\ll ',
  0x226b: '\\gg ',
  0x2282: '\\subset ',
  0x2283: '\\supset ',
  0x2284: '\\not\\subset ',
  0x2286: '\\subseteq ',
  0x2287: '\\supseteq ',
  0x2295: '\\oplus ',
  0x2297: '\\otimes ',
  0x22a5: '\\perp ',
  0x22c2: '\\bigcap ',
  0x22c3: '\\bigcup ',
  0x22c5: '\\cdot ',
  0x22ef: '\\cdots ',
  0x22ee: '\\vdots ',
  0x22f1: '\\ddots ',
  0x2308: '\\lceil ',
  0x2309: '\\rceil ',
  0x230a: '\\lfloor ',
  0x230b: '\\rfloor ',
  0x2329: '\\langle ',
  0x232a: '\\rangle ',
  0x219b: '\\nrightarrow ',
  0x21ae: '\\nleftrightarrow ',
  0x21ce: '\\nLeftrightarrow ',
  0x21cf: '\\nRightarrow ',
  0x2224: '\\nmid ',
  0x2241: '\\nsim ',
  0x2247: '\\ncong ',
  0x2262: '\\not\\equiv ',
  0x2268: '\\lneq ',
  0x2269: '\\gneq ',
  0x226e: '\\nless ',
  0x226f: '\\ngtr ',
  0x2270: '\\nleq ',
  0x2271: '\\ngeq ',
  0x2285: '\\not\\supset ',
  0x2288: '\\nsubseteq ',
  0x2289: '\\nsupseteq ',
  0x22a2: '\\vdash ',
  0x22a3: '\\dashv ',
  0x22a8: '\\vDash ',
  0x25b3: '\\triangle ',
  0x27e8: '\\langle ',
  0x27e9: '\\rangle ',
  0x27fa: '\\Longleftrightarrow ',
  0x27f9: '\\Longrightarrow ',
  0x27f8: '\\Longleftarrow ',
  // MathType PUA space & symbol codes (0xE900..0xEFFF)
  0xe900: '',
  0xe901: ' ',
  0xe902: '\\,',
  0xe903: ' ',
  0xe904: '\\;',
  0xe905: '\\quad ',
  0xe906: '\\qquad ',
  0xe907: ' ',
  0xe908: ' ',
  0xe909: ' ',
  0xe90a: ' ',
  0xe90b: ' ',
  0xe90c: ' ',
  0xea06: '\\because ',
  0xea07: '\\therefore ',
  0xea0b: '\\parallel ',
  0xea0c: '\\nparallel ',
  0xea32: '\\neq ',
  0xea34: '\\equiv ',
  0xea35: '\\approx ',
  0xea38: '\\leq ',
  0xea39: '\\geq ',
  0xeb00: '\\vec{}',
  0xec02: '\\cdots ',
  0xec03: '\\vdots ',
  0xec04: '\\ddots ',
  0xee04: '\\perp ',
  0xee05: '\\parallel ',
  0xee06: '\\angle ',
  0xee0a: '\\triangle ',
  0xef00: '',
  0xef01: ' ',
  0xef02: '\\,',
  0xef03: '\\;',
  0xef04: '\\quad ',
  0xef05: '\\qquad ',
  0xef06: ' ',
  0xef07: ' ',
  0xef08: ' ',
  0xef09: ' ',
  0xef0a: ' ',
};

const LATEX_FUNCS = new Set([
  'sin',
  'cos',
  'tan',
  'cot',
  'sec',
  'csc',
  'arcsin',
  'arccos',
  'arctan',
  'sinh',
  'cosh',
  'tanh',
  'log',
  'ln',
  'lg',
  'exp',
  'lim',
  'limsup',
  'liminf',
  'max',
  'min',
  'sup',
  'inf',
  'det',
  'gcd',
  'mod',
  'arg',
  'deg',
  'dim',
  'hom',
  'ker',
]);

function charNodeToBaseLatex(node: Extract<MtefNode, { kind: 'char' }>): {
  latex: string;
  isTextLetter: boolean;
  isFunctionWordChar: boolean;
} {
  const code = node.mtcode ?? node.rawChar ?? 0;
  const fName = (node.fontName ?? '').toLowerCase();

  // 1. MT Extra font (must run before generic 0xF0xx Symbol PUA check)
  if (node.typeface === FN_MTEXTRA || fName.includes('extra')) {
    const raw = node.rawChar ?? (code >= 0xf000 ? code - 0xf000 : code);
    if (MTEXTRA_MAP[raw]) {
      return { latex: MTEXTRA_MAP[raw], isTextLetter: false, isFunctionWordChar: false };
    }
  }

  // 2. Symbol font (8-bit rawChar from MTEF v3/v4 or OPT_CHAR_ENC_CHAR_8)
  if (
    node.rawChar !== undefined &&
    (node.typeface === FN_SYMBOL || (fName.includes('symbol') && node.rawChar < 0x100))
  ) {
    if (SYMBOL_FONT_MAP[node.rawChar]) {
      return { latex: SYMBOL_FONT_MAP[node.rawChar], isTextLetter: false, isFunctionWordChar: false };
    }
  }

  // 3. Windows Symbol PUA (0xF020..0xF0FF)
  if (code >= 0xf020 && code <= 0xf0ff) {
    const mapped = SYMBOL_FONT_MAP[code - 0xf000];
    if (mapped) return { latex: mapped, isTextLetter: false, isFunctionWordChar: false };
    return { latex: ' ', isTextLetter: false, isFunctionWordChar: false };
  }

  if (UNICODE_MTCODE_TO_LATEX[code] !== undefined) {
    return {
      latex: UNICODE_MTCODE_TO_LATEX[code],
      isTextLetter: false,
      isFunctionWordChar: false,
    };
  }

  // Guard against control characters and unmapped PUA/replacement glyphs that crash KaTeX as □
  if (code < 0x20 || (code >= 0xe000 && code <= 0xf8ff) || code === 0xfffd) {
    return { latex: '', isTextLetter: false, isFunctionWordChar: false };
  }

  const ch = code > 0 ? String.fromCharCode(code) : node.char;
  if (!ch) return { latex: '', isTextLetter: false, isFunctionWordChar: false };

  if (ch === '\\') {
    return {
      latex: node.typeface === FN_TEXT ? '\\textbackslash{}' : '\\setminus ',
      isTextLetter: false,
      isFunctionWordChar: false,
    };
  }
  if (ch === '{') return { latex: '\\{', isTextLetter: false, isFunctionWordChar: false };
  if (ch === '}') return { latex: '\\}', isTextLetter: false, isFunctionWordChar: false };
  if (ch === '%') return { latex: '\\%', isTextLetter: false, isFunctionWordChar: false };
  if (ch === '&') return { latex: '\\&', isTextLetter: false, isFunctionWordChar: false };
  if (ch === '#') return { latex: '\\#', isTextLetter: false, isFunctionWordChar: false };
  if (ch === '$') return { latex: '\\$', isTextLetter: false, isFunctionWordChar: false };
  if (ch === '_') return { latex: '\\_', isTextLetter: false, isFunctionWordChar: false };
  if (ch === '^') {
    return {
      latex: node.typeface === FN_TEXT ? '\\textasciicircum{}' : '\\hat{\\ }',
      isTextLetter: false,
      isFunctionWordChar: false,
    };
  }
  if (ch === '~') {
    return {
      latex: node.typeface === FN_TEXT ? '\\textasciitilde{}' : '\\sim ',
      isTextLetter: false,
      isFunctionWordChar: false,
    };
  }

  if (node.typeface === FN_VECTOR && /[A-Za-z0-9]/.test(ch)) {
    return { latex: `\\mathbf{${ch}}`, isTextLetter: false, isFunctionWordChar: false };
  }

  if (node.typeface === FN_FUNCTION && /[A-Za-z]/.test(ch)) {
    return { latex: ch, isTextLetter: false, isFunctionWordChar: true };
  }

  if (node.typeface === FN_TEXT && !/^[0-9+\-=<>()[\]/.,;:!|]$/.test(ch)) {
    return { latex: ch, isTextLetter: true, isFunctionWordChar: false };
  }

  return { latex: ch, isTextLetter: false, isFunctionWordChar: false };
}

function applyEmbellishments(base: string, embells: number[]): string {
  if (!embells || embells.length === 0) return base;
  let out = base.trim();
  if (!out) return out;
  for (const emb of embells) {
    switch (emb) {
      case EMB_1DOT:
        out = `\\dot{${out}}`;
        break;
      case EMB_2DOT:
        out = `\\ddot{${out}}`;
        break;
      case EMB_3DOT:
      case EMB_4DOT:
        out = `\\dddot{${out}}`;
        break;
      case EMB_1PRIME:
        out = `${out}'`;
        break;
      case EMB_2PRIME:
        out = `${out}''`;
        break;
      case EMB_3PRIME:
        out = `${out}'''`;
        break;
      case EMB_BPRIME:
        out = `\\backprime ${out}`;
        break;
      case EMB_TILDE:
        out = out.length > 1 && !out.startsWith('\\') ? `\\widetilde{${out}}` : `\\tilde{${out}}`;
        break;
      case EMB_HAT:
        out = out.length > 1 && !out.startsWith('\\') ? `\\widehat{${out}}` : `\\hat{${out}}`;
        break;
      case EMB_NOT:
        out = `\\not ${out}${/\\[a-zA-Z]+$/.test(out) ? ' ' : ''}`;
        break;
      case EMB_RARROW:
      case EMB_R1ARROW:
        out = out.length > 1 && !out.startsWith('\\') ? `\\overrightarrow{${out}}` : `\\vec{${out}}`;
        break;
      case EMB_LARROW:
      case EMB_L1ARROW:
        out = `\\overleftarrow{${out}}`;
        break;
      case EMB_BARROW:
        out = `\\overleftrightarrow{${out}}`;
        break;
      case EMB_MBAR:
      case EMB_OBAR:
        out = `\\overline{${out}}`;
        break;
      case EMB_FROWN:
        out = `\\overset{\\frown}{${out}}`;
        break;
      case EMB_SMILE:
        out = `\\overset{\\smile}{${out}}`;
        break;
      case EMB_X_BARS:
      case EMB_UP_BAR:
      case EMB_DN_BAR:
        out = `\\cancel{${out}}`;
        break;
      case EMB_U_BAR:
        out = `\\underline{${out}}`;
        break;
      case EMB_U_1DOT:
      case EMB_U_2DOT:
      case EMB_U_3DOT:
      case EMB_U_4DOT:
        out = `\\underset{\\cdot}{${out}}`;
        break;
      case EMB_U_TILDE:
        out = `\\underset{\\sim}{${out}}`;
        break;
      case EMB_U_FROWN:
        out = `\\underset{\\frown}{${out}}`;
        break;
      case EMB_U_SMILE:
        out = `\\underset{\\smile}{${out}}`;
        break;
      case EMB_U_RARROW:
      case EMB_U_R1ARROW:
        out = `\\underrightarrow{${out}}`;
        break;
      case EMB_U_LARROW:
      case EMB_U_L1ARROW:
        out = `\\underleftarrow{${out}}`;
        break;
      case EMB_U_BARROW:
        out = `\\underleftrightarrow{${out}}`;
        break;
      default:
        break;
    }
  }
  return out;
}

function wrapBraces(s: string): string {
  const t = s.trim();
  if (!t) return '{}';
  if (t.length === 1 && !/[\\{}^_]/.test(t)) return t;
  return `{${t}}`;
}

function lineNodeToLatex(node: MtefNode | undefined): string {
  if (!node) return '';
  return nodeToLatex(node).trim();
}

function delimiterForFence(
  selector: number,
  fenceNode: MtefNode | undefined,
  side: 'left' | 'right'
): string {
  if (fenceNode && fenceNode.kind === 'char') {
    const raw = charNodeToBaseLatex(fenceNode).latex.trim();
    if (raw === '\\{' || raw === '{') return '\\{';
    if (raw === '\\}' || raw === '}') return '\\}';
    if (raw === '|' || raw === '\\mid') return '|';
    if (raw === '\\parallel' || raw === '‖') return '\\|';
    if (raw === '\\langle' || raw === '<') return '\\langle ';
    if (raw === '\\rangle' || raw === '>') return '\\rangle ';
    if (raw) return raw;
  }
  switch (selector) {
    case TM_ANGLE:
      return side === 'left' ? '\\langle ' : '\\rangle ';
    case TM_PAREN:
      return side === 'left' ? '(' : ')';
    case TM_BRACE:
      return side === 'left' ? '\\{' : '\\}';
    case TM_BRACK:
    case TM_OBRACK:
      return side === 'left' ? '[' : ']';
    case TM_BAR:
      return '|';
    case TM_DBAR:
      return '\\|';
    case TM_FLOOR:
      return side === 'left' ? '\\lfloor ' : '\\rfloor ';
    case TM_CEILING:
      return side === 'left' ? '\\lceil ' : '\\rceil ';
    default:
      return side === 'left' ? '(' : ')';
  }
}

function tmplNodeToLatex(node: Extract<MtefNode, { kind: 'tmpl' }>): string {
  const { selector, variation, items } = node;
  const lineItems = items.filter((n) => n.kind === 'line' || n.kind === 'pile' || n.kind === 'matrix');
  const charItems = items.filter((n): n is Extract<MtefNode, { kind: 'char' }> => n.kind === 'char');

  // 1. Fences (0..9) + Dirac (30)
  if ((selector >= TM_ANGLE && selector <= TM_INTERVAL) || selector === TM_DIRAC) {
    const mainNode = lineItems[0];
    const nonWsMain =
      mainNode?.kind === 'line'
        ? mainNode.items.filter((n) => n.kind !== 'char' || n.char.trim() !== '')
        : [];
    const unwrappedMain =
      mainNode?.kind === 'line' && nonWsMain.length === 1 ? nonWsMain[0] : mainNode;

    // Special case: left brace around a PILE or 1-column MATRIX -> \begin{cases}...\end{cases}
    if (selector === TM_BRACE && unwrappedMain) {
      const hasLeft = (variation & 0x01) !== 0 || variation === 0;
      const hasRight = (variation & 0x02) !== 0;
      if (hasLeft && !hasRight && unwrappedMain.kind === 'pile') {
        const rows = unwrappedMain.lines.map(lineNodeToLatex).filter(Boolean);
        return `\\begin{cases} ${rows.join(' \\\\ ')} \\end{cases}`;
      }
      if (hasLeft && !hasRight && unwrappedMain.kind === 'matrix' && unwrappedMain.cols === 1) {
        const rows = unwrappedMain.cells.map(lineNodeToLatex).filter(Boolean);
        return `\\begin{cases} ${rows.join(' \\\\ ')} \\end{cases}`;
      }
    }

    // Matrix enclosed in (), [], ||, \|\|
    if (unwrappedMain?.kind === 'matrix') {
      const matrixBody = matrixRowsLatex(unwrappedMain);
      if (selector === TM_PAREN) return `\\begin{pmatrix} ${matrixBody} \\end{pmatrix}`;
      if (selector === TM_BRACK) return `\\begin{bmatrix} ${matrixBody} \\end{bmatrix}`;
      if (selector === TM_BRACE && (variation & 0x03) === 0x03) {
        return `\\begin{Bmatrix} ${matrixBody} \\end{Bmatrix}`;
      }
      if (selector === TM_BAR) return `\\begin{vmatrix} ${matrixBody} \\end{vmatrix}`;
      if (selector === TM_DBAR) return `\\begin{Vmatrix} ${matrixBody} \\end{Vmatrix}`;
    }

    const inner = lineNodeToLatex(mainNode);
    if (selector === TM_INTERVAL) {
      const leftD = delimiterForFence(selector, charItems[0], 'left');
      const rightD = delimiterForFence(selector, charItems[1], 'right');
      return `\\left${leftD}${inner}\\right${rightD}`;
    }

    if (selector === TM_DIRAC) {
      const hasLeft = (variation & 0x01) !== 0;
      const hasRight = (variation & 0x02) !== 0;
      if (hasLeft && hasRight && lineItems.length >= 2) {
        return `\\left\\langle ${lineNodeToLatex(lineItems[0])} \\middle| ${lineNodeToLatex(lineItems[1])} \\right\\rangle`;
      }
      if (hasLeft) return `\\left\\langle ${inner} \\right|`;
      return `\\left| ${inner} \\right\\rangle`;
    }

    const hasLeft = variation === 0 ? true : (variation & 0x01) !== 0;
    const hasRight = variation === 0 ? true : (variation & 0x02) !== 0;
    let leftCharNode: MtefNode | undefined;
    let rightCharNode: MtefNode | undefined;
    let cIdx = 0;
    if (hasLeft) leftCharNode = charItems[cIdx++];
    if (hasRight) rightCharNode = charItems[cIdx++];

    const leftDelim = hasLeft ? delimiterForFence(selector, leftCharNode, 'left') : '.';
    const rightDelim = hasRight ? delimiterForFence(selector, rightCharNode, 'right') : '.';
    return `\\left${leftDelim}${inner}\\right${rightDelim}`;
  }

  // 2. Root (10)
  if (selector === TM_ROOT) {
    const radicand = lineNodeToLatex(lineItems[0]);
    const degree = lineItems.length > 1 ? lineNodeToLatex(lineItems[1]) : '';
    return degree ? `\\sqrt[${degree}]{${radicand}}` : `\\sqrt{${radicand}}`;
  }

  // 3. Fraction (11)
  if (selector === TM_FRACT) {
    const num = lineNodeToLatex(lineItems[0]);
    const den = lineNodeToLatex(lineItems[1]);
    if (variation & 0x02) {
      return `${num}/${den}`;
    }
    return `\\frac{${num}}{${den}}`;
  }

  // 4. Underbar / Overbar (12, 13)
  if (selector === TM_UBAR) {
    return `\\underline{${lineNodeToLatex(lineItems[0])}}`;
  }
  if (selector === TM_OBAR) {
    return `\\overline{${lineNodeToLatex(lineItems[0])}}`;
  }

  // 5. Arrow template (14): over/under arrow with top/bottom labels
  if (selector === TM_ARROW) {
    const topSlot = lineItems[0] ? lineNodeToLatex(lineItems[0]) : '';
    const botSlot = lineItems[1] ? lineNodeToLatex(lineItems[1]) : '';
    if (variation & 0x01) {
      // left arrow
      return botSlot ? `\\xleftarrow[${botSlot}]{${topSlot}}` : `\\xleftarrow{${topSlot}}`;
    }
    if (variation & 0x02) {
      // right arrow
      return botSlot ? `\\xrightarrow[${botSlot}]{${topSlot}}` : `\\xrightarrow{${topSlot}}`;
    }
    return botSlot ? `\\xrightarrow[${botSlot}]{${topSlot}}` : `\\xrightarrow{${topSlot}}`;
  }

  // 6. Big Operators (15..22): [main, upper?, lower?, opChar]
  if (selector >= TM_INTEG && selector <= TM_SUMOP) {
    const hasLower = (variation & 0x01) !== 0;
    const hasUpper = (variation & 0x02) !== 0;
    const main = lineNodeToLatex(lineItems[0]);
    let upper = '';
    let lower = '';
    if (lineItems.length >= 3) {
      upper = lineNodeToLatex(lineItems[1]);
      lower = lineNodeToLatex(lineItems[2]);
    } else if (lineItems.length === 2) {
      if (hasUpper && !hasLower) upper = lineNodeToLatex(lineItems[1]);
      else lower = lineNodeToLatex(lineItems[1]);
    }

    let op = '\\sum';
    if (charItems.length > 0) {
      const mappedOp = charNodeToBaseLatex(charItems[charItems.length - 1]).latex.trim();
      if (mappedOp) op = mappedOp;
    } else {
      switch (selector) {
        case TM_INTEG:
        case TM_INTOP:
          op = '\\int';
          break;
        case TM_SUM:
        case TM_SUMOP:
          op = '\\sum';
          break;
        case TM_PROD:
          op = '\\prod';
          break;
        case TM_COPROD:
          op = '\\coprod';
          break;
        case TM_UNION:
          op = '\\bigcup';
          break;
        case TM_INTER:
          op = '\\bigcap';
          break;
      }
    }

    const subStr = lower ? `_${wrapBraces(lower)}` : '';
    const supStr = upper ? `^${wrapBraces(upper)}` : '';
    return main ? `${op}${subStr}${supStr} ${main}` : `${op}${subStr}${supStr}`;
  }

  // 7. Limits (23)
  if (selector === TM_LIM) {
    const main = lineNodeToLatex(lineItems[0]);
    const mainPlain = main
      .replace(/^\\(?:text|operatorname)\{(.+)\}$/, '$1')
      .replace(/^\\/, '')
      .trim();
    const lower = lineItems[1] ? lineNodeToLatex(lineItems[1]) : '';
    const upper = lineItems[2] ? lineNodeToLatex(lineItems[2]) : '';
    if (mainPlain === 'lim') {
      return lower ? `\\lim_{${lower}}` : '\\lim';
    }
    if (LATEX_FUNCS.has(mainPlain)) {
      const cmd = `\\${mainPlain}`;
      return lower ? `${cmd}_{${lower}}` : cmd;
    }
    if (upper && lower) return `\\underset{${lower}}{\\overset{${upper}}{${main}}}`;
    if (lower) return `\\underset{${lower}}{${main}}`;
    if (upper) return `\\overset{${upper}}{${main}}`;
    return main;
  }

  // 8. Horizontal brace / bracket (24, 25)
  if (selector === TM_HBRACE || selector === TM_HBRACK) {
    const main = lineNodeToLatex(lineItems[0]);
    const label = lineItems[1] ? lineNodeToLatex(lineItems[1]) : '';
    const isTop = (variation & 0x01) !== 0;
    if (isTop) {
      return label ? `\\overbrace{${main}}^{${label}}` : `\\overbrace{${main}}`;
    }
    return label ? `\\underbrace{${main}}_{${label}}` : `\\underbrace{${main}}`;
  }

  // 9. Long division (26)
  if (selector === TM_LDIV) {
    const dividend = lineNodeToLatex(lineItems[0]);
    const quotient = lineItems[1] ? lineNodeToLatex(lineItems[1]) : '';
    return quotient ? `\\overline{)${dividend}}` : `\\overline{)${dividend}}`;
  }

  // 10. Subscript / Superscript / SubSup (27, 28, 29)
  if (selector === TM_SUB) {
    const sub = lineNodeToLatex(lineItems.find((n) => n.kind !== 'line' || !n.isNull) ?? lineItems[0]);
    return sub ? `_${wrapBraces(sub)}` : '';
  }
  if (selector === TM_SUP) {
    const sup = lineNodeToLatex(
      lineItems.length >= 2 && lineItems[0].kind === 'line' && lineItems[0].isNull
        ? lineItems[1]
        : lineItems.find((n) => n.kind !== 'line' || !n.isNull) ?? lineItems[0]
    );
    return sup ? `^${wrapBraces(sup)}` : '';
  }
  if (selector === TM_SUBSUP) {
    const sub = lineNodeToLatex(lineItems[0]);
    const sup = lineNodeToLatex(lineItems[1]);
    const subPart = sub ? `_${wrapBraces(sub)}` : '';
    const supPart = sup ? `^${wrapBraces(sup)}` : '';
    return `${subPart}${supPart}`;
  }

  // 11. Vector / Tilde / Hat / Arc / Strike / Box (31..36)
  if (selector === TM_VEC) {
    const body = lineNodeToLatex(lineItems[0]);
    if ((variation & 0x03) === 0x03) return `\\overleftrightarrow{${body}}`;
    if (variation & 0x01) return `\\overleftarrow{${body}}`;
    return body.length > 1 && !body.startsWith('\\')
      ? `\\overrightarrow{${body}}`
      : `\\vec{${body}}`;
  }
  if (selector === TM_TILDE) {
    const body = lineNodeToLatex(lineItems[0]);
    return body.length > 1 && !body.startsWith('\\') ? `\\widetilde{${body}}` : `\\tilde{${body}}`;
  }
  if (selector === TM_HAT) {
    const body = lineNodeToLatex(lineItems[0]);
    return body.length > 1 && !body.startsWith('\\') ? `\\widehat{${body}}` : `\\hat{${body}}`;
  }
  if (selector === TM_ARC) {
    const body = lineNodeToLatex(lineItems[0]);
    return `\\overset{\\frown}{${body}}`;
  }
  if (selector === TM_JSTRIKE) {
    const body = lineNodeToLatex(lineItems[0]);
    return `\\cancel{${body}}`;
  }
  if (selector === TM_BOX) {
    const body = lineNodeToLatex(lineItems[0]);
    return `\\boxed{${body}}`;
  }

  return lineItems.map(lineNodeToLatex).join(' ');
}

function matrixRowsLatex(node: Extract<MtefNode, { kind: 'matrix' }>): string {
  const rows: string[] = [];
  for (let r = 0; r < node.rows; r++) {
    const rowCells: string[] = [];
    for (let c = 0; c < node.cols; c++) {
      const idx = r * node.cols + c;
      rowCells.push(idx < node.cells.length ? lineNodeToLatex(node.cells[idx]) : '');
    }
    rows.push(rowCells.join(' & '));
  }
  return rows.join(' \\\\ ');
}

function appendMathToken(out: string, token: string): string {
  if (!token) return out;
  if (/(?:^|[^\\])(?:\\\\)*\\[a-zA-Z]+$/.test(out) && /^[a-zA-Z]/.test(token)) {
    return `${out} ${token}`;
  }
  return `${out}${token}`;
}

function sequenceToLatex(items: MtefNode[]): string {
  let out = '';
  let i = 0;

  while (i < items.length) {
    const cur = items[i];

    // Group consecutive fnTEXT letter/space runs into \text{...}
    if (cur.kind === 'char' && cur.embells.length === 0) {
      const info = charNodeToBaseLatex(cur);

      if (info.isFunctionWordChar) {
        let fnWord = info.latex;
        let j = i + 1;
        while (j < items.length) {
          const nxt = items[j];
          if (nxt.kind !== 'char' || nxt.embells.length > 0) break;
          const nxtInfo = charNodeToBaseLatex(nxt);
          if (!nxtInfo.isFunctionWordChar) break;
          fnWord += nxtInfo.latex;
          j++;
        }
        if (LATEX_FUNCS.has(fnWord)) {
          out = appendMathToken(out, `\\${fnWord} `);
        } else {
          out = appendMathToken(out, `\\operatorname{${fnWord}}`);
        }
        i = j;
        continue;
      }

      if (info.isTextLetter) {
        let textRun = info.latex;
        let j = i + 1;
        while (j < items.length) {
          const nxt = items[j];
          if (nxt.kind !== 'char' || nxt.embells.length > 0) break;
          const nxtInfo = charNodeToBaseLatex(nxt);
          if (nxtInfo.isTextLetter) {
            textRun += nxtInfo.latex;
            j++;
          } else if (
            nxt.typeface === FN_TEXT &&
            /^[0-9 ,.\-:;?!()]$/.test(nxtInfo.latex)
          ) {
            textRun += nxtInfo.latex;
            j++;
          } else {
            break;
          }
        }
        if (textRun.trim().length > 0) {
          out = appendMathToken(out, `\\text{${textRun}}`);
        } else {
          out += textRun;
        }
        i = j;
        continue;
      }

      const decorated = info.latex;
      if (cur.colorHex && cur.colorHex !== '#000000' && decorated.trim()) {
        out = appendMathToken(out, `\\textcolor{${cur.colorHex}}{${decorated.trim()}}`);
      } else {
        out = appendMathToken(out, decorated);
      }
      i++;
      continue;
    }

    if (cur.kind === 'char') {
      const info = charNodeToBaseLatex(cur);
      const decorated = applyEmbellishments(info.latex, cur.embells);
      if (cur.colorHex && cur.colorHex !== '#000000' && decorated.trim()) {
        out = appendMathToken(out, `\\textcolor{${cur.colorHex}}{${decorated.trim()}}`);
      } else {
        out = appendMathToken(out, decorated);
      }
      i++;
      continue;
    }

    if (cur.kind === 'tmpl') {
      const isScript =
        cur.selector === TM_SUB ||
        cur.selector === TM_SUP ||
        cur.selector === TM_SUBSUP;
      // Handle prescripts (tvSU_PRECEDES = 0x01 on TM_SUB/TM_SUP/TM_SUBSUP) or orphan scripts
      if (isScript && ((cur.variation & 0x01) !== 0 || out.trim() === '' || /[=+\-(,\[{]$/.test(out.trim()))) {
        out = appendMathToken(out, `{}${tmplNodeToLatex(cur)}`);
      } else {
        out = appendMathToken(out, nodeToLatex(cur));
      }
      i++;
      continue;
    }

    out = appendMathToken(out, nodeToLatex(cur));
    i++;
  }

  return out;
}

function nodeToLatex(node: MtefNode): string {
  switch (node.kind) {
    case 'line':
      return node.isNull ? '' : sequenceToLatex(node.items);
    case 'char': {
      const info = charNodeToBaseLatex(node);
      return applyEmbellishments(info.latex, node.embells);
    }
    case 'tmpl':
      return tmplNodeToLatex(node);
    case 'pile': {
      const rows = node.lines.map(lineNodeToLatex).filter(Boolean);
      if (rows.length <= 1) return rows[0] ?? '';
      return `\\begin{aligned} ${rows.join(' \\\\ ')} \\end{aligned}`;
    }
    case 'matrix':
      return `\\begin{matrix} ${matrixRowsLatex(node)} \\end{matrix}`;
  }
}

function cleanLatexOutput(raw: string): string {
  return raw
    .replace(/[\u0000-\u001F\u007F\uE000-\uF8FF\uFFFD]/g, '')
    .replace(/\\text\{\s+\}/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/(\\[a-zA-Z]+)\s+([_^])/g, '$1$2')
    .replace(/\s+([_^])/g, '$1')
    .replace(/([_^])\s+/g, '$1')
    .trim();
}

export function mtefToLatex(mtefBytes: Uint8Array): string | null {
  if (!mtefBytes || mtefBytes.length < 6) return null;
  const r = new BinaryReader(mtefBytes);
  const ver = r.readByte();
  if (ver < 1 || ver > 5) return null;

  r.readByte(); // platform
  r.readByte(); // product
  r.readByte(); // version
  r.readByte(); // versionSub

  if (ver === 5) {
    r.readCString(); // appKey (e.g. "DSMT4")
    r.readByte(); // eqOptions
  }

  const state: ParserState = {
    ver,
    fonts: [''], // 1-based index
    colors: [''], // 1-based index
  };

  const nodes =
    ver === 5 ? readRecordListV5(r, state) : readRecordListV3(r, state);
  const raw = sequenceToLatex(nodes);
  const cleaned = cleanLatexOutput(raw);
  return cleaned || null;
}
