const BULLET = "▪";
const INDENT = "  ";

function position(value, index) {
  return Math.max(
    0,
    Math.min(value.length, Number.isInteger(index) ? index : 0)
  );
}

function result(value, selectionStart, selectionEnd, changed) {
  return { value, selectionStart, selectionEnd, changed };
}

function insertBulletLine(value, selectionStart, selectionEnd) {
  const start = position(value, selectionStart);
  const end = Math.max(start, position(value, selectionEnd));
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const beforeCaret = value.slice(lineStart, start);
  const bullet = beforeCaret.match(/^([ \t]*)▪(?: |$)/);
  const indentation = bullet
    ? bullet[1]
    : (beforeCaret.match(/^[ \t]*/) || [""])[0];
  const insertion = `\n${indentation}${BULLET} `;
  const caret = start + insertion.length;
  return result(
    value.slice(0, start) + insertion + value.slice(end),
    caret,
    caret,
    true
  );
}

function selectedLineStarts(value, start, end) {
  const first = value.lastIndexOf("\n", start - 1) + 1;
  const effectiveEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const starts = [first];
  let newline = value.indexOf("\n", first);
  while (newline >= 0 && newline < effectiveEnd) {
    starts.push(newline + 1);
    newline = value.indexOf("\n", newline + 1);
  }
  return starts;
}

function indentLines(value, selectionStart, selectionEnd, outdent = false) {
  const start = position(value, selectionStart);
  const end = Math.max(start, position(value, selectionEnd));
  const starts = selectedLineStarts(value, start, end);
  if (!outdent) {
    let next = value;
    for (const lineStart of [...starts].reverse())
      next = next.slice(0, lineStart) + INDENT + next.slice(lineStart);
    const moved = index =>
      index +
      starts.filter(lineStart => lineStart <= index).length * INDENT.length;
    return result(next, moved(start), moved(end), true);
  }
  const removals = starts
    .map(lineStart => {
      const match = value.slice(lineStart).match(/^(?: {1,2}|\t)/);
      return match ? { start: lineStart, length: match[0].length } : null;
    })
    .filter(Boolean);
  if (!removals.length) return result(value, start, end, false);
  let next = value;
  for (const removal of [...removals].reverse())
    next =
      next.slice(0, removal.start) + next.slice(removal.start + removal.length);
  const moved = index => {
    let removed = 0;
    for (const removal of removals) {
      if (index <= removal.start) break;
      if (index <= removal.start + removal.length)
        return removal.start - removed;
      removed += removal.length;
    }
    return index - removed;
  };
  return result(next, moved(start), moved(end), true);
}

function removeBulletPrefix(value, selectionStart, selectionEnd) {
  const start = position(value, selectionStart);
  const end = position(value, selectionEnd);
  if (start !== end) return result(value, start, end, false);
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const beforeCaret = value.slice(lineStart, start);
  const prefix = beforeCaret.match(/^([ \t]*)▪ ?$/);
  if (!prefix) return result(value, start, end, false);
  const markerStart = lineStart + prefix[1].length;
  return result(
    value.slice(0, markerStart) + value.slice(start),
    markerStart,
    markerStart,
    true
  );
}

module.exports = { insertBulletLine, indentLines, removeBulletPrefix };
