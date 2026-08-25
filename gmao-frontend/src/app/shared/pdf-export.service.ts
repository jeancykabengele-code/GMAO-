import { Injectable } from '@angular/core';

export interface PdfTableColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

export interface PdfTableExport<T> {
  title: string;
  fileName: string;
  columns: PdfTableColumn<T>[];
  rows: T[];
}

@Injectable({ providedIn: 'root' })
export class PdfExportService {
  async exportTable<T>({ title, fileName, columns, rows }: PdfTableExport<T>): Promise<void> {
    const [{ jsPDF }, { autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const orientation = columns.length > 6 ? 'landscape' : 'portrait';
    const document = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
    const generatedAt = new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(new Date());

    document.setFont('helvetica', 'bold');
    document.setFontSize(15);
    document.setTextColor(41, 41, 41);
    document.text(title, 14, 16);
    document.setFont('helvetica', 'normal');
    document.setFontSize(8);
    document.setTextColor(100, 105, 113);
    document.text(`GMAO ORDC - Export du ${generatedAt}`, 14, 22);

    autoTable(document, {
      startY: 28,
      head: [columns.map((column) => column.header)],
      body: rows.length
        ? rows.map((row) => columns.map((column) => this.formatValue(column.value(row))))
        : [[{ content: 'Aucune donnée ne correspond aux filtres actifs.', colSpan: columns.length }]],
      theme: 'grid',
      showHead: 'everyPage',
      styles: {
        font: 'helvetica',
        fontSize: columns.length > 8 ? 6.5 : 7.5,
        cellPadding: 2,
        overflow: 'linebreak',
        textColor: [41, 41, 41],
        lineColor: [210, 210, 210],
        lineWidth: 0.15,
        valign: 'middle',
      },
      headStyles: {
        fillColor: [41, 41, 41],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      alternateRowStyles: { fillColor: [247, 247, 247] },
      margin: { top: 28, right: 10, bottom: 14, left: 10 },
      didDrawPage: (data) => {
        const pageWidth = document.internal.pageSize.getWidth();
        const pageHeight = document.internal.pageSize.getHeight();
        document.setFontSize(7);
        document.setTextColor(110, 110, 110);
        document.text(`Page ${data.pageNumber}`, pageWidth - 10, pageHeight - 6, { align: 'right' });
        if (data.pageNumber > 1) {
          document.setFont('helvetica', 'bold');
          document.setFontSize(10);
          document.setTextColor(41, 41, 41);
          document.text(title, 10, 15);
        }
      },
    });

    document.save(`${this.safeFileName(fileName)}.pdf`);
  }

  private formatValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
    if (typeof value === 'number') return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(value);
    return String(value);
  }

  private safeFileName(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}