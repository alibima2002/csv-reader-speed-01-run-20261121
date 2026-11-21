// Fast drop-in for csv-reader 1.0.0 (make.fun's own reference program).
//
// Returns exactly what csv-reader's readCsv returns for every input
// {text, header}: {columns, rows, errors}, following its written broken-row
// policy (see the kit's baselines/csv-reader/vendor/csv-reader/index.js):
//   - U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next quote that is not doubled,
//     "" inside it is one quote, each CRLF or lone CR inside it reads as LF;
//     what follows its closing quote, up to the next comma or line break, is
//     appended as it stands (quote_junk, when the field ends); a quote that
//     never closes is a literal character and the text after it is read again
//     as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it, each padded (short_row) or cut (long_row) to the
//     first record's width;
//   - each error is {code, line, row}, in the order met; line is the 1-based
//     line its record starts on, counting every LF, CRLF and lone CR inside
//     quotes, row its record's index in rows (null for the header).
//
// Speed: the reference reads one character at a time and builds every field
// a character at a time. This implementation instead jumps between
// delimiters with one native scan (a global regex for the next comma, LF or
// CR) and cuts fields out with String#slice, so the work per field is one
// native scan plus one slice instead of one JS step per character. Newlines
// inside quoted fields are counted with the same kind of native scan; the
// CR-to-LF conversion of a quoted field happens once, with one
// String#replace, and only when the field actually contains a CR. No
// behaviour differs: every branch below mirrors the reference's branches in
// the same order, and the error records are pushed at the same points.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next (all state lives inside run()).

/** How a field ended: 0 = at a comma, 1 = at a line break, 2 = at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0; // the next character to read
  let line = 1; // the line that character is on

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // One reusable result object, so no object is allocated per field.
  const out = { value: '', ended: END, added: 0 };

  // The next comma, LF or CR at or after a position, in one native scan.
  // (lastIndex is set before every exec, so no state carries between calls.)
  const DELIM = /[,\n\r]/g;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). `added` counts
  // the characters kept. Mirrors the reference's readUnquoted exactly.
  function readUnquoted(value) {
    let added = 0;
    let segs = null; // only built when a stray CR splits the field
    let start = pos;
    for (;;) {
      DELIM.lastIndex = pos;
      const m = DELIM.exec(text);
      if (m === null) {
        const tail = text.slice(start);
        value = segs !== null ? segs.join('') + tail : value + tail;
        added += n - start;
        pos = n;
        out.value = value;
        out.ended = END;
        out.added = added;
        return out;
      }
      const end = m.index;
      const ch = m[0];
      if (ch === '\r' && text.charCodeAt(end + 1) !== 10) {
        // A CR not followed by LF: dropped, error recorded, field goes on.
        error('stray_cr');
        if (segs === null) segs = [value, text.slice(start, end)];
        else segs.push(text.slice(start, end));
        added += end - start;
        pos = end + 1;
        start = end + 1;
        continue;
      }
      const seg = text.slice(start, end);
      value = segs !== null ? segs.join('') + seg : value + seg;
      added += end - start;
      if (ch === ',') {
        pos = end + 1;
        out.ended = COMMA;
      } else if (ch === '\n') {
        pos = end + 1;
        line += 1;
        out.ended = LINE_BREAK;
      } else {
        pos = end + 2; // CRLF
        line += 1;
        out.ended = LINE_BREAK;
      }
      out.value = value;
      out.added = added;
      return out;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Mirrors the
  // reference's readQuoted exactly, including its unterminated-quote
  // fallback (the quote becomes literal and the rest is read unquoted).
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let parts = null; // raw segments plus '"' separators, only when a doubled quote occurs
    let anyCR = false;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as an unquoted field.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      const seg = text.slice(pos, q);
      // Count the line breaks this segment holds (each LF, each CRLF and
      // each lone CR is one) and note whether it holds a CR at all.
      const breaks = seg.match(/\r\n|\r|\n/g);
      if (breaks !== null) {
        line += breaks.length;
        if (!anyCR && seg.indexOf('\r') !== -1) anyCR = true;
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one quote in the value, field goes on.
        if (parts === null) parts = [seg, '"'];
        else { parts.push(seg, '"'); }
        pos = q + 2;
        continue;
      }
      // The closing quote.
      let value;
      if (parts === null) value = seg;
      else { parts.push(seg); value = parts.join(''); }
      // Each CRLF or lone CR inside the quotes reads as LF.
      if (anyCR) value = value.replace(/\r\n?/g, '\n');
      pos = q + 1;
      if (pos >= n) {
        out.value = value;
        out.ended = END;
        out.added = 0;
        return out;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) { // ','
        pos += 1;
        out.value = value;
        out.ended = COMMA;
        out.added = 0;
        return out;
      }
      if (c === 10) { // LF
        pos += 1;
        line += 1;
        out.value = value;
        out.ended = LINE_BREAK;
        out.added = 0;
        return out;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) { // CRLF
        pos += 2;
        line += 1;
        out.value = value;
        out.ended = LINE_BREAK;
        out.added = 0;
        return out;
      }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break.
      const junk = readUnquoted(value);
      if (junk.added > 0) error('quote_junk');
      return junk;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    let ended;
    do {
      quoted = text.charCodeAt(pos) === 34;
      const field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
      ended = field.ended;
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
