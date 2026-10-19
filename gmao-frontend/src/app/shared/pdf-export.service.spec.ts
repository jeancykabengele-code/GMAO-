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

  it('puts every sheet of a workbook in the same document, wide tables on a larger page', async () => {
    const wide = Array.from({ length: 25 }, (_, index) => ({ header: `Col ${index}`, value: () => index }));
    const doc = await new PdfExportService().render([
      { title: 'PUE', sheetName: 'PUE', columns, rows: rows.slice(0, 3) },
      { title: 'Détails', sheetName: 'Détails', columns: wide, rows: [{}] },
    ]);
    const pdf = doc.output();
    expect(doc.getNumberOfPages()).toBe(2);
    expect(pdf).toContain('(PUE)');
    expect(pdf).toContain('(Détails)');
    expect(doc.internal.pageSize.getWidth()).toBeGreaterThan(400);
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
