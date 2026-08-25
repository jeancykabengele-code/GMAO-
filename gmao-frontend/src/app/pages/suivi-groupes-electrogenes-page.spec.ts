import { vi } from 'vitest';
import { SuiviGroupesElectrogenesPageComponent } from './suivi-groupes-electrogenes-page';

describe('SuiviGroupesElectrogenesPageComponent', () => {
  const row = () => ({
    id: 'ge-1', site: 'Goma', code: 'DC-GOM-GE-001', typeGe: 'LINZ 150 KVA',
    moisReleve: '2026-08', dateMiseEnService: null, dateDernierePm: null,
    rhActuel: 200, rhDernierePm: 100, rhDepuisDernierePm: 100,
    rhProchainePm: 350, retardSignale: false, etat: 'Normal' as const,
    commentaires: '',
  });

  it('calcule les RH depuis la PM et la prochaine PM', () => {
    const component = new SuiviGroupesElectrogenesPageComponent();
    component.openSheet(row());
    component.newGenerator.rhActuel = 300;
    component.newGenerator.rhDernierePm = 100;

    expect(component.previewRhDepuisPm).toBe(200);
    expect(component.previewProchainePm).toBe(350);
    expect(component.previewState).toBe('ASurveiller');
  });

  it('classe les seuils PM et tient compte du retard signalé', () => {
    const component = new SuiviGroupesElectrogenesPageComponent();
    component.openSheet(row());
    component.newGenerator.rhActuel = 274;
    expect(component.previewState).toBe('Normal');
    component.newGenerator.rhActuel = 275;
    expect(component.previewState).toBe('ASurveiller');
    component.newGenerator.rhActuel = 325;
    expect(component.previewState).toBe('PmUrgente');
    component.newGenerator.rhActuel = 350;
    expect(component.previewState).toBe('PmDepassee');
    component.newGenerator.rhActuel = 120;
    component.newGenerator.retardSignale = true;
    expect(component.previewState).toBe('ASurveiller');
  });

  it('filtre, masque le tableau et pagine par 20 lignes', () => {
    const component = new SuiviGroupesElectrogenesPageComponent();
    component.generatorRows = Array.from({ length: 21 }, (_, index) => ({
      ...row(), id: `ge-${index}`, code: `DC-GOM-GE-${String(index + 1).padStart(3, '0')}`,
      site: index === 20 ? 'Bukavu' : 'Goma',
    }));

    expect(component.visibleRows).toHaveLength(20);
    expect(component.pageCount).toBe(2);
    component.nextPage();
    expect(component.visibleRows).toHaveLength(1);
    component.selectedSite = 'Bukavu';
    component.resetPage();
    expect(component.filteredRows).toHaveLength(1);
    component.toggleTable();
    expect(component.tableVisible).toBe(false);
  });

  it('ouvre Renseigner sur un groupe existant sans créer de doublon', () => {
    const component = new SuiviGroupesElectrogenesPageComponent();
    component.generatorRows = [row()];

    component.openEntrySheet();

    expect(component.sheetOpen).toBe(true);
    expect(component.selectingGenerator).toBe(true);
    expect(component.newGenerator.code).toBe('DC-GOM-GE-001');
    expect(component.generatorRows).toHaveLength(1);
  });

  it('enregistre le nouveau compteur et ses valeurs PM recalculées', async () => {
    const component = new SuiviGroupesElectrogenesPageComponent();
    const existingRow = row();
    const updateRecord = vi.spyOn((component as any).dataStore, 'updateRecord').mockResolvedValue(undefined);
    component.generatorRows = [existingRow];
    component.openSheet(existingRow);
    component.newGenerator.rhActuel = 330;
    component.newGenerator.rhDernierePm = 100;

    await component.saveGenerator();

    expect(updateRecord).toHaveBeenCalledWith(
      'groupes-electrogenes',
      existingRow,
      expect.objectContaining({
        rhActuel: 330,
        rhDernierePm: 100,
        rhDepuisDernierePm: 230,
        rhProchainePm: 350,
        etat: 'PmUrgente',
      }),
    );
    expect(component.sheetOpen).toBe(false);
  });
});