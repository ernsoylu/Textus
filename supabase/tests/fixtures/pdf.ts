export function textPdf(count = 10) {
  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  const pages: number[] = [];
  for (let page = 1; page <= count; page++) {
    pages.push(objects.length + 1);
    const stream = `BT /F1 12 Tf 50 700 Td (Photovoltaic evidence page ${page}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 ${2 * count + 3} 0 R >> >> /Contents ${objects.length + 2} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${pages.map((p) => `${p} 0 R`).join(' ')}] /Count ${count} >>`;
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(output.length); output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const start = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return new TextEncoder().encode(output);
}
