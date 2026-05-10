import type {
  CategorySpec,
  ExtractedRecord,
  SourceSnapshot,
} from "../types";

type ParsedCell = {
  text: string;
  html: string;
  links: { href: string; text: string; isBold: boolean }[];
  isHeader: boolean;
  colSpan: number;
  rowSpan: number;
};

type ParsedTable = {
  index: number;
  id: string;
  className: string;
  heading: string | null;
  headers: string[];
  rows: ParsedCell[][];
};

type ParsedList = {
  index: number;
  id: string;
  className: string;
  heading: string | null;
  items: ParsedCell[];
};

export type SourceTableCandidate = {
  blockType: "table" | "list";
  blockId: string;
  tableIndex: number;
  heading: string | null;
  headers: string[];
  rowCount: number;
  score: number;
  answerColumnName: string;
  sampleRecords: string[];
  includedByDefault: boolean;
};

export type ExtractionOptions = {
  includeBlockIds?: string[];
  excludeBlockIds?: string[];
};

const ANSWER_COLUMN_CANDIDATES = [
  "name",
  "designee",
  "nominee",
  "incumbent",
  "officeholder",
  "office holder",
  "holder",
  "contestant",
  "player",
  "person",
  "president",
  "title",
  "song",
  "movie",
  "team",
  "country",
  "pokemon",
  "species",
];

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "-")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function normalizeMatchText(value: string) {
  return decodeHtmlEntities(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—―]/g, "-")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function stripTags(html: string) {
  return html.replace(/<[^>]*>/g, " ");
}

function cleanCellHtml(html: string) {
  return html
    .replace(/<sup\b[\s\S]*?<\/sup>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ");
}

export function cleanExtractedValue(value: string) {
  return decodeHtmlEntities(value)
    .replace(/\[[^\]]{1,8}\]/g, " ")
    .replace(/[†‡*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textFromHtml(html: string) {
  return cleanExtractedValue(stripTags(cleanCellHtml(html)));
}

function parseAttributes(tag: string) {
  const attrs = new Map<string, string>();
  for (const match of tag.matchAll(
    /\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
  )) {
    attrs.set(match[1]!.toLowerCase(), decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return attrs;
}

function parsePositiveInteger(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 50);
}

function parseLinks(html: string) {
  const links: { href: string; text: string; isBold: boolean }[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = parseAttributes(match[1] ?? "");
    const href = attrs.get("href")?.trim();
    const text = textFromHtml(match[2] ?? "");
    if (!href || !text) continue;
    const index = match.index ?? 0;
    const before = html.slice(Math.max(0, index - 24), index).toLowerCase();
    const after = html.slice(index + (match[0]?.length ?? 0), index + (match[0]?.length ?? 0) + 24).toLowerCase();
    links.push({
      href,
      text,
      isBold: /<b\b[^>]*>\s*$/.test(before) && /^\s*<\/b>/.test(after),
    });
  }
  return links;
}

function parseRows(tableHtml: string) {
  const rows: ParsedCell[][] = [];
  const ownTableHtml = stripNestedTables(tableHtml);
  for (const rowMatch of ownTableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1] ?? "";
    const cells: ParsedCell[] = [];
    for (const cellMatch of rowHtml.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      const attrs = parseAttributes(cellMatch[2] ?? "");
      const html = cellMatch[3] ?? "";
      cells.push({
        html,
        text: textFromHtml(html),
        links: parseLinks(html),
        isHeader: cellMatch[1]?.toLowerCase() === "th",
        colSpan: parsePositiveInteger(attrs.get("colspan")),
        rowSpan: parsePositiveInteger(attrs.get("rowspan")),
      });
    }
    if (cells.length > 0) rows.push(cells);
  }
  return expandSpannedCells(rows);
}

function headingBefore(html: string, tableStart: number) {
  const before = html.slice(0, tableStart);
  let heading: string | null = null;
  for (const match of before.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi)) {
    const text = textFromHtml(match[1] ?? "");
    if (text) heading = text;
  }
  return heading;
}

function stripNestedTables(tableHtml: string) {
  const tagRegex = /<\/?table\b[^>]*>/gi;
  let depth = 0;
  let lastKeptIndex = 0;
  let stripped = "";

  for (const match of tableHtml.matchAll(tagRegex)) {
    const tag = match[0] ?? "";
    const index = match.index ?? 0;
    const isClosing = /^<\//.test(tag);

    if (!isClosing) {
      depth++;
      if (depth === 2) {
        stripped += tableHtml.slice(lastKeptIndex, index);
      }
      continue;
    }

    if (depth === 2) {
      lastKeptIndex = index + tag.length;
    }
    depth = Math.max(0, depth - 1);
  }

  return stripped + tableHtml.slice(lastKeptIndex);
}

function stripNestedLists(listHtml: string) {
  const tagRegex = /<\/?(?:ul|ol)\b[^>]*>/gi;
  let depth = 0;
  let lastKeptIndex = 0;
  let stripped = "";

  for (const match of listHtml.matchAll(tagRegex)) {
    const tag = match[0] ?? "";
    const index = match.index ?? 0;
    const isClosing = /^<\//.test(tag);

    if (!isClosing) {
      depth++;
      if (depth === 2) {
        stripped += listHtml.slice(lastKeptIndex, index);
      }
      continue;
    }

    if (depth === 2) {
      lastKeptIndex = index + tag.length;
    }
    depth = Math.max(0, depth - 1);
  }

  return stripped + listHtml.slice(lastKeptIndex);
}

function expandSpannedCells(rows: ParsedCell[][]) {
  const expandedRows: ParsedCell[][] = [];
  let rowSpans = new Map<number, { cell: ParsedCell; rowsLeft: number }>();

  for (const row of rows) {
    const expanded: ParsedCell[] = [];
    const nextRowSpans = new Map<number, { cell: ParsedCell; rowsLeft: number }>();

    for (const [columnIndex, span] of rowSpans) {
      expanded[columnIndex] = span.cell;
      if (span.rowsLeft > 1) {
        nextRowSpans.set(columnIndex, {
          cell: span.cell,
          rowsLeft: span.rowsLeft - 1,
        });
      }
    }

    let columnIndex = 0;
    for (const cell of row) {
      while (expanded[columnIndex]) columnIndex++;
      for (let offset = 0; offset < cell.colSpan; offset++) {
        expanded[columnIndex + offset] = cell;
        if (cell.rowSpan > 1) {
          nextRowSpans.set(columnIndex + offset, {
            cell,
            rowsLeft: cell.rowSpan - 1,
          });
        }
      }
      columnIndex += cell.colSpan;
    }

    rowSpans = nextRowSpans;
    expandedRows.push(expanded);
  }

  return expandedRows;
}

function tableBlocks(html: string) {
  const blocks: { attrs: string; html: string; start: number }[] = [];
  const stack: { attrs: string; start: number }[] = [];

  for (const match of html.matchAll(/<\/?table\b[^>]*>/gi)) {
    const tag = match[0] ?? "";
    const index = match.index ?? 0;
    if (/^<\//.test(tag)) {
      const open = stack.pop();
      if (!open) continue;
      blocks.push({
        attrs: open.attrs,
        html: html.slice(open.start, index + tag.length),
        start: open.start,
      });
      continue;
    }

    stack.push({
      attrs: tag.replace(/^<table\b/i, "").replace(/>$/, ""),
      start: index,
    });
  }

  return blocks.sort((a, b) => a.start - b.start);
}

function listBlocks(html: string) {
  const blocks: { attrs: string; html: string; start: number }[] = [];
  const stack: { attrs: string; start: number }[] = [];

  for (const match of html.matchAll(/<\/?(?:ul|ol)\b[^>]*>/gi)) {
    const tag = match[0] ?? "";
    const index = match.index ?? 0;
    if (/^<\//.test(tag)) {
      const open = stack.pop();
      if (!open) continue;
      blocks.push({
        attrs: open.attrs,
        html: html.slice(open.start, index + tag.length),
        start: open.start,
      });
      continue;
    }

    stack.push({
      attrs: tag.replace(/^<(?:ul|ol)\b/i, "").replace(/>$/, ""),
      start: index,
    });
  }

  return blocks.sort((a, b) => a.start - b.start);
}

function headerRowIndex(rows: ParsedCell[][]) {
  for (const [index, row] of rows.slice(0, 8).entries()) {
    const uniqueCells = new Set(row);
    const headerCells = row.filter((cell) => cell.isHeader);
    const headerText = row.map((cell) => normalizeMatchText(cell.text)).join(" ");
    if (
      uniqueCells.size >= 2 &&
      headerCells.length >= 2 &&
      !/^(table )?contents?$/.test(headerText)
    ) {
      return index;
    }
  }

  const first = rows[0] ?? [];
  const firstLooksLikeHeader =
    first.length > 0 &&
    new Set(first).size >= 2 &&
    first.every((cell) => cell.isHeader || cell.text.length < 80);
  return firstLooksLikeHeader ? 0 : -1;
}

function parseTables(html: string) {
  const tables: ParsedTable[] = [];
  let index = 0;
  for (const block of tableBlocks(html)) {
    const attrs = parseAttributes(block.attrs);
    const tableHtml = block.html;
    const rows = parseRows(tableHtml);
    if (rows.length === 0) continue;

    const headerIndex = headerRowIndex(rows);
    const headers =
      headerIndex >= 0
        ? rows[headerIndex]!.map((cell, i) => cell.text || `Column ${i + 1}`)
        : Array.from({ length: Math.max(...rows.map((r) => r.length)) }, (_, i) => `Column ${i + 1}`);
    const bodyRows = headerIndex >= 0 ? rows.slice(headerIndex + 1) : rows;

    tables.push({
      index,
      id: attrs.get("id") ?? `table-${index}`,
      className: attrs.get("class") ?? "",
      heading: headingBefore(html, block.start),
      headers,
      rows: bodyRows,
    });
    index++;
  }
  return tables;
}

function parseListItems(listHtml: string) {
  const ownListHtml = stripNestedLists(listHtml);
  const items: ParsedCell[] = [];

  for (const itemMatch of ownListHtml.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const html = itemMatch[1] ?? "";
    const text = textFromHtml(html);
    if (!text) continue;
    items.push({
      html,
      text,
      links: parseLinks(html),
      isHeader: false,
      colSpan: 1,
      rowSpan: 1,
    });
  }

  return items;
}

function parseLists(html: string) {
  const lists: ParsedList[] = [];
  let index = 0;

  for (const block of listBlocks(html)) {
    const attrs = parseAttributes(block.attrs);
    const items = parseListItems(block.html);
    if (items.length === 0) continue;

    lists.push({
      index,
      id: attrs.get("id") ?? `list-${index}`,
      className: attrs.get("class") ?? "",
      heading: headingBefore(html, block.start),
      items,
    });
    index++;
  }

  return lists;
}

function tablePenalty(table: ParsedTable) {
  const text = `${table.id} ${table.className} ${table.heading ?? ""}`.toLowerCase();
  let penalty = 0;
  if (/\b(navbox|vertical-navbox|metadata|infobox|sidebar|toccolours)\b/.test(text)) {
    penalty += 100;
  }
  if (/\b(references?|citations?|statistics?|stats?|ratings?|viewership)\b/.test(text)) {
    penalty += 40;
  }
  if (/\b(confirmation|committee|votes?|process)\b/.test(text)) {
    penalty += 90;
  }
  return penalty;
}

function scoreTable(table: ParsedTable, spec: CategorySpec) {
  const headerText = table.headers.join(" ").toLowerCase();
  const headingText = (table.heading ?? "").toLowerCase();
  let score = Math.min(table.rows.length, 200) / 4;

  for (const candidate of ANSWER_COLUMN_CANDIDATES) {
    if (headerText.includes(candidate)) score += 35;
  }
  for (const word of spec.normalizedCategory.split(/\s+/)) {
    if (word.length > 3 && headingText.includes(word)) score += 8;
  }
  if (table.className.toLowerCase().includes("wikitable")) score += 15;
  if (table.rows.length >= 20) score += 25;
  if (table.rows.length < 3) score -= 50;

  return score - tablePenalty(table);
}

function listPenalty(list: ParsedList) {
  const text = `${list.id} ${list.className} ${list.heading ?? ""}`.toLowerCase();
  let penalty = 0;
  if (/\b(navbox|metadata|infobox|sidebar|toc|gallery|references?)\b/.test(text)) {
    penalty += 100;
  }
  if (/\b(references?|citations?|external links|further reading|see also|awards?|accolades?)\b/.test(text)) {
    penalty += 80;
  }
  return penalty;
}

function headingMatchesListPurpose(heading: string, spec: CategorySpec) {
  const normalizedHeading = normalizeMatchText(heading);
  if (!normalizedHeading) return false;
  if (spec.normalizedCategory.includes(normalizedHeading)) return true;
  if (normalizedHeading.includes(spec.normalizedCategory)) return true;

  if (
    spec.entityType === "person" &&
    /\b(cast|starring|contestants?|players?|members?|cabinet|officials?|roster)\b/.test(
      normalizedHeading,
    )
  ) {
    return true;
  }

  return spec.normalizedCategory
    .split(/\s+/)
    .some((word) => word.length > 3 && normalizedHeading.includes(word));
}

function scoreList(list: ParsedList, spec: CategorySpec) {
  const headingText = list.heading ?? "";
  let score = Math.min(list.items.length, 100) / 3;
  if (headingMatchesListPurpose(headingText, spec)) score += 65;
  if (list.items.length >= 5) score += 10;
  if (list.items.length < 3) score -= 50;
  return score - listPenalty(list);
}

function selectAnswerColumns(table: ParsedTable, spec: CategorySpec) {
  const headers = table.headers.map((h) => normalizeMatchText(h));
  const preferred =
    spec.entityType === "person"
      ? [
          "name",
          "designee",
          "nominee",
          "incumbent",
          "officeholder",
          "office holder",
          "holder",
          "contestant",
          "player",
          "president",
          "person",
        ]
      : ANSWER_COLUMN_CANDIDATES;

  for (const candidate of preferred) {
    const indexes = headers
      .map((header, index) => ({ header, index }))
      .filter(({ header }) => header === candidate || header.includes(candidate))
      .map(({ index }) => index);
    if (indexes.length > 0) return indexes;
  }

  const nonNumericScores = table.headers.map((_, columnIndex) => {
    let score = 0;
    for (const row of table.rows.slice(0, 25)) {
      const text = row[columnIndex]?.text ?? "";
      if (/[A-Za-z]/.test(text)) score++;
      if (/^\d+$/.test(text)) score -= 2;
      if (text.length > 0 && text.length <= 80) score++;
    }
    return score;
  });

  return [Math.max(0, nonNumericScores.indexOf(Math.max(...nonNumericScores)))];
}

function isLikelyAnswerTable(table: ParsedTable, spec: CategorySpec, score: number) {
  if (score <= 0) return false;
  if (tablePenalty(table) >= 100) return false;

  const headers = table.headers.map((header) => normalizeMatchText(header));
  const hasAnswerHeader = headers.some((header) =>
    ANSWER_COLUMN_CANDIDATES.some(
      (candidate) => header === candidate || header.includes(candidate),
    ),
  );
  const hasRosterShape =
    spec.entityType === "person" &&
    headers.includes("name") &&
    (headers.includes("age") ||
      headers.includes("hometown") ||
      headers.includes("profession") ||
      headers.includes("season") ||
      headers.includes("finish"));

  return (hasAnswerHeader || hasRosterShape) && table.rows.length >= 3;
}

function isLikelyAnswerList(list: ParsedList, spec: CategorySpec, score: number) {
  if (score <= 0) return false;
  if (listPenalty(list) >= 100) return false;
  if (!headingMatchesListPurpose(list.heading ?? "", spec)) return false;
  if (list.items.length < 3) return false;

  if (spec.entityType === "person") {
    const personishItems = list.items.filter((item) => {
      const link = answerLinkForCell(item, spec);
      return !!link || looksLikePersonLink(item.text);
    });
    return personishItems.length >= Math.min(3, list.items.length);
  }

  return true;
}

function blockIdForTable(table: ParsedTable) {
  return table.id || `table-${table.index}`;
}

function blockIdForList(list: ParsedList) {
  return list.id || `list-${list.index}`;
}

function qualifiedBlockId(sourceUrl: string, blockId: string) {
  return `${sourceUrl}#${blockId}`;
}

function getCandidateTables(spec: CategorySpec, html: string) {
  return parseTables(html)
    .map((candidate) => ({
      table: candidate,
      score: scoreTable(candidate, spec),
    }))
    .map((candidate) => ({
      ...candidate,
      includedByDefault: isLikelyAnswerTable(
        candidate.table,
        spec,
        candidate.score,
      ),
    }));
}

function getCandidateLists(spec: CategorySpec, html: string) {
  return parseLists(html)
    .map((candidate) => ({
      list: candidate,
      score: scoreList(candidate, spec),
    }))
    .map((candidate) => ({
      ...candidate,
      includedByDefault: isLikelyAnswerList(
        candidate.list,
        spec,
        candidate.score,
      ),
    }));
}

function tableAllowedByOptions(
  blockId: string,
  sourceUrl: string,
  options: ExtractionOptions = {},
) {
  const qualified = qualifiedBlockId(sourceUrl, blockId);
  if (options.includeBlockIds) {
    return (
      options.includeBlockIds.includes(blockId) ||
      options.includeBlockIds.includes(qualified)
    );
  }
  if (
    options.excludeBlockIds?.includes(blockId) ||
    options.excludeBlockIds?.includes(qualified)
  ) {
    return false;
  }
  return true;
}

export function inspectSourceTables(
  spec: CategorySpec,
  snapshot: SourceSnapshot,
): SourceTableCandidate[] {
  const html = snapshot.rawContent ?? snapshot.normalizedContent ?? "";

  return getCandidateTables(spec, html)
    .filter((candidate) => candidate.includedByDefault)
    .map((candidate): SourceTableCandidate => {
      const table = candidate.table;
      const answerColumnIndexes = selectAnswerColumns(table, spec);
      const answerColumnIndex = answerColumnIndexes[0] ?? 0;
      const answerColumnName =
        answerColumnIndexes
          .map((index) => table.headers[index] ?? `Column ${index + 1}`)
          .join(", ") || `Column ${answerColumnIndex + 1}`;
      const sampleRecords = table.rows
        .flatMap((row) =>
          answerColumnIndexes.map((index) => {
            const cell = row[index];
            if (isNonAnswerHeaderCell(cell)) return "";
            return answerTextForCell(cell, spec);
          }),
        )
        .filter((value) => value && value.length <= 160)
        .slice(0, 5);

      return {
        blockType: "table",
        blockId: blockIdForTable(table),
        tableIndex: table.index,
        heading: table.heading,
        headers: table.headers,
        rowCount: table.rows.length,
        score: candidate.score,
        answerColumnName,
        sampleRecords,
        includedByDefault: candidate.includedByDefault,
      };
    })
    .concat(
      getCandidateLists(spec, html)
        .filter((candidate) => candidate.includedByDefault)
        .map((candidate): SourceTableCandidate => {
          const list = candidate.list;
          const sampleRecords = list.items
            .map((item) => answerTextForCell(item, spec))
            .filter((value) => value && value.length <= 160)
            .slice(0, 5);

          return {
            blockType: "list",
            blockId: blockIdForList(list),
            tableIndex: list.index,
            heading: list.heading,
            headers: ["List item"],
            rowCount: list.items.length,
            score: candidate.score,
            answerColumnName: "List item",
            sampleRecords,
            includedByDefault: candidate.includedByDefault,
          };
        }),
    );
}

function absolutizeUrl(href: string, baseUrl: string) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function looksLikePersonLink(text: string) {
  const cleaned = cleanExtractedValue(text);
  const normalized = normalizeMatchText(cleaned);
  if (cleaned.length < 3 || cleaned.length > 80) return false;
  if (!/^[A-Z]/.test(cleaned)) return false;
  if (
    /\b(united states|secretary|department|administrator|director|office|officials|cabinet|representative|senator|governor|president|vice president|attorney general|state|from|of|group|energy|foundation|committee|agency|corporation|company|campaign|university|college|senate|house|national|republican|democratic|party|news)\b/.test(
      normalized,
    )
  ) {
    return false;
  }

  const nameParts = cleaned.match(/[A-Z][A-Za-z'.-]+/g) ?? [];
  return (
    nameParts.length >= 2 ||
    /^[A-Z][A-Za-z'.-]+$/.test(cleaned)
  );
}

function answerLinkForCell(cell: ParsedCell | undefined, spec: CategorySpec) {
  const links =
    cell?.links.filter((link) => {
      const href = link.href.toLowerCase();
      const normalizedText = normalizeMatchText(link.text);
      return (
        !href.startsWith("/wiki/file:") &&
        !href.includes(":") &&
        !/^(edit|source|reference|announced|elected)$/.test(normalizedText)
      );
    }) ?? [];

  if (spec.entityType === "person") {
    return (
      links.find((link) => link.isBold && looksLikePersonLink(link.text)) ??
      links.find((link) => looksLikePersonLink(link.text))
    );
  }

  return links[0];
}

function answerTextForCell(cell: ParsedCell | undefined, spec: CategorySpec) {
  const link = answerLinkForCell(cell, spec);
  if (spec.entityType === "person" && link?.text) {
    return cleanExtractedValue(link.text);
  }

  return cleanExtractedValue(cell?.text ?? "");
}

function isNonAnswerHeaderCell(cell: ParsedCell | undefined) {
  return !!cell?.isHeader && cell.colSpan > 1;
}

export function extractRecordsFromSource(
  spec: CategorySpec,
  snapshot: SourceSnapshot,
  options: ExtractionOptions = {},
): { records: ExtractedRecord[]; warnings: string[] } {
  const html = snapshot.rawContent ?? snapshot.normalizedContent ?? "";
  const tables = getCandidateTables(spec, html);
  const lists = getCandidateLists(spec, html);
  const warnings: string[] = [];

  if (tables.length === 0 && lists.length === 0) {
    return { records: [], warnings: ["No extractable HTML tables or lists found in source."] };
  }

  const candidateTables = tables
    .filter((candidate) =>
      candidate.includedByDefault &&
      tableAllowedByOptions(
        blockIdForTable(candidate.table),
        snapshot.url,
        options,
      ),
    );
  const candidateLists = lists
    .filter((candidate) =>
      candidate.includedByDefault &&
      tableAllowedByOptions(
        blockIdForList(candidate.list),
        snapshot.url,
        options,
      ),
    );

  if (candidateTables.length === 0 && candidateLists.length === 0) {
    return { records: [], warnings: ["No suitable answer table or list found."] };
  }

  const records: ExtractedRecord[] = [];

  for (const candidate of candidateTables) {
    const table = candidate.table;
    const answerColumnIndexes = selectAnswerColumns(table, spec);

    table.rows.forEach((row, rowIndex) => {
      answerColumnIndexes.forEach((answerColumnIndex) => {
        const columnName =
          table.headers[answerColumnIndex] ?? `Column ${answerColumnIndex + 1}`;
        const cell = row[answerColumnIndex];
        if (isNonAnswerHeaderCell(cell)) return;
        const rawAnswer = answerTextForCell(cell, spec);
        if (normalizeMatchText(rawAnswer) === normalizeMatchText(columnName)) return;
        if (
          spec.entityType === "person" &&
          !answerLinkForCell(cell, spec) &&
          !looksLikePersonLink(rawAnswer)
        ) {
          return;
        }
        if (!rawAnswer || rawAnswer.length > 160) return;

        const sourceLink = answerLinkForCell(cell, spec);
        records.push({
          rawAnswer,
          canonicalCandidate: rawAnswer,
          entityType: spec.entityType,
          metadata: {
            tableHeading: table.heading,
            sourceLink: sourceLink
              ? absolutizeUrl(sourceLink.href, snapshot.url)
              : null,
            entityIds: sourceLink?.href
              ? {
                  wikipediaPath: sourceLink.href.startsWith("/wiki/")
                    ? sourceLink.href
                    : undefined,
                }
              : undefined,
            row: Object.fromEntries(
              row.map((rowCell, index) => [
                table.headers[index] ?? `Column ${index + 1}`,
                rowCell.text,
              ]),
            ),
          },
          sourcePointer: {
            url: snapshot.url,
            blockType: "table",
            blockId: blockIdForTable(table),
            rowIndex,
            columnName,
            rawValue: cell?.text,
          },
          confidence: Math.max(0.55, Math.min(0.99, candidate.score / 100)),
        });
      });
    });
  }

  for (const candidate of candidateLists) {
    const list = candidate.list;
    list.items.forEach((item, itemIndex) => {
      const rawAnswer = answerTextForCell(item, spec);
      if (
        spec.entityType === "person" &&
        !answerLinkForCell(item, spec) &&
        !looksLikePersonLink(rawAnswer)
      ) {
        return;
      }
      if (!rawAnswer || rawAnswer.length > 160) return;

      const sourceLink = answerLinkForCell(item, spec);
      records.push({
        rawAnswer,
        canonicalCandidate: rawAnswer,
        entityType: spec.entityType,
        metadata: {
          tableHeading: list.heading,
          listHeading: list.heading,
          sourceLink: sourceLink
            ? absolutizeUrl(sourceLink.href, snapshot.url)
            : null,
          entityIds: sourceLink?.href
            ? {
                wikipediaPath: sourceLink.href.startsWith("/wiki/")
                  ? sourceLink.href
                  : undefined,
              }
            : undefined,
          rawListItem: item.text,
        },
        sourcePointer: {
          url: snapshot.url,
          blockType: "list",
          blockId: blockIdForList(list),
          rowIndex: itemIndex,
          columnName: "List item",
          rawValue: item.text,
        },
        confidence: Math.max(0.55, Math.min(0.99, candidate.score / 100)),
      });
    });
  }

  if (records.length === 0) {
    warnings.push("Selected table or list did not yield usable answer records.");
  }

  return { records, warnings };
}
