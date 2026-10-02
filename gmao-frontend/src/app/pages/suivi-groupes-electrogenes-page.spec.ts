import { vi } from 'vitest';
import { GmaoDataStore } from '../data/gmao-data-store';
import { SuiviGroupesElectrogenesPageComponent } from './suivi-groupes-electrogenes-page';

describe('SuiviGroupesElectrogenesPageComponent', () => {
  const row = () => ({
    id: 'ge-1', site: 'Goma', code: 'DC-GOM-GE-001', typeGe: 'LINZ 150 KVA',
    moisReleve: '2026-08', dateMiseEnService: null, dateDernierePm: null,
    rhActuel: 200, rhDernierePm: 100, rhDepuisDernierePm: 100,
    rhProchainePm: 350, retardSignale: false, etat: 'Normal' as const,
    commentaires: '',
  });

  const equipment = () => ({
    id: 'equipment-ge-1', site: 'Goma', code: 'DC-GOM-GE-001', nom: 'Groupe électrogène LINZ 150 KVA',
    famille: 'Energie', marqueModele: 'LINZ 150 KVA',
  });
  it("repart de zéro pour un groupe dont tous les relevés ont été supprimés", () => {
    const store = new GmaoDataStore();
    const component = new SuiviGroupesElectrogenesPageComponent(store);
    const generator = { ...row(), rhActuel: 200, rhDernierePm: 13055.59, commentaires: 'ancien commentaire' };
    component.generatorRows = [generator];
    component.equipmentRows = [equipment()] as never;
    component.openEntrySheet();
    const key = component.selectedGeneratorKey;
    expect(key).toBe('equipment-ge-1');

    // Le Manager a supprimé tous les relevés : la fiche reliquat ne doit rien préremplir.
    component.selectEquipment(key);
    expect(component.creatingGenerator).toBe(true);
    expect(component.newGenerator.rhActuel).toBe(0);
    expect(component.newGenerator.rhDernierePm).toBe(0);
    expect(component.newGenerator.commentaires).toBe('');

    // Un relevé reste : on repart de celui-ci.
    store.generatorReadingRows = [{ site: 'Goma', groupeCode: 'DC-GOM-GE-001', periode: '2026-07', rhActuel: 150 }];
    component.selectEquipment(key);
    expect(component.creatingGenerator).toBe(false);
    expect(component.newGenerator.rhActuel).toBe(150);
    expect(component.newGenerator.rhDernierePm).toBe(13055.59);
    expect(component.selectedGeneratorKey).toBe('equipment-ge-1');
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
    (component as any).dataStore.generatorReadingRows = component.generatorRows.map((generator: any, index: number) => ({
      id: `reading-${index}`, site: generator.site, groupeCode: generator.code, periode: '2026-08',
      rhActuel: generator.rhActuel, commentaires: '',
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

  it('sélectionne un groupe existant depuis les équipements sans créer de doublon', () => {
    const component = new SuiviGroupesElectrogenesPageComponent();
    component.generatorRows = [row()];
    component.equipmentRows = [equipment()];

    component.openEntrySheet();

    expect(component.sheetOpen).toBe(true);
    expect(component.selectingGenerator).toBe(true);
    expect(component.newGenerator.code).toBe('DC-GOM-GE-001');
    expect(component.generatorRows).toHaveLength(1);
  });

  it('enregistre le nouveau relevé RH mensuel', async () => {
    const component = new SuiviGroupesElectrogenesPageComponent();
    const existingRow = row();
    const createRecord = vi.spyOn((component as any).dataStore, 'createRecord').mockResolvedValue(undefined);
    const refreshResource = vi.spyOn((component as any).dataStore, 'refreshResource').mockResolvedValue(undefined);
    component.generatorRows = [existingRow];
    component.openSheet(existingRow);
    component.newGenerator.moisReleve = '2026-09';
    component.newGenerator.rhActuel = 330;

    await component.saveGenerator();

    expect(createRecord).toHaveBeenCalledWith('releves-rh-ge', expect.objectContaining({
      site: 'Goma', groupeCode: 'DC-GOM-GE-001', periode: '2026-09', rhActuel: 330,
    }));
    expect(refreshResource).toHaveBeenCalledWith('groupes-electrogenes');
    expect(component.sheetOpen).toBe(false);
  });

  it('prépare le premier groupe à partir d’un équipement GE', () => {
    const component = new SuiviGroupesElectrogenesPageComponent();
    component.generatorRows = [];
    component.equipmentRows = [equipment()];

    component.openEntrySheet();

    expect(component.sheetOpen).toBe(true);
    expect(component.creatingGenerator).toBe(true);
    expect(component.newGenerator.code).toBe('DC-GOM-GE-001');
    expect(component.newGenerator.typeGe).toBe('Groupe électrogène LINZ 150 KVA');
  });
});