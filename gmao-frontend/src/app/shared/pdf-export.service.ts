import { Injectable } from '@angular/core';
import type { jsPDF } from 'jspdf';
import type { ExcelSheetExport, ExcelTableExport, ExportRowKind } from './excel-export.service';
import type { ExcelExportService } from './excel-export.service';
import { downloadBlob } from './file-download.util';

/** Ce que les pages utilisent : un exporteur de tableau (Excel ou PDF). */
export type TableExporter = Pick<ExcelExportService, 'exportTable'>;

type Cell = string | number | boolean | Date | null;

const ORANGE: [number, number, number] = [255, 121, 0];
const ANTHRACITE: [number, number, number] = [41, 41, 41];
const MUTED: [number, number, number] = [102, 107, 115];
const STRIPE: [number, number, number] = [247, 247, 247];

/** Caractères hors Latin-1 que les polices standard d'un PDF (WinAnsi) savent encore dessiner. */
const WIN_ANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split(''));

/**
 * Export PDF des tableaux, avec la même description que l'export Excel (`ExcelTableExport`) :
 * toujours du A4 (portrait pour un tableau étroit, paysage sinon), un bandeau de titre orange par section,
 * un tableau paginé à en-tête répété, un pied de page numéroté. Un tableau trop large pour la page continue
 * sur les pages suivantes en répétant ses premières colonnes (date, heure…).
 * `exportWorkbook` met plusieurs sections (une par feuille Excel) dans un seul fichier.
 */
@Injectable({ providedIn: 'root' })
export class PdfExportService {
  async exportTable<T>({ title, fileName, columns, rows, sheetName }: ExcelTableExport<T>): Promise<void> {
    await this.exportWorkbook(fileName, [{ title, columns, rows, sheetName }]);
  }

  async exportWorkbook(fileName: string, sheets: Array<ExcelSheetExport<any>>): Promise<void> {
    const doc = await this.render(sheets);
    this.download(doc.output('blob'), `${this.safeFileName(fileName)}.pdf`);
  }

  /** Construit le document sans le télécharger (utilisé par l'export et par les tests). */
  async render(sheets: Array<ExcelSheetExport<any>>): Promise<jsPDF> {
    const [{ jsPDF: JsPdf }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const orientations = sheets.map((sheet) => this.orientation(sheet));
    const doc = new JsPdf({ orientation: orientations[0] ?? 'landscape', unit: 'mm', format: 'a4' });
    doc.setProperties({ title: sheets[0]?.title ?? 'GMAO ORDC', creator: 'GMAO ORDC' });

    sheets.forEach((sheet, index) => {
      if (index > 0) doc.addPage('a4', orientations[index]);
      const width = doc.internal.pageSize.getWidth();
      this.drawTitle(doc, sheet, width);
      const columns = sheet.columns;
      const body = sheet.rows.map((row) => this.bodyRow(sheet, row));
      autoTable(doc, {
        startY: 30,
        margin: { top: 14, left: 10, right: 10, bottom: 14 },
        head: [columns.map((column) => this.text(column.header))],
        body: body.length ? body : [[{ content: 'Aucune donnée ne correspond aux filtres actifs.', colSpan: Math.max(columns.length, 1), styles: { halign: 'center', textColor: MUTED, fontStyle: 'italic' } }]],
        theme: 'grid',
        showHead: 'everyPage',
        horizontalPageBreak: true,
        horizontalPageBreakRepeat: Array.from({ length: Math.min(sheet.pdfRepeatColumns ?? 1, Math.max(columns.length - 1, 0)) }, (_, column) => column),
        styles: { font: 'helvetica', fontSize: this.fontSize(columns.length), cellPadding: 1.6, lineColor: [210, 210, 210], lineWidth: 0.1, valign: 'middle' },
        headStyles: { fillColor: ANTHRACITE, textColor: 255, halign: 'center', fontStyle: 'bold' },
        alternateRowStyles: { fillColor: STRIPE },
        columnStyles: Object.fromEntries(columns.map((_, columnIndex) => [columnIndex, { halign: this.alignment(sheet, columnIndex) }])),
      });
    });

    this.drawFooters(doc);
    return doc;
  }

  /** Une ligne du tableau : ligne de données, ou bandeau pleine largeur (titre, étape, section) quand `rowKind` le demande. */
  private bodyRow(sheet: ExcelSheetExport<any>, row: unknown) {
    const columns = sheet.columns;
    const kind: ExportRowKind | undefined = sheet.rowKind?.(row);
    const span = Math.max(columns.length, 1);
    if (kind === 'title') {
      return [{ content: this.text(this.format(columns[0].value(row))), colSpan: span, styles: { fillColor: ORANGE, textColor: 255, fontStyle: 'bold' as const, fontSize: 10, halign: 'left' as const } }];
    }
    if (kind === 'step') {
      return [{ content: this.text(this.format(columns[0].value(row))), colSpan: span, styles: { fillColor: ANTHRACITE, textColor: 255, fontStyle: 'bold' as const, halign: 'left' as const } }];
    }
    if (kind === 'section') {
      return [{ content: this.text(this.format(columns[0].value(row))), colSpan: span, styles: { fillColor: [237, 237, 238] as [number, number, number], textColor: 0, fontStyle: 'bold' as const, halign: 'left' as const } }];
    }
    if (kind === 'spacer') {
      return [{ content: '', colSpan: span, styles: { fillColor: [255, 255, 255] as [number, number, number], lineWidth: 0, cellPadding: 1.2, minCellHeight: 2 } }];
    }
    const cells = columns.map((column) => this.text(this.format(column.value(row))));
    if (kind === 'result' || kind === 'check') {
      const styles = kind === 'result'
        ? { fillColor: [255, 243, 230] as [number, number, number], fontStyle: 'bold' as const }
        : { fillColor: [255, 255, 255] as [number, number, number] };
      return cells.map((content) => ({ content, styles }));
    }
    return cells;
  }

  private drawTitle(doc: jsPDF, sheet: ExcelSheetExport<any>, width: number): void {
    doc.setFillColor(...ORANGE);
    doc.rect(0, 0, width, 20, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(this.text(sheet.title), 10, 13);
    doc.setTextColor(...MUTED);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    const date = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date());
    const count = sheet.rows.length;
    doc.text(this.text(`GMAO ORDC - Export du ${date} - ${count} ligne${count > 1 ? 's' : ''}`), 10, 26);
    doc.setTextColor(0, 0, 0);
  }

  private drawFooters(doc: jsPDF): void {
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
      doc.setPage(page);
      const { width, height } = doc.internal.pageSize;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text('GMAO ORDC', 10, height - 6);
      doc.text(`Page ${page} / ${pages}`, width - 10, height - 6, { align: 'right' });
    }
  }

  /** Portrait quand le tableau est étroit, paysage sinon (sauf demande explicite de la feuille). */
  private orientation(sheet: ExcelSheetExport<any>): 'portrait' | 'landscape' {
    return sheet.pdfOrientation ?? (sheet.columns.length <= 6 ? 'portrait' : 'landscape');
  }

  private fontSize(columnCount: number): number {
    if (columnCount <= 6) return 9;
    if (columnCount <= 10) return 8;
    return 7;
  }

  /** Les nombres sont alignés à droite ; le type est lu sur la première ligne renseignée. */
  private alignment(sheet: ExcelSheetExport<any>, columnIndex: number): 'left' | 'right' {
    const column = sheet.columns[columnIndex];
    const sample = sheet.rows.slice(0, 50)
      .filter((row) => !['title', 'step', 'section', 'spacer'].includes(sheet.rowKind?.(row) ?? ''))
      .map((row) => column.value(row)).find((value) => value !== null && value !== undefined && value !== '');
    return typeof sample === 'number' ? 'right' : 'left';
  }

  private format(value: unknown): Cell {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
    if (typeof value === 'number') return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(value);
    if (value instanceof Date) return new Intl.DateTimeFormat('fr-FR').format(value);
    const text = String(value);
    const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    return isoDate ? `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}` : text;
  }

  /** Les polices standard d'un PDF ne dessinent pas tout l'Unicode : on remplace ce qui est courant, le reste devient « ? ». */
  private text(value: Cell): string {
    return String(value)
      .replace(/[  ]/g, ' ')
      .replace(/≤/g, '<=')
      .replace(/≥/g, '>=')
      .replace(/↔/g, '<->')
      .replace(/→/g, '->')
      .replace(/[−]/g, '-')
      .replace(/[^\u0000-ÿ]/g, (char) => (WIN_ANSI_EXTRAS.has(char) ? char : '?'));
  }

  private download(blob: Blob, fileName: string): void {
    downloadBlob(blob, fileName);
  }

  private safeFileName(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
