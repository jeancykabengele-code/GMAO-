import { Injectable } from '@angular/core';
import type { CellObject, Row, SheetData } from 'write-excel-file/universal';
import { downloadBlob } from './file-download.util';

export interface ExcelTableColumn<T> {
  header: string;
  value: (row: T) => unknown;
  width?: number;
}

export interface ExcelTableExport<T> {
  title: string;
  fileName: string;
  columns: ExcelTableColumn<T>[];
  rows: T[];
}

@Injectable({ providedIn: 'root' })
export class ExcelExportService {
  async exportTable<T>({ title, fileName, columns, rows }: ExcelTableExport<T>): Promise<void> {
    const { default: writeExcelFile } = await import('write-excel-file/universal');
    const columnCount = Math.max(columns.length, 1);
    const sheetData: SheetData = [
      this.spanningRow({
        value: title,
        columnSpan: columnCount,
        backgroundColor: '#ff7900',
        textColor: '#ffffff',
        fontWeight: 'bold',
        fontSize: 16,
        height: 30,
        align: 'left',
        alignVertical: 'center',
      }, columnCount),
      this.spanningRow({
        value: `GMAO ORDC - Export du ${new Intl.DateTimeFormat('fr-FR', {
          dateStyle: 'long',
          timeStyle: 'short',
        }).format(new Date())}`,
        columnSpan: columnCount,
        textColor: '#666b73',
        fontStyle: 'italic',
        fontSize: 10,
      }, columnCount),
      Array.from({ length: columnCount }, () => null),
      columns.map((column) => ({
        value: column.header,
        backgroundColor: '#292929',
        textColor: '#ffffff',
        fontWeight: 'bold',
        align: 'center',
        alignVertical: 'center',
        wrap: true,
        borderColor: '#d2d2d2',
      })),
    ];

    if (rows.length) {
      rows.forEach((row, rowIndex) => {
        sheetData.push(columns.map((column) => this.dataCell(column.value(row), rowIndex)));
      });
    } else {
      sheetData.push(this.spanningRow({
        value: 'Aucune donnée ne correspond aux filtres actifs.',
        columnSpan: columnCount,
        textColor: '#666b73',
        fontStyle: 'italic',
        align: 'center',
      }, columnCount));
    }

    const columnWidths = columns.map((column) => {
      const contentWidth = Math.max(
        column.header.length,
        ...rows.slice(0, 200).map((row) => String(column.value(row) ?? '').length),
      );
      return { width: column.width ?? Math.min(Math.max(contentWidth + 2, 12), 40) };
    });

    const blob = await writeExcelFile(sheetData, {
      sheet: this.safeSheetName(title),
      columns: columnWidths,
      stickyRowsCount: 4,
      showGridLines: false,
      dateFormat: 'yyyy-mm-dd',
    }, {
      fontFamily: 'Arial',
      fontSize: 10,
    }).toBlob();

    this.download(blob, `${this.safeFileName(fileName)}.xlsx`);
  }

  private dataCell(value: unknown, rowIndex: number): CellObject {
    const normalizedValue = this.normalizeValue(value);
    const cell: CellObject = {
      value: normalizedValue ?? undefined,
      align: typeof normalizedValue === 'number' ? 'right' : 'left',
      alignVertical: 'center',
      wrap: true,
      borderColor: '#d2d2d2',
    };
    if (normalizedValue instanceof Date) cell.format = 'yyyy-mm-dd';
    if (typeof normalizedValue === 'number') cell.format = '#,##0.###';
    if (rowIndex % 2 === 1) cell.backgroundColor = '#f7f7f7';
    return cell;
  }

  private spanningRow(cell: CellObject, columnCount: number): Row {
    return [cell, ...Array.from({ length: columnCount - 1 }, () => null)];
  }

  private normalizeValue(value: unknown): string | number | boolean | Date | null {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split('-').map(Number);
      return new Date(year, month - 1, day);
    }
    return String(value);
  }

  private download(blob: Blob, fileName: string): void {
    downloadBlob(blob, fileName);
  }

  private safeSheetName(value: string): string {
    return value.replace(/[\\/*?:\[\]]/g, ' ').trim().slice(0, 31) || 'Données';
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
