import readXlsxFile from 'read-excel-file/browser';
import { ExcelExportService } from './excel-export.service';

describe('ExcelExportService', () => {
  it('creates a real XLSX workbook with typed table values', async () => {
    const service = new ExcelExportService();
    let generatedBlob: Blob | undefined;
    let generatedFileName = '';

    (service as unknown as { download: (blob: Blob, fileName: string) => void }).download = (
      blob: Blob,
      fileName: string,
    ) => {
      generatedBlob = blob;
      generatedFileName = fileName;
    };

    await service.exportTable({
      title: 'Registre équipements',
      fileName: 'Registre équipements',
      columns: [
        { header: 'Site', value: (row) => row.site },
        { header: 'Date', value: (row) => row.date },
        { header: 'Quantité', value: (row) => row.quantity },
        { header: 'Actif', value: (row) => row.active },
      ],
      rows: [{ site: 'Goma', date: '2026-08-25', quantity: 12.5, active: true }],
    });

    expect(generatedFileName).toBe('registre-equipements.xlsx');
    expect(generatedBlob).toBeDefined();
    expect(generatedBlob!.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const [spreadsheet] = await readXlsxFile(generatedBlob!, { dateFormat: 'yyyy-mm-dd' });
    const spreadsheetRows = spreadsheet.data;
    expect(spreadsheetRows[0][0]).toBe('Registre équipements');
    expect(spreadsheetRows[3][0]).toBe('Site');
    expect(spreadsheetRows[4][0]).toBe('Goma');
    expect(spreadsheetRows[4][1]).toBeInstanceOf(Date);
    expect(spreadsheetRows[4][2]).toBe(12.5);
    expect(spreadsheetRows[4][3]).toBe(true);
  });
});
