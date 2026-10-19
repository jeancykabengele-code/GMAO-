import { PdfExportService } from './pdf-export.service';

const rows = Array.from({ length: 60 }, (_, index) => ({
  site: 'Pigeon', date: '2026-10-19', kw: 1234.5 + index, actif: index % 2 === 0, etat: index % 2 ? '≤ 1,8' : '> 1,8',
}));
const columns = [
  { header: 'Site', value: (row: (typeof rows)[number]) => row.site },
  { header: 'Date', value: (row: (typeof rows)[number]) => row.date },
  { header: 'Puissance (kW)', value: (row: (typeof rows)[number]) => row.kw },
  { header: 'Actif', value: (row: (typeof rows)[number]) => row.actif },
  { header: 'État', value: (row: (typeof rows)[number]) => row.etat },
];

describe('PdfExportService', () => {
  it('renders a paginated table with a title, a numbered footer and formatted values', async () => {
    const doc = await new PdfExportService().render([{ title: 'Suivi du PUE - Pigeon', columns, rows }]);
    const pdf = doc.output();

    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    expect(pdf).toContain('Suivi du PUE - Pigeon');
    expect(pdf).toContain('Page 1 / ' + doc.getNumberOfPages());
    // date au format français, booléens en toutes lettres, symboles absents des polices standard remplacés
    expect(pdf).toContain('19/10/2026');
    expect(pdf).toContain('Oui');
    expect(pdf).toContain('<= 1,8');
    expect(pdf).not.toContain('≤');
    // en-tête répété sur chaque page
    expect((pdf.match(/Puissance/g) ?? []).length).toBe(doc.getNumberOfPages());
  });

  it('uses A4 only: portrait for a narrow table, landscape for a wider one', async () => {
    const wide = Array.from({ length: 9 }, (_, index) => ({ header: `Col ${index}`, value: () => index }));
    const service = new PdfExportService();
    const narrow = await service.render([{ title: 'Étroit', columns, rows: rows.slice(0, 3) }]);
    const large = await service.render([{ title: 'Large', columns: wide, rows: [{}] }]);
    expect([narrow.internal.pageSize.getWidth(), narrow.internal.pageSize.getHeight()].map(Math.round)).toEqual([210, 297]);
    expect([large.internal.pageSize.getWidth(), large.internal.pageSize.getHeight()].map(Math.round)).toEqual([297, 210]);
  });

  it('puts every sheet of a workbook in the same document, each with its own orientation', async () => {
    const wide = Array.from({ length: 9 }, (_, index) => ({ header: `Col ${index}`, value: () => index }));
    const doc = await new PdfExportService().render([
      { title: 'PUE', sheetName: 'PUE', columns, rows: rows.slice(0, 3) },
      { title: 'Détails', sheetName: 'Détails', columns: wide, rows: [{}] },
    ]);
    const pdf = doc.output();
    expect(doc.getNumberOfPages()).toBe(2);
    expect(pdf).toContain('(PUE)');
    expect(pdf).toContain('(D\u00e9tails)');
    expect(doc.getPageInfo(1).pageContext.mediaBox.topRightX).toBeLessThan(doc.getPageInfo(2).pageContext.mediaBox.topRightX);
  });

  it('continues a table that is too wide on the next pages and repeats its first columns', async () => {
    const veryWide = Array.from({ length: 30 }, (_, index) => ({ header: `Colonne numéro ${index}`, value: () => 1000 + index }));
    const doc = await new PdfExportService().render([{ title: 'Très large', columns: veryWide, rows: [{}], pdfRepeatColumns: 2 }]);
    const pdf = doc.output();
    expect(doc.getNumberOfPages()).toBeGreaterThan(2);
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(297, 0);
    // les deux premières colonnes réapparaissent sur chaque page
    expect((pdf.match(/Colonne num.ro 0/g) ?? []).length).toBe(doc.getNumberOfPages());
    expect((pdf.match(/Colonne num.ro 1\)/g) ?? []).length).toBe(doc.getNumberOfPages());
  });

  it('says so when there is nothing to export', async () => {
    const doc = await new PdfExportService().render([{ title: 'Vide', columns, rows: [] }]);
    expect(doc.output()).toContain('Aucune donn');
  });

  it('downloads a .pdf file named after the export', async () => {
    const service = new PdfExportService();
    const downloads: Array<{ blob: Blob; name: string }> = [];
    (service as unknown as { download: (blob: Blob, name: string) => void }).download = (blob, name) => downloads.push({ blob, name });
    await service.exportTable({ title: 'Registre équipements', fileName: 'Registre équipements', columns, rows: rows.slice(0, 2) });
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('registre-equipements.pdf');
    expect(downloads[0].blob.type).toBe('application/pdf');
    expect(downloads[0].blob.size).toBeGreaterThan(1000);
  });
});
