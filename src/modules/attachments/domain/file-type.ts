import { inflateRawSync } from "node:zlib";

// Real content detection for request attachments (SPEC 21.7). The browser-supplied
// extension and MIME type never decide the format.

export type DetectedDocumentFormat = "PDF" | "DOCX" | "TXT";

export const DOCX_MAX_ZIP_ENTRIES = 1_000;
export const DOCX_MAX_CONTENT_TYPES_BYTES = 64 * 1024;

const DOCX_MAIN_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_LOCAL_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIZE = 22;
const ZIP_MAX_COMMENT_SIZE = 0xffff;

interface ZipEntry {
  name: string;
  flags: number;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function findEndOfCentralDirectory(bytes: Uint8Array): number | null {
  const lowestOffset = Math.max(
    0,
    bytes.length - ZIP_END_OF_CENTRAL_DIRECTORY_SIZE - ZIP_MAX_COMMENT_SIZE,
  );

  for (
    let offset = bytes.length - ZIP_END_OF_CENTRAL_DIRECTORY_SIZE;
    offset >= lowestOffset;
    offset -= 1
  ) {
    if (readUint32(bytes, offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }

  return null;
}

// Reads only the central directory. Returns null for anything malformed, encrypted,
// multi-disk, ZIP64 or above the entry limit.
function readZipEntries(bytes: Uint8Array): ZipEntry[] | null {
  if (bytes.length < ZIP_END_OF_CENTRAL_DIRECTORY_SIZE) {
    return null;
  }

  const endOffset = findEndOfCentralDirectory(bytes);

  if (endOffset === null) {
    return null;
  }

  const diskNumber = readUint16(bytes, endOffset + 4);
  const centralDirectoryDisk = readUint16(bytes, endOffset + 6);
  const entriesOnDisk = readUint16(bytes, endOffset + 8);
  const totalEntries = readUint16(bytes, endOffset + 10);
  const centralDirectorySize = readUint32(bytes, endOffset + 12);
  const centralDirectoryOffset = readUint32(bytes, endOffset + 16);

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== totalEntries ||
    totalEntries === 0 ||
    totalEntries > DOCX_MAX_ZIP_ENTRIES ||
    centralDirectoryOffset + centralDirectorySize > endOffset
  ) {
    return null;
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (
      offset + 46 > endOffset ||
      readUint32(bytes, offset) !== ZIP_CENTRAL_HEADER_SIGNATURE
    ) {
      return null;
    }

    const nameLength = readUint16(bytes, offset + 28);
    const extraLength = readUint16(bytes, offset + 30);
    const commentLength = readUint16(bytes, offset + 32);
    const nameEnd = offset + 46 + nameLength;

    if (nameEnd > endOffset) {
      return null;
    }

    let name: string;

    try {
      name = decoder.decode(bytes.subarray(offset + 46, nameEnd));
    } catch {
      return null;
    }

    entries.push({
      name,
      flags: readUint16(bytes, offset + 8),
      compressionMethod: readUint16(bytes, offset + 10),
      compressedSize: readUint32(bytes, offset + 20),
      uncompressedSize: readUint32(bytes, offset + 24),
      localHeaderOffset: readUint32(bytes, offset + 42),
    });

    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

// Extracts one small entry with a hard cap on the decompressed size.
function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array | null {
  const isEncrypted = (entry.flags & 0x1) !== 0;

  if (isEncrypted || entry.uncompressedSize > DOCX_MAX_CONTENT_TYPES_BYTES) {
    return null;
  }

  const headerOffset = entry.localHeaderOffset;

  if (
    headerOffset + 30 > bytes.length ||
    readUint32(bytes, headerOffset) !== ZIP_LOCAL_HEADER_SIGNATURE
  ) {
    return null;
  }

  const dataOffset =
    headerOffset + 30 + readUint16(bytes, headerOffset + 26) + readUint16(bytes, headerOffset + 28);
  const dataEnd = dataOffset + entry.compressedSize;

  if (dataEnd > bytes.length) {
    return null;
  }

  const data = bytes.subarray(dataOffset, dataEnd);

  if (entry.compressionMethod === 0) {
    return data.length === entry.uncompressedSize ? data : null;
  }

  if (entry.compressionMethod !== 8) {
    return null;
  }

  try {
    const inflated = inflateRawSync(data, { maxOutputLength: DOCX_MAX_CONTENT_TYPES_BYTES });
    return inflated.length === entry.uncompressedSize ? new Uint8Array(inflated) : null;
  } catch {
    return null;
  }
}

function readXmlAttribute(tag: string, attribute: string): string | null {
  const match = tag.match(new RegExp(`\\s${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`));
  return match ? (match[1] ?? match[2]) : null;
}

function isMacroFreeWordDocument(bytes: Uint8Array): boolean {
  const entries = readZipEntries(bytes);

  if (!entries) {
    return false;
  }

  const names = new Set(entries.map((entry) => entry.name));
  const hasMacroProject = entries.some((entry) =>
    entry.name.toLowerCase().endsWith("vbaproject.bin"),
  );

  if (!names.has("[Content_Types].xml") || !names.has("word/document.xml") || hasMacroProject) {
    return false;
  }

  const contentTypesEntry = entries.find((entry) => entry.name === "[Content_Types].xml");
  const contentTypesBytes = contentTypesEntry ? readZipEntry(bytes, contentTypesEntry) : null;

  if (!contentTypesBytes) {
    return false;
  }

  let contentTypes: string;

  try {
    contentTypes = new TextDecoder("utf-8", { fatal: true }).decode(contentTypesBytes);
  } catch {
    return false;
  }

  if (/macroEnabled/i.test(contentTypes)) {
    return false;
  }

  const overrides = contentTypes.match(/<Override\b[^>]*>/g) ?? [];

  return overrides.some(
    (tag) =>
      readXmlAttribute(tag, "PartName") === "/word/document.xml" &&
      readXmlAttribute(tag, "ContentType") === DOCX_MAIN_CONTENT_TYPE,
  );
}

function isPlainUtf8Text(bytes: Uint8Array): boolean {
  let text: string;

  try {
    // The decoder strips an optional UTF-8 BOM and rejects invalid sequences.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }

  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    const isAllowedWhitespace = codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d;
    const isControl =
      codePoint < 0x20 || codePoint === 0x7f || (codePoint >= 0x80 && codePoint <= 0x9f);

    if (isControl && !isAllowedWhitespace) {
      return false;
    }
  }

  return true;
}

export function detectDocumentFormat(bytes: Uint8Array): DetectedDocumentFormat | null {
  if (bytes.length === 0) {
    return null;
  }

  if (startsWith(bytes, PDF_SIGNATURE)) {
    return "PDF";
  }

  if (bytes.length >= 4 && readUint32(bytes, 0) === ZIP_LOCAL_HEADER_SIGNATURE) {
    // A ZIP that is not a macro-free Word document is never reinterpreted as text.
    return isMacroFreeWordDocument(bytes) ? "DOCX" : null;
  }

  return isPlainUtf8Text(bytes) ? "TXT" : null;
}
