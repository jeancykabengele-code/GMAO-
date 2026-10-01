import { GmaoDataStore } from '../data/gmao-data-store';
import { ConsommationGroupesGePageComponent } from './consommation-groupes-ge-page';

describe('ConsommationGroupesGePageComponent', () => {
  it('creates a consumption row', async () => {
    const dataStore = new GmaoDataStore();
    const component = new ConsommationGroupesGePageComponent(dataStore);
    component.entry = { site: 'Goma', periode: '2026-08', groupeCode: 'GE-01', consommationLitres: 120, commentaires: '' };

    await component.save();

    expect(component.rows).toHaveLength(1);
    expect(component.rows[0].groupeCode).toBe('GE-01');
  });

  it('edits an existing row through openEdit and save, without going through requestDeletion', async () => {
    const dataStore = new GmaoDataStore();
    dataStore.generatorFuelConsumptionRows = [
      { id: 'c1', site: 'Goma', periode: '2026-08', groupeCode: 'GE-01', consommationLitres: 120, heuresGe: 10, litresHeure: 12, commentaires: '' },
    ];
    const component = new ConsommationGroupesGePageComponent(dataStore);

    component.openEdit(component.rows[0]);
    expect(component.editingRow?.id).toBe('c1');
    expect(component.sheetTitle).toBe('Modifier la consommation');

    component.entry.consommationLitres = 150;
    await component.save();

    expect(component.rows).toHaveLength(1);
    expect(component.rows[0].consommationLitres).toBe(150);
  });

  it('deletes a row after confirmation', async () => {
    const dataStore = new GmaoDataStore();
    dataStore.generatorFuelConsumptionRows = [
      { id: 'c1', site: 'Goma', periode: '2026-08', groupeCode: 'GE-01', consommationLitres: 120, heuresGe: 10, litresHeure: 12, commentaires: '' },
    ];
    const component = new ConsommationGroupesGePageComponent(dataStore);

    component.openEdit(component.rows[0]);
    component.requestDeletion();
    expect(component.deleteConfirmationOpen).toBe(true);

    await component.deleteEntry();

    expect(component.rows).toHaveLength(0);
    expect(component.deleteConfirmationOpen).toBe(false);
  });
});
