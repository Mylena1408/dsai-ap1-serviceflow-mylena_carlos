import { crc32, deflateRawSync } from "node:zlib";

// Synthetic document fixtures generated in memory (SPEC 21.10, CA-DOC-22).
// No real documents or personal data.

export interface ZipFixtureEntry {
  name: string;
  content: string | Uint8Array;
  store?: boolean;
}

export function buildZip(entries: ZipFixtureEntry[]): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.from(entry.content);
    const data = entry.store ? raw : deflateRawSync(raw);
    const method = entry.store ? 0 : 8;
    const checksum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return new Uint8Array(Buffer.concat([...localParts, centralDirectory, end]));
}

const WORD_MAIN = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const WORD_MACRO_MAIN = "application/vnd.ms-word.document.macroEnabled.main+xml";

function contentTypesXml(mainContentType: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="xml" ContentType="application/xml"/>',
    `<Override ContentType="${mainContentType}" PartName="/word/document.xml"/>`,
    "</Types>",
  ].join("");
}

const DOCUMENT_XML =
  '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Documento sintetico</w:t></w:r></w:p></w:body></w:document>';

export function minimalPdf(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
}

export function minimalDocx(): Uint8Array {
  return buildZip([
    { name: "[Content_Types].xml", content: contentTypesXml(WORD_MAIN) },
    { name: "word/document.xml", content: DOCUMENT_XML },
  ]);
}

export function macroEnabledDocx(): Uint8Array {
  return buildZip([
    { name: "[Content_Types].xml", content: contentTypesXml(WORD_MACRO_MAIN) },
    { name: "word/document.xml", content: DOCUMENT_XML },
    { name: "word/vbaProject.bin", content: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]) },
  ]);
}

export function plainZip(): Uint8Array {
  return buildZip([{ name: "notas.txt", content: "arquivo comum" }]);
}

export function syntheticText(): Uint8Array {
  return new TextEncoder().encode("Requerimento ficticio de ferias.\r\nLinha 2\tcom tabulacao.\n");
}

export function windowsExecutable(): Uint8Array {
  return new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
}
