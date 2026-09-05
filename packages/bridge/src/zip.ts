import { inflateRawSync } from "node:zlib";

/**
 * A ZIP reader that refuses more than it accepts.
 *
 * An `.xlsx` is a ZIP of XML, and the file arrives from whoever authored the
 * configuration — which R24 says to treat as untrusted data, with file
 * expansion bounded. That requirement is why this is hand-written against
 * `node:zlib` rather than delegating to a general-purpose ZIP library: a
 * library's job is to succeed at reading whatever it is given, and this
 * reader's job is the opposite. The caps below are the point of the module,
 * not an afterthought bolted to one.
 *
 * Three separate things can go wrong with a hostile archive, so there are
 * three separate limits:
 *
 *   - one entry that inflates to gigabytes (`maxEntryBytes`),
 *   - many entries that are individually small (`maxTotalBytes`, `maxEntries`),
 *   - a small entry with an absurd compression ratio, which is the classic
 *     zip bomb and is caught before the output is allocated, by trusting the
 *     declared size only far enough to reject it.
 *
 * What is deliberately absent: ZIP64, encryption, multi-disk archives, and
 * every compression method except store and deflate. Each is refused by name.
 */

/** Signatures, little-endian, as they appear in the container. */
const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
const ZIP64_END_LOCATOR = 0x07064b50;

/** The two methods a spreadsheet actually uses. */
const STORED = 0;
const DEFLATED = 8;

export interface ZipLimits {
  /** Largest inflated size for any one entry. */
  maxEntryBytes: number;
  /** Largest inflated size for everything read from the archive together. */
  maxTotalBytes: number;
  /** Most entries the central directory may declare. */
  maxEntries: number;
  /**
   * Largest inflated:compressed ratio tolerated for one entry.
   *
   * XML compresses well, so this is generous — but a zip bomb is not 200x, it
   * is 1000x and upward, and the gap is wide enough to sit a limit in.
   */
  maxRatio: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntryBytes: 32 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxEntries: 512,
  maxRatio: 200,
};

/** Raised for anything the reader will not accept. Always says which file. */
export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/** Reads the end-of-central-directory record, scanning back over any comment. */
function findEndOfCentralDirectory(buf: Buffer): number {
  // The record is 22 bytes plus a comment of up to 0xffff. Scanning backwards
  // finds the real one first even when the comment contains the signature.
  const earliest = Math.max(0, buf.length - (22 + 0xffff));
  for (let i = buf.length - 22; i >= earliest; i--) {
    if (buf.readUInt32LE(i) === END_OF_CENTRAL) return i;
  }
  throw new ZipError("not a zip archive: no end-of-central-directory record");
}

function readCentralDirectory(buf: Buffer, limits: ZipLimits): Map<string, Entry> {
  const eocd = findEndOfCentralDirectory(buf);

  // ZIP64 is refused rather than mis-read: the 32-bit fields below saturate at
  // 0xffff/0xffffffff, and a reader that ignores that silently produces
  // nonsense offsets instead of an error.
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === ZIP64_END_LOCATOR) {
    throw new ZipError("zip64 archives are not supported");
  }

  const count = buf.readUInt16LE(eocd + 10);
  const size = buf.readUInt32LE(eocd + 12);
  const offset = buf.readUInt32LE(eocd + 16);

  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    throw new ZipError("zip64 archives are not supported");
  }
  if (count > limits.maxEntries) {
    throw new ZipError(`archive declares ${count} entries, over the limit of ${limits.maxEntries}`);
  }
  if (offset + size > buf.length) {
    throw new ZipError("central directory runs past the end of the archive");
  }

  const entries = new Map<string, Entry>();
  let p = offset;

  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL_HEADER) {
      throw new ZipError(`central directory entry ${i} is malformed`);
    }

    const flags = buf.readUInt16LE(p + 8);
    // Bit 0 is the encryption flag. An encrypted entry cannot be read, and
    // returning its ciphertext as if it were XML would be worse than failing.
    if (flags & 0x1) throw new ZipError("encrypted archives are not supported");

    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);

    const name = buf.subarray(p + 46, p + 46 + nameLength).toString("utf8");
    entries.set(name, { name, method, compressedSize, uncompressedSize, localHeaderOffset });

    p += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/**
 * An opened archive. Entries are inflated on demand and counted against one
 * shared budget, so reading many small parts cannot add up past the total.
 */
export class ZipArchive {
  private readonly buf: Buffer;
  private readonly entries: Map<string, Entry>;
  private readonly limits: ZipLimits;
  private spent = 0;

  private constructor(buf: Buffer, entries: Map<string, Entry>, limits: ZipLimits) {
    this.buf = buf;
    this.entries = entries;
    this.limits = limits;
  }

  static open(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipArchive {
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (buf.length < 22) throw new ZipError("not a zip archive: too short");
    return new ZipArchive(buf, readCentralDirectory(buf, limits), limits);
  }

  /** Entry names, in central-directory order. */
  names(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** Inflates one entry, or throws saying which entry and which limit. */
  read(name: string): Buffer {
    const entry = this.entries.get(name);
    if (!entry) throw new ZipError(`archive has no entry "${name}"`);

    if (entry.method !== STORED && entry.method !== DEFLATED) {
      throw new ZipError(`entry "${name}" uses unsupported compression method ${entry.method}`);
    }

    // Checked against the *declared* size before inflating, so a bomb is
    // refused without ever allocating its output.
    if (entry.uncompressedSize > this.limits.maxEntryBytes) {
      throw new ZipError(
        `entry "${name}" declares ${entry.uncompressedSize} bytes, over the per-entry limit of ${this.limits.maxEntryBytes}`,
      );
    }
    if (
      entry.compressedSize > 0 &&
      entry.uncompressedSize / entry.compressedSize > this.limits.maxRatio
    ) {
      throw new ZipError(
        `entry "${name}" expands ${Math.round(entry.uncompressedSize / entry.compressedSize)}x, over the limit of ${this.limits.maxRatio}x`,
      );
    }
    if (this.spent + entry.uncompressedSize > this.limits.maxTotalBytes) {
      throw new ZipError(
        `reading "${name}" would pass the archive-wide limit of ${this.limits.maxTotalBytes} bytes`,
      );
    }

    const start = this.dataStart(entry);
    const raw = this.buf.subarray(start, start + entry.compressedSize);

    let out: Buffer;
    if (entry.method === STORED) {
      out = Buffer.from(raw);
    } else {
      // maxOutputLength makes zlib itself stop rather than trusting the
      // declared size, which an archive is free to lie about.
      out = inflateRawSync(raw, { maxOutputLength: this.limits.maxEntryBytes });
    }

    // The declared size is a claim; this is the measurement.
    if (out.length > this.limits.maxEntryBytes) {
      throw new ZipError(`entry "${name}" inflated past the per-entry limit`);
    }
    this.spent += out.length;
    return out;
  }

  /** Inflates an entry and decodes it as UTF-8. */
  readText(name: string): string {
    return this.read(name).toString("utf8");
  }

  /**
   * Where an entry's bytes begin. The local header repeats the name and extra
   * fields at their own lengths, which need not match the central directory's,
   * so they are read from the local header rather than assumed.
   */
  private dataStart(entry: Entry): number {
    const p = entry.localHeaderOffset;
    if (p + 30 > this.buf.length || this.buf.readUInt32LE(p) !== LOCAL_HEADER) {
      throw new ZipError(`entry "${entry.name}" has a malformed local header`);
    }
    const nameLength = this.buf.readUInt16LE(p + 26);
    const extraLength = this.buf.readUInt16LE(p + 28);
    const start = p + 30 + nameLength + extraLength;
    if (start + entry.compressedSize > this.buf.length) {
      throw new ZipError(`entry "${entry.name}" runs past the end of the archive`);
    }
    return start;
  }
}
