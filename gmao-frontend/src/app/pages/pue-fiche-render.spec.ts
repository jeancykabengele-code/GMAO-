import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { GmaoDataStore } from '../data/gmao-data-store';
import { PuePageComponent } from './pue-page';
import { PueRow } from './pue-lines';

registerLocaleData(localeFr, 'fr');

const access = { allowedSites: ['Pigeon'], currentSite: 'Pigeon', canModifyExisting: true, isChefSite: false, canEnterSiteData: false, canExportData: true };
const line = (kwLus: number | null, a: number | null, v: number | null, kw: number, origine: string) => ({ kwLus, a, v, kw, origine });

const reading: PueRow = {
  id: 'r1', site: 'Pigeon', dateReleve: '2026-10-19', heureReleve: '15:30:00', scenario: 'S2', itKw: 80, totalKw: 104, pue: 1.3,
  mesures: {
    ups_a: line(30, null, null, 30, 'Lu'), ups_b: line(null, 28.9, 400, 19.03, 'Calculé'),
    redresseurs_a: line(15, null, null, 15, 'Lu'), redresseurs_b: line(15, null, null, 15, 'Lu'),
    clim_a: line(10, null, null, 10, 'Lu'), clim_b: line(10, null, null, 10, 'Lu'), tertiaire: line(4, null, null, 4, 'Lu'),
    avr_a: line(54, null, null, 54, 'Lu'), avr_b: line(51, null, null, 51, 'Lu'),
  },
};

describe('PUE page : onglet Détails rendu dans le DOM', () => {
  it('renders the fiche of the reading like the entry sheet', async () => {
    const store = new GmaoDataStore(access as never);
    store.pueRows = [reading];
    TestBed.configureTestingModule({ imports: [PuePageComponent], providers: [provideRouter([]), { provide: GmaoDataStore, useValue: store }] });
    const fixture = TestBed.createComponent(PuePageComponent);
    fixture.componentInstance.setView('details');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const root: HTMLElement = fixture.nativeElement;
    const text = (root.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('Relevé du 19/10/2026 à 15:30');
    expect(text).toContain('Scénario S2 — IT et hors IT mesurés, total déduit');
    expect(text).toContain('1 Mesures principales');
    expect(text).toContain('2 Résultat du jour');
    expect(text).toContain('3 Détails et contrôles');
    expect(text).toContain('Hors IT — climatisation et charges tertiaires');
    expect(text).toContain('Amont — sorties des AVR');

    // mêmes colonnes que la feuille de saisie, dans chaque tableau (principales + détails)
    const headers = [...root.querySelectorAll('.fiche-table')].map((table) => [...table.querySelectorAll('thead th')].map((cell) => cell.textContent?.trim()));
    expect(headers).toHaveLength(2);
    for (const row of headers) expect(row).toEqual(['Équipement', 'kW lus', 'A', 'V', 'cos φ', 'kW retenus', 'Origine', 'Écart']);

    const rows = [...root.querySelectorAll('.fiche-table tbody tr:not(.section-row)')];
    const upsB = rows.find((row) => row.querySelector('.line-label')?.textContent === 'UPS B')!;
    const cells = [...upsB.querySelectorAll('td')].map((cell) => cell.textContent?.trim());
    expect(cells).toEqual(['UPS B', '', '28,9', '400', '', '19,03', 'Calculé', '—']);

    // résultats : le total est marqué « déduit » en S2
    const cards = [...root.querySelectorAll('.result-card')].map((card) => (card.textContent ?? '').replace(/\s+/g, ' ').trim());
    expect(cards[0]).toContain('Total site déduit');
    expect(cards[0]).toContain('104');
    expect(cards[3]).toContain('1,300');
    expect(root.querySelectorAll('.checks li').length).toBeGreaterThan(0);
    // pas de pagination dans cet onglet
    expect(root.querySelector('.pagination')).toBeNull();
    // les champs sont en lecture seule : aucun champ de saisie dans la fiche
    expect(root.querySelectorAll('.fiche input')).toHaveLength(0);
  });
});
