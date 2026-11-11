import PDFDocument from "pdfkit";
import type { Report } from "./report.js";

const margin = 36;
const ink = "#1f362f";
const muted = "#6b7a73";
const line = "#d9e2dd";
const headerFill = "#eaf4f0";
const fontSize = 7.5;
const cellPadding = 4;

/** PDF A4 horizontal con encabezado, resumen, tabla paginada y notas. */
export function renderPdf(report: Report, generatedAt: Date): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin,
      bufferPages: true,
      info: { Title: report.title, Author: "SIMONA-BN (prototipo académico)", CreationDate: generatedAt },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - margin * 2;
    const bottom = () => doc.page.height - margin - 14;

    doc.fillColor(ink).font("Helvetica-Bold").fontSize(15).text(report.title);
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(8).fillColor(muted);
    for (const [label, value] of report.meta) {
      doc.text(`${label}: ${value}`);
    }

    if (report.summary?.length) {
      doc.moveDown(0.6);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(ink).text("Resumen");
      doc.font("Helvetica").fontSize(8);
      for (const [label, value] of report.summary) {
        doc.text(`${label}: ${value}`);
      }
    }
    doc.moveDown(0.8);

    const totalWeight = report.columns.reduce((sum, column) => sum + (column.width ?? 1), 0);
    const widths = report.columns.map((column) => ((column.width ?? 1) / totalWeight) * pageWidth);

    const rowHeight = (cells: string[], bold: boolean) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
      return Math.max(...cells.map((cell, index) =>
        doc.heightOfString(cell || " ", { width: widths[index]! - cellPadding * 2 }))) + cellPadding * 2;
    };

    const drawRow = (cells: string[], options: { header?: boolean; shaded?: boolean }) => {
      const height = rowHeight(cells, Boolean(options.header));
      if (doc.y + height > bottom()) {
        doc.addPage();
        if (!options.header) drawRow(report.columns.map(({ label }) => label), { header: true });
      }
      const top = doc.y;
      if (options.header || options.shaded) {
        doc.rect(margin, top, pageWidth, height).fill(options.header ? headerFill : "#f8faf9");
      }
      let x = margin;
      cells.forEach((cell, index) => {
        const column = report.columns[index]!;
        doc.font(options.header ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize).fillColor(ink)
          .text(cell, x + cellPadding, top + cellPadding, {
            width: widths[index]! - cellPadding * 2,
            align: options.header ? "left" : column.align ?? "left",
          });
        x += widths[index]!;
      });
      doc.moveTo(margin, top + height).lineTo(margin + pageWidth, top + height).lineWidth(0.5).strokeColor(line).stroke();
      doc.x = margin;
      doc.y = top + height;
    };

    drawRow(report.columns.map(({ label }) => label), { header: true });
    if (report.rows.length === 0) {
      doc.moveDown(0.5).font("Helvetica-Oblique").fontSize(8).fillColor(muted)
        .text("Sin registros para los filtros seleccionados.", margin);
    }
    report.rows.forEach((row, index) => {
      drawRow(report.columns.map(({ key }) => (row[key] === null || row[key] === undefined ? "" : String(row[key]))), {
        shaded: index % 2 === 1,
      });
    });

    if (report.notes.length > 0) {
      doc.moveDown(0.8);
      if (doc.y > bottom() - 40) doc.addPage();
      doc.font("Helvetica-Bold").fontSize(8).fillColor(ink).text("Notas", margin);
      doc.font("Helvetica").fontSize(7.5).fillColor(muted);
      for (const note of report.notes) doc.text(`- ${note}`, margin, undefined, { width: pageWidth });
    }

    const range = doc.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page += 1) {
      doc.switchToPage(page);
      // Sin esto, escribir bajo el margen inferior hace que PDFKit agregue una página en blanco.
      doc.page.margins.bottom = 0;
      doc.font("Helvetica").fontSize(7).fillColor(muted).text(
        `SIMONA-BN - prototipo académico con datos simulados   |   Página ${page + 1} de ${range.count}`,
        margin,
        doc.page.height - margin + 6,
        { width: pageWidth, align: "center", lineBreak: false },
      );
    }
    doc.end();
  });
}
