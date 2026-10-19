import { GmaoDataStore } from '../data/gmao-data-store';
import { ConsommationGroupesGePageComponent } from './consommation-groupes-ge-page';
import { EquipementsPageComponent } from './equipements-page';
import { FuelGePageComponent } from './fuel-ge-page';
import { GestionTicketsPageComponent } from './gestion-tickets-page';
import { InterventionsRealiseesPageComponent } from './interventions-realisees-page';
import { PiecesRechangePageComponent } from './pieces-rechange-page';
import { ProblemesDatacenterPageComponent } from './problemes-datacenter-page';
import { RavitaillementFuelPageComponent } from './ravitaillement-fuel-page';
import { SuiviGroupesElectrogenesPageComponent } from './suivi-groupes-electrogenes-page';

const canExport = { allowedSites: ['Pigeon'], currentSite: 'Pigeon', canModifyExisting: true, isChefSite: false, canEnterSiteData: false, canExportData: true };
const cannotExport = { ...canExport, canExportData: false };

type ExportConfig = { title: string; fileName: string; columns: Array<{ header: string }>; rows: unknown[] };
type PageWithPdf = { exportExcel(): void; exportPdf(): void; pdfExporter: unknown };

/** Une page par ligne : `build` crée la page avec le store et l'exporteur Excel donnés. */
const pages: Array<{ name: string; build: (store: GmaoDataStore, excel: unknown) => PageWithPdf; views?: (page: PageWithPdf) => void[] }> = [
  { name: 'Consommation par GE', build: (s, e) => new ConsommationGroupesGePageComponent(s, e as never) as unknown as PageWithPdf },
  { name: 'Équipements', build: (s, e) => new EquipementsPageComponent(s, e as never) as unknown as PageWithPdf },
  { name: 'Fuel-GE', build: (s, e) => new FuelGePageComponent(s, e as never) as unknown as PageWithPdf },
  { name: 'Interventions réalisées', build: (s, e) => new InterventionsRealiseesPageComponent(s, e as never) as unknown as PageWithPdf },
  { name: 'Pièces de rechange', build: (s, e) => new PiecesRechangePageComponent(s, e as never) as unknown as PageWithPdf },
  { name: 'Problèmes Data Center', build: (s, e) => new ProblemesDatacenterPageComponent(s, e as never) as unknown as PageWithPdf },
  { name: 'Ravitaillement Fuel', build: (s, e) => new RavitaillementFuelPageComponent(s, e as never) as unknown as PageWithPdf },
  { name: 'Suivi des groupes électrogènes', build: (s, e) => new SuiviGroupesElectrogenesPageComponent(s, e as never) as unknown as PageWithPdf },
  { name: 'Tickets (file)', build: (s, e) => new GestionTicketsPageComponent(s, e as never) as unknown as PageWithPdf },
  {
    name: 'Tickets (par site)',
    build: (s, e) => {
      const page = new GestionTicketsPageComponent(s, e as never);
      page.activeView = 'sites';
      return page as unknown as PageWithPdf;
    },
  },
];

describe('PDF export of every table page', () => {
  for (const { name, build } of pages) {
    it(`${name} : le PDF reçoit exactement le même tableau que l'Excel`, () => {
      const excel = { exportTable: vi.fn() };
      const pdf = { exportTable: vi.fn(), exportWorkbook: vi.fn() };
      const page = build(new GmaoDataStore(canExport as never), excel);
      page.pdfExporter = pdf;

      page.exportExcel();
      page.exportPdf();

      expect(excel.exportTable).toHaveBeenCalledTimes(1);
      expect(pdf.exportTable).toHaveBeenCalledTimes(1);
      const [excelConfig] = excel.exportTable.mock.calls[0] as [ExportConfig];
      const [pdfConfig] = pdf.exportTable.mock.calls[0] as [ExportConfig];
      expect(pdfConfig.title).toBe(excelConfig.title);
      expect(pdfConfig.fileName).toBe(excelConfig.fileName);
      expect(pdfConfig.columns.map((column) => column.header)).toEqual(excelConfig.columns.map((column) => column.header));
      expect(pdfConfig.rows).toEqual(excelConfig.rows);
    });

    it(`${name} : pas d'export PDF sans le droit d'exporter`, () => {
      const excel = { exportTable: vi.fn() };
      const pdf = { exportTable: vi.fn(), exportWorkbook: vi.fn() };
      const page = build(new GmaoDataStore(cannotExport as never), excel);
      page.pdfExporter = pdf;

      page.exportPdf();

      expect(pdf.exportTable).not.toHaveBeenCalled();
    });
  }
});
