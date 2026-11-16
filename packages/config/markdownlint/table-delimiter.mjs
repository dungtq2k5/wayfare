// wayfare-table-delimiter — every table delimiter cell is exactly `:----` (the house style,
// docs/README.md "Writing docs"). Works on markdownlint's micromark tokens, so tables inside
// fenced code are never touched. Reports each offending row once, with a whole-row fix.

/** The one delimiter cell the docs use: left-aligned, four dashes. */
export const DELIMITER_CELL = ':----';

/** @param {readonly import('markdownlint').MicromarkToken[]} tokens */
function* delimiterRows(tokens) {
  for (const token of tokens) {
    if (token.type === 'tableDelimiterRow') yield token;
    else yield* delimiterRows(token.children);
  }
}

/** @type {import('markdownlint').Rule} */
const tableDelimiter = {
  names: ['wayfare-table-delimiter'],
  description: `Table delimiter cells are "${DELIMITER_CELL}"`,
  tags: ['table'],
  parser: 'micromark',
  function: (params, onError) => {
    for (const row of delimiterRows(params.parsers.micromark.tokens)) {
      const cells = row.children
        .filter((child) => child.type === 'tableDelimiter')
        .flatMap((delimiter) =>
          delimiter.children.filter((child) => child.type === 'tableContent'),
        );
      if (cells.every((cell) => cell.text === DELIMITER_CELL)) continue;

      const line = params.lines[row.startLine - 1] ?? '';
      // Rewrite right to left so earlier columns stay valid.
      let fixed = line;
      for (const cell of cells.toReversed()) {
        fixed =
          fixed.slice(0, cell.startColumn - 1) + DELIMITER_CELL + fixed.slice(cell.endColumn - 1);
      }
      onError({
        lineNumber: row.startLine,
        detail: `Found ${cells.map((cell) => `"${cell.text}"`).join(', ')}`,
        context: line,
        fixInfo: { editColumn: 1, deleteCount: line.length, insertText: fixed },
      });
    }
  },
};

export default tableDelimiter;
