/**
 * 最小限の XLSX（Office Open XML）ライター。
 * 外部依存なし。日本語 sharedStrings・数式・非表示シート対応。
 * ZIP は store（無圧縮）。マクロ不要の .xlsx 向け。
 */

const textEncoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}

function u32(value) {
  return Uint8Array.of(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff
  );
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colName(index) {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function cellRef(rowIndex, colIndex) {
  return `${colName(colIndex)}${rowIndex + 1}`;
}

function zipStore(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = textEncoder.encode(file.path);
    const data = file.data;
    const crc = crc32(data);
    const localHeader = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    ]);
    localParts.push(localHeader, data);
    centralParts.push(
      concatBytes([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ])
    );
    offset += localHeader.length + data.length;
  }

  const central = concatBytes(centralParts);
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
  return concatBytes([...localParts, central, end]);
}

/**
 * @param {unknown} raw
 */
export function normalizeCell(raw) {
  if (raw === null || raw === undefined || raw === "") {
    return { kind: "empty" };
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const style = Number.isFinite(raw.style) ? Number(raw.style) : undefined;
    if (typeof raw.formula === "string" && raw.formula.trim()) {
      return {
        kind: "formula",
        formula: raw.formula.trim().replace(/^=/, ""),
        value: raw.value ?? raw.v ?? null,
        style,
      };
    }
    if (typeof raw.f === "string" && raw.f.trim()) {
      return {
        kind: "formula",
        formula: raw.f.trim().replace(/^=/, ""),
        value: raw.v ?? raw.value ?? null,
        style,
      };
    }
    if (typeof raw.v === "number" && Number.isFinite(raw.v)) {
      return { kind: "number", value: raw.v, style };
    }
    if (raw.v !== null && raw.v !== undefined && raw.v !== "") {
      return { kind: "string", value: String(raw.v), style };
    }
    return { kind: "empty" };
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return { kind: "number", value: raw };
  }
  return { kind: "string", value: String(raw) };
}

/**
 * @param {{ sheets: Array<object> }} workbook
 * @returns {Uint8Array}
 */
export function buildXlsxArrayBuffer(workbook) {
  const sheets = Array.isArray(workbook?.sheets) ? workbook.sheets : [];
  if (sheets.length === 0) {
    throw new Error("xlsx/empty-workbook");
  }

  const shared = [];
  const sharedIndex = new Map();

  function share(text) {
    const key = String(text);
    if (sharedIndex.has(key)) {
      return sharedIndex.get(key);
    }
    const index = shared.length;
    shared.push(key);
    sharedIndex.set(key, index);
    return index;
  }

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Yu Gothic"/></font>
    <font><b/><sz val="11"/><name val="Yu Gothic"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFCE4D6"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
    <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"/>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`;

  const sheetFiles = sheets.map((sheet, sheetIndex) => {
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
    const highlight = new Set(sheet.highlightRowIndexes || []);
    const inputKeys = new Set(
      (sheet.inputCells || []).map((cell) => `${cell.row}:${cell.col}`)
    );
    const maxCols = rows.reduce((max, row) => Math.max(max, row?.length || 0), 0);

    const rowXml = rows
      .map((row, rowIndex) => {
        const cells = [];
        const isHeader = rowIndex === 0;
        const isHighlight = highlight.has(rowIndex);
        for (let colIndex = 0; colIndex < (row?.length || 0); colIndex += 1) {
          const cell = normalizeCell(row[colIndex]);
          if (cell.kind === "empty") {
            continue;
          }
          const ref = cellRef(rowIndex, colIndex);
          let style = cell.style;
          if (style === undefined) {
            if (isHeader) style = 1;
            else if (inputKeys.has(`${rowIndex}:${colIndex}`)) style = 3;
            else if (isHighlight) style = 2;
            else style = 0;
          }
          if (cell.kind === "formula") {
            if (typeof cell.value === "number" && Number.isFinite(cell.value)) {
              cells.push(
                `<c r="${ref}" s="${style}"><f>${xmlEscape(cell.formula)}</f><v>${cell.value}</v></c>`
              );
            } else if (cell.value !== null && cell.value !== undefined && cell.value !== "") {
              cells.push(
                `<c r="${ref}" s="${style}" t="str"><f>${xmlEscape(cell.formula)}</f><v>${xmlEscape(
                  String(cell.value)
                )}</v></c>`
              );
            } else {
              cells.push(`<c r="${ref}" s="${style}"><f>${xmlEscape(cell.formula)}</f></c>`);
            }
          } else if (cell.kind === "number") {
            cells.push(`<c r="${ref}" s="${style}"><v>${cell.value}</v></c>`);
          } else {
            cells.push(`<c r="${ref}" s="${style}" t="s"><v>${share(cell.value)}</v></c>`);
          }
        }
        return `<row r="${rowIndex + 1}">${cells.join("")}</row>`;
      })
      .join("");

    const colsXml =
      maxCols > 0
        ? `<cols>${Array.from({ length: maxCols }, (_, i) => {
            const width = sheet.columns?.[i]?.width ?? 14;
            return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`;
          }).join("")}</cols>`
        : "";

    const freezeRows = sheet.freeze?.rows ?? 0;
    const freezeCols = sheet.freeze?.cols ?? 0;
    let freezeXml = "";
    if (freezeRows > 0 || freezeCols > 0) {
      const topLeft = cellRef(freezeRows, freezeCols);
      freezeXml = `<sheetViews><sheetView workbookViewId="0"><pane xSplit="${freezeCols}" ySplit="${freezeRows}" topLeftCell="${topLeft}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>`;
    }

    let autoFilterXml = "";
    if (sheet.autoFilter && rows.length > 0 && maxCols > 0) {
      const end = cellRef(Math.max(rows.length - 1, 0), maxCols - 1);
      autoFilterXml = `<autoFilter ref="A1:${end}"/>`;
    }

    const dimension =
      rows.length && maxCols
        ? `<dimension ref="A1:${cellRef(rows.length - 1, maxCols - 1)}"/>`
        : `<dimension ref="A1"/>`;

    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  ${dimension}
  ${freezeXml}
  ${colsXml}
  <sheetData>${rowXml}</sheetData>
  ${autoFilterXml}
  <pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
</worksheet>`;

    return {
      name: sheet.name || `Sheet${sheetIndex + 1}`,
      path: `xl/worksheets/sheet${sheetIndex + 1}.xml`,
      hidden: sheet.hidden === true,
      xml,
    };
  });

  const sharedXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">
${shared.map((text) => `<si><t>${xmlEscape(text)}</t></si>`).join("")}
</sst>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheetFiles
      .map((sheet, index) => {
        const hiddenAttr = sheet.hidden ? ` state="hidden"` : "";
        return `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}"${hiddenAttr} r:id="rId${index + 1}"/>`;
      })
      .join("")}
  </sheets>
  <calcPr calcId="0" fullCalcOnLoad="1"/>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetFiles
    .map(
      (_sheet, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
    )
    .join("")}
  <Relationship Id="rId${sheetFiles.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
  <Relationship Id="rId${sheetFiles.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetFiles
    .map(
      (_sheet, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join("")}
</Types>`;

  const files = [
    { path: "[Content_Types].xml", data: textEncoder.encode(contentTypes) },
    { path: "_rels/.rels", data: textEncoder.encode(rootRels) },
    { path: "xl/workbook.xml", data: textEncoder.encode(workbookXml) },
    { path: "xl/_rels/workbook.xml.rels", data: textEncoder.encode(workbookRels) },
    { path: "xl/sharedStrings.xml", data: textEncoder.encode(sharedXml) },
    { path: "xl/styles.xml", data: textEncoder.encode(stylesXml) },
    ...sheetFiles.map((sheet) => ({ path: sheet.path, data: textEncoder.encode(sheet.xml) })),
  ];

  return zipStore(files);
}

export { cellRef, colName };
