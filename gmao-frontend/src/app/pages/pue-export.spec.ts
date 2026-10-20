import readXlsxFile from 'read-excel-file/browser';
import { GmaoDataStore } from '../data/gmao-data-store';
import { ExcelExportService } from '../shared/excel-export.service';
import { PdfExportService } from '../shared/pdf-export.service';
import { DocumentationsComponent } from './documentations';
import { PuePageComponent } from './pue-page';
import { FICHE_COLUMNS, PueRow } from './pue-lines';

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

    // la feuille « Détails » reproduit la fiche de saisie : mêmes colonnes, une fiche par relevé
    const details = book['Détails'];
    expect(details[3]).toEqual(FICHE_COLUMNS);
    expect(String(details[4][0])).toBe('Relevé du 19/10/2026 à 11:00 — Scénario S1 — TGBT et IT mesurés, hors IT déduit');
    const lineOf = (label: string) => details.find((entry) => entry[0] === label)!;
    expect(lineOf('AVR A')[5]).toBe(54);
    expect(lineOf('UPS A')[5]).toBe(30);
    expect(lineOf('PDF AC A1')[5]).toBe(14);
    expect(lineOf('Total site (kW)').slice(5, 7)).toEqual([100, 'mesuré']);
    expect(lineOf('Hors IT (kW)').slice(5, 7)).toEqual([20, 'déduit']);
    expect(lineOf('PUE du jour')[5]).toBe(1.25);
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

  it('the PUE page and the Documentations page download one PDF with a PUE section and a Details section', async () => {
    const pdfFiles: Array<{ name: string; blob: Blob }> = [];
    const pdfService = new PdfExportService();
    (pdfService as unknown as { download: (blob: Blob, name: string) => void }).download = (blob, name) => pdfFiles.push({ name, blob });

    const page = new PuePageComponent(storeWithReading(), new ExcelExportService());
    (page as unknown as { pdfExporter: PdfExportService }).pdfExporter = pdfService;
    page.exportPdf();

    const documentations = new DocumentationsComponent(storeWithReading(), new ExcelExportService());
    (documentations as unknown as { pdfExporter: PdfExportService }).pdfExporter = pdfService;
    documentations.exportReportPdf(documentations.reports.find((entry) => entry.fileName === 'suivi-pue')!);

    await vi.waitFor(() => expect(pdfFiles).toHaveLength(2));
    for (const file of pdfFiles) {
      expect(file.name).toBe('suivi-pue.pdf');
      expect(file.blob.type).toBe('application/pdf');
      const content = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(file.blob, 'latin1');
      });
      expect(content.startsWith('%PDF-')).toBe(true);
      expect(content).toContain('Suivi du PUE');
      expect(content).toContain('tails du PUE');
      expect(content).toContain('Hors IT');
      // toutes les pages sont en A4 portrait (595 x 842 pt)
      const boxes = [...content.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((match) => [Math.round(Number(match[1])), Math.round(Number(match[2]))]);
      expect(boxes.length).toBeGreaterThan(1);
      for (const box of boxes) expect(box).toEqual([595, 842]);
    }
  });
});
