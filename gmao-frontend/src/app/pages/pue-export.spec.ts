import readXlsxFile from 'read-excel-file/browser';
import { GmaoDataStore } from '../data/gmao-data-store';
import { ExcelExportService } from '../shared/excel-export.service';
import { DocumentationsComponent } from './documentations';
import { PuePageComponent } from './pue-page';
import { PueRow } from './pue-lines';

/** Export réel (vrai classeur, relu avec un lecteur XLSX) : seul le téléchargement est remplacé. */
function realExporter(): { service: ExcelExportService; files: Array<{ name: string; blob: Blob }> } {
  const service = new ExcelExportService();
  const files: Array<{ name: string; blob: Blob }> = [];
  (service as unknown as { download: (blob: Blob, name: string) => void }).download = (blob, name) => files.push({ name, blob });
  return { service, files };
}

const access = { allowedSites: ['Pigeon'], currentSite: 'Pigeon', canModifyExisting: true, isChefSite: false, canEnterSiteData: false, canExportData: true };

function storeWithReading(): GmaoDataStore {
  const store = new GmaoDataStore(access as never);
  const reading: PueRow = {
    id: 'r1', site: 'Pigeon', dateReleve: '2026-10-19', heureReleve: '11:00:00', scenario: 'S1',
    itKw: 80, totalKw: 100, pue: 1.25,
    mesures: { avr_a: { kw: 54 }, ups_a: { kw: 30 }, pdf_ac_a1: { kw: 14 } },
  };
  store.pueRows = [reading];
  return store;
}

async function readWorkbook(blob: Blob) {
  const sheets = await readXlsxFile(blob, { dateFormat: 'yyyy-mm-dd' });
  return Object.fromEntries(sheets.map((sheet) => [sheet.sheet, sheet.data]));
}

describe('PUE Excel export (real workbook)', () => {
  it('the PUE page downloads one file with a PUE sheet and a Details sheet', async () => {
    const { service, files } = realExporter();
    const component = new PuePageComponent(storeWithReading(), service);
    component.exportExcel();
    await vi.waitFor(() => expect(files).toHaveLength(1));

    expect(files[0].name).toBe('suivi-pue.xlsx');
    const book = await readWorkbook(files[0].blob);
    expect(Object.keys(book)).toEqual(['PUE', 'Détails']);

    expect(book['PUE'][3]).toEqual(['Date', 'Heure', 'Scénario', 'IT (kW)', 'Hors IT (kW)', 'Total site (kW)', 'PUE', 'État']);
    expect(book['PUE'][4].slice(1)).toEqual(['11:00', 'S1', 80, 20, 100, 1.25, '≤ 1,8']);

    const header = book['Détails'][3] as string[];
    expect(header.slice(0, 5)).toEqual(['Date', 'Heure', 'Scénario', 'AVR A (kW)', 'AVR B (kW)']);
    expect(header).toContain('PDF DC B4 (kW)');
    const detail = book['Détails'][4];
    expect(detail[header.indexOf('AVR A (kW)')]).toBe(54);
    expect(detail[header.indexOf('UPS A (kW)')]).toBe(30);
    expect(detail[header.indexOf('PDF AC A1 (kW)')]).toBe(14);
  });

  it('the Documentations page downloads the same two-sheet workbook for the PUE register', async () => {
    const { service, files } = realExporter();
    const component = new DocumentationsComponent(storeWithReading(), service);
    const report = component.reports.find((entry) => entry.fileName === 'suivi-pue')!;
    component.exportReport(report);
    await vi.waitFor(() => expect(files).toHaveLength(1));

    expect(files[0].name).toBe('suivi-pue.xlsx');
    expect(Object.keys(await readWorkbook(files[0].blob))).toEqual(['PUE', 'Détails']);
  });
});
