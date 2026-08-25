import { vi } from 'vitest';
import { EquipementsPageComponent } from './equipements-page';

describe('EquipementsPageComponent', () => {
  it('saves an equipment attached to a site', () => {
    const component = new EquipementsPageComponent();
    component.newEquipment.site = 'Goma';
    component.newEquipment.code = 'GE-GOM-01';
    component.newEquipment.nom = 'Groupe electrogene 1';
    component.newEquipment.dateMiseEnService = '2026-08-18';
    component.newEquipment.famille = 'Energie';
    component.newEquipment.localisation = 'Local energie';
    component.newEquipment.marqueModele = 'Caterpillar C18';
    component.newEquipment.etat = 'En service';
    component.newEquipment.criticite = 'Critique';

    component.saveEquipment();

    expect(component.equipmentRows).toHaveLength(1);
    expect(component.equipmentRows[0].site).toBe('Goma');
    expect(component.equipmentRows[0].code).toBe('GE-GOM-01');
  });

  it('filters by site, family, criticality and state', () => {
    const component = new EquipementsPageComponent();
    component.equipmentRows = [
      { site: 'Bukavu', code: 'GE-1', nom: 'GE', dateMiseEnService: '2025-01-01', famille: 'Energie', localisation: 'L1', marqueModele: 'M1', etat: 'En service', criticite: 'Critique' },
      { site: 'Utex', code: 'CLIM-1', nom: 'Clim', dateMiseEnService: '2025-02-01', famille: 'Climatisation', localisation: 'L2', marqueModele: 'M2', etat: 'En maintenance', criticite: 'Moyenne' },
    ];

    component.selectedSite = 'Bukavu';
    expect(component.filteredRows).toHaveLength(1);
    component.selectedSite = '';
    component.selectedFamily = 'Climatisation';
    expect(component.filteredRows[0].site).toBe('Utex');
    component.selectedFamily = '';
    component.selectedCriticality = 'Critique';
    expect(component.filteredRows[0].code).toBe('GE-1');
    component.selectedCriticality = '';
    component.selectedState = 'En maintenance';
    expect(component.filteredRows[0].code).toBe('CLIM-1');
  });

  it('supports pagination, editing and equipment deletion', async () => {
    const component = new EquipementsPageComponent();
    component.equipmentRows = Array.from({ length: 21 }, (_, index) => ({
      site: 'Mtc', code: `EQ-${index}`, nom: 'Equipement', dateMiseEnService: '2025-01-01',
      famille: 'IT' as const, localisation: 'Salle IT', marqueModele: 'Modele',
      etat: 'En service' as const, criticite: 'Moyenne' as const,
    }));

    expect(component.pageCount).toBe(2);
    expect(component.visibleRows.filter(Boolean)).toHaveLength(20);
    component.nextPage();
    expect(component.currentPage).toBe(2);

    const row = component.equipmentRows[0];
    component.editEquipment(row);
    component.newEquipment.etat = 'En panne';
    component.saveEquipment();
    expect(component.equipmentRows[0].etat).toBe('En panne');

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await component.deleteEquipment(component.equipmentRows[0]);
    expect(component.equipmentRows).toHaveLength(20);
    confirmSpy.mockRestore();
  });
});