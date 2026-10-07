import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ChangeHistoryRecord, GmaoApiService } from '../data/gmao-api.service';
import { ChangeHistoryPageComponent } from './change-history-page';

const entry = (overrides: Partial<ChangeHistoryRecord> = {}): ChangeHistoryRecord => ({
  id: 1, createdAt: '2026-10-07T10:00:00Z', actorEmail: 'chef@example.com', kind: 'update', resource: 'releves-rh-ge',
  site: 'Goma', reference: 'GE-01 · 2026-01', changes: [{ field: 'rhActuel', old: 100, new: 120.5 }], ...overrides,
});

async function createPage(listChangeHistory = vi.fn().mockResolvedValue({ items: [entry()], total: 1, limit: 50, offset: 0 })) {
  TestBed.configureTestingModule({
    providers: [{ provide: GmaoApiService, useValue: { listChangeHistory, errorMessage: (_: unknown, fallback: string) => fallback } }],
  });
  const fixture = TestBed.createComponent(ChangeHistoryPageComponent);
  await fixture.whenStable();
  return { component: fixture.componentInstance, listChangeHistory };
}

describe('ChangeHistoryPageComponent', () => {
  it('loads the first page and describes a correction with the old and new values', async () => {
    const { component, listChangeHistory } = await createPage();

    expect(listChangeHistory).toHaveBeenCalledWith({ resource: '', site: '', group: '', from: '', to: '', limit: 50, offset: 0 });
    expect(component.entries).toHaveLength(1);
    expect(component.changeLabel(component.entries[0], component.entries[0].changes[0])).toBe('RH actuel : 100 → 120,5');
    expect(component.resourceLabel('releves-rh-ge')).toBe('Relevés RH');
    expect(component.kindLabel('update')).toBe('Modification');
  });

  it('shows only the stored value for creations and deletions and humanises unknown fields', async () => {
    const { component } = await createPage();
    const created = entry({ kind: 'create', changes: [{ field: 'nom', old: null, new: 'Onduleur A' }] });
    const deleted = entry({ kind: 'delete', changes: [{ field: 'retardSignale', old: true, new: null }] });

    expect(component.changeLabel(created, created.changes[0])).toBe('Nom : Onduleur A');
    expect(component.changeLabel(deleted, deleted.changes[0])).toBe('Retard signalé : Oui');
    expect(component.fieldLabel('champInconnu')).toBe('Champ inconnu');
    expect(component.value('')).toBe('—');
    expect(component.value('1250.50')).toBe((1250.5).toLocaleString('fr-FR'));
  });

  it('applies the filters from the first page and reports an API failure', async () => {
    const { component, listChangeHistory } = await createPage();
    component.offset = 50;
    component.filters.resource = 'tickets';

    component.applyFilters();
    await vi.waitFor(() => expect(listChangeHistory).toHaveBeenLastCalledWith(expect.objectContaining({ resource: 'tickets', offset: 0 })));

    listChangeHistory.mockRejectedValueOnce(new Error('boom'));
    await component.load();
    expect(component.error).toBe('Impossible de charger l’historique des modifications.');

    component.resetFilters();
    expect(component.filters.resource).toBe('');
  });
});
