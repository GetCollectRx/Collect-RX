/** Minimal single-page PDF (text table) — no external PDF library. */
function escapePdfText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function buildSimpleReportPdf(title: string, rows: string[][]): Buffer {
  const textLines: string[] = [];
  let y = 780;
  const lineH = 14;
  textLines.push(`BT /F1 14 Tf 50 ${y} Td (${escapePdfText(title)}) Tj ET`);
  y -= 28;
  textLines.push(`BT /F1 9 Tf 50 ${y} Td (${escapePdfText('Generated ' + new Date().toISOString().slice(0, 10))}) Tj ET`);
  y -= 24;
  for (const row of rows) {
    const line = row.join('  |  ');
    if (y < 60) break;
    textLines.push(`BT /F1 8 Tf 50 ${y} Td (${escapePdfText(line.slice(0, 110))}) Tj ET`);
    y -= lineH;
  }
  const stream = `${textLines.join('\n')}\n`;
  const streamLen = Buffer.byteLength(stream, 'utf8');

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, 'utf8'));
    body += obj;
  }
  const xrefStart = Buffer.byteLength(body, 'utf8');
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, 'utf8');
}
