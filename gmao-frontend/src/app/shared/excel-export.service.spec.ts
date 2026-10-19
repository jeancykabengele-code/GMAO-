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

  it('creates a workbook with several named sheets', async () => {
    const service = new ExcelExportService();
    let generatedBlob: Blob | undefined;
    let generatedFileName = '';
    (service as unknown as { download: (blob: Blob, fileName: string) => void }).download = (blob, fileName) => {
      generatedBlob = blob;
      generatedFileName = fileName;
    };

    await service.exportWorkbook('Suivi PUE', [
      { title: 'Suivi du PUE', sheetName: 'PUE', columns: [{ header: 'Date', value: (row: { d: string }) => row.d }], rows: [{ d: '2026-10-19' }] },
      { title: 'Détails du PUE', sheetName: 'Détails', columns: [{ header: 'AVR A (kW)', value: (row: { avr: number }) => row.avr }], rows: [{ avr: 54 }] },
    ]);

    expect(generatedFileName).toBe('suivi-pue.xlsx');
    const sheets = await readXlsxFile(generatedBlob!, { dateFormat: 'yyyy-mm-dd' });
    expect(sheets.map((sheet) => sheet.sheet)).toEqual(['PUE', 'Détails']);
    expect(sheets[0].data[0][0]).toBe('Suivi du PUE');
    expect(sheets[1].data[3][0]).toBe('AVR A (kW)');
    expect(sheets[1].data[4][0]).toBe(54);
  });

  it('attaches the download link before clicking and revokes the URL later', () => {
    const service = new ExcelExportService();
    const blob = new Blob(['xlsx']);
    const anchor = document.createElement('a');
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => undefined);
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:gmao-export');
    URL.revokeObjectURL = vi.fn();
    vi.useFakeTimers();

    (service as unknown as { download: (value: Blob, name: string) => void })
      .download(blob, 'registre.xlsx');

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.href).toContain('blob:gmao-export');
    expect(anchor.download).toBe('registre.xlsx');
    expect(click).toHaveBeenCalledOnce();
    expect(document.body.contains(anchor)).toBe(false);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:gmao-export');

    vi.useRealTimers();
    createElement.mockRestore();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });
});
