import { Injectable, Optional, signal } from '@angular/core';
import { AccessControlService } from '../auth/access-control.service';
import { GmaoApiService, GmaoResource, PersistedRow } from './gmao-api.service';
import { ORANGE_RDC_SITES } from './sites';

type SiteRow = Record<string, unknown> & { id?: string; site?: unknown };

@Injectable({ providedIn: 'root' })
export class GmaoDataStore {
  private readonly equipmentData = signal<unknown[]>([]);
  private readonly ticketData = signal<unknown[]>([]);
  private readonly generatorData = signal<unknown[]>([]);
  private readonly monthlyReadingData = signal<unknown[]>([]);
  private readonly fuelData = signal<unknown[]>([]);
  private readonly generatorFuelConsumptionData = signal<unknown[]>([]);
  private readonly fuelDeliveryData = signal<unknown[]>([]);
  private readonly fuelSummaryData = signal<unknown[]>([]);
  private readonly problemData = signal<unknown[]>([]);
  private readonly pueData = signal<unknown[]>([]);
  private readonly interventionData = signal<unknown[]>([]);
  private readonly sparePartData = signal<unknown[]>([]);
  private loadingStarted = false;

  constructor(
    @Optional() private readonly access: AccessControlService | null = null,
    @Optional() private readonly api: GmaoApiService | null = null,
  ) {
    if (this.api) void this.loadAll();
  }

  get allowedSites(): string[] { return this.access?.allowedSites ?? [...ORANGE_RDC_SITES]; }
  get canModifyExisting(): boolean { return this.access?.canModifyExisting ?? true; }
  get canEnterData(): boolean { return this.access?.canEnterSiteData ?? true; }
  get canExportData(): boolean { return this.access?.canExportData ?? true; }
  get canUpdateGenerators(): boolean { return this.canModifyExisting || (this.access?.isChefSite ?? false); }
  get isChefSite(): boolean { return this.access?.isChefSite ?? false; }

  get equipmentRows(): unknown[] { return this.read(this.equipmentData()); }
  set equipmentRows(value: unknown[]) { this.equipmentData.set(this.write(this.equipmentData(), value)); }
  get ticketRows(): unknown[] { return this.read(this.ticketData()); }
  set ticketRows(value: unknown[]) { this.ticketData.set(this.write(this.ticketData(), value)); }
  get generatorRows(): unknown[] { return this.read(this.generatorData()); }
  get generatorReadingRows(): unknown[] { return this.read(this.monthlyReadingData()); }
  set generatorReadingRows(value: unknown[]) { this.monthlyReadingData.set(value); }
  set generatorRows(value: unknown[]) { this.generatorData.set(this.write(this.generatorData(), value)); }
  get fuelRows(): unknown[] { return this.read(this.fuelData()); }
  get generatorFuelConsumptionRows(): unknown[] { return this.read(this.generatorFuelConsumptionData()); }
  set generatorFuelConsumptionRows(value: unknown[]) { this.generatorFuelConsumptionData.set(this.write(this.generatorFuelConsumptionData(), value)); }
  get fuelDeliveryRows(): unknown[] { return this.read(this.fuelDeliveryData()); }
  set fuelRows(value: unknown[]) { this.fuelData.set(this.write(this.fuelData(), value)); }
  get fuelSummaryRows(): unknown[] { return this.readGlobal(this.fuelSummaryData()); }
  set fuelSummaryRows(value: unknown[]) { this.fuelSummaryData.set(value); }
  get problemRows(): unknown[] { return this.read(this.problemData()); }
  set problemRows(value: unknown[]) { this.problemData.set(this.write(this.problemData(), value)); }
  get pueRows(): unknown[] { return this.read(this.pueData()); }
  set pueRows(value: unknown[]) { this.pueData.set(this.write(this.pueData(), value)); }
  get interventionRows(): unknown[] { return this.read(this.interventionData()); }
  set interventionRows(value: unknown[]) { this.interventionData.set(this.write(this.interventionData(), value)); }
  get sparePartRows(): unknown[] { return this.read(this.sparePartData()); }
  set sparePartRows(value: unknown[]) { this.sparePartData.set(this.write(this.sparePartData(), value)); }

  async loadAll(): Promise<void> {
    if (!this.api || this.loadingStarted) return;
    this.loadingStarted = true;
    const resources: GmaoResource[] = [
      'equipements', 'tickets', 'groupes-electrogenes', 'releves-rh-ge', 'fuel-ge', 'consommations-groupes-ge', 'fuel-ravitaillements', 'fuel-summary',
      'pue', 'problemes-datacenter', 'interventions', 'pieces-rechange',
    ];
    await Promise.all(resources.map(async (resource) => {
      try {
        this.setRaw(resource, await this.api!.list(resource));
      } catch {
        this.setRaw(resource, []);
      }
    }));
  }

  async refreshResource(resource: GmaoResource): Promise<void> {
    if (!this.api) return;
    this.setRaw(resource, await this.api.list(resource));
  }

  async createRecord(resource: GmaoResource, row: object): Promise<PersistedRow> {
    const prepared = this.forceCurrentSite(row);
    const saved = this.api ? await this.api.create(resource, prepared) : prepared;
    this.setRaw(resource, [saved, ...this.getRaw(resource)]);
    return saved;
  }

  async updateRecord(resource: GmaoResource, original: object, changes: object): Promise<PersistedRow> {
    const originalRow = original as PersistedRow;
    if (!this.canModifyExisting && !(resource === 'groupes-electrogenes' && this.canUpdateGenerators)) return originalRow;
    const prepared = this.forceCurrentSite(changes);
    const saved = this.api && originalRow.id
      ? await this.api.update(resource, originalRow.id, prepared)
      : { ...originalRow, ...prepared };
    const rows = this.getRaw(resource).map((row) => {
      const persisted = row as PersistedRow;
      return (originalRow.id && persisted.id === originalRow.id) || row === original ? saved : row;
    });
    this.setRaw(resource, rows);
    return saved;
  }

  async deleteRecord(resource: GmaoResource, original: object): Promise<void> {
    if (!this.canModifyExisting) return;
    const originalRow = original as PersistedRow;
    if (this.api && originalRow.id) await this.api.remove(resource, originalRow.id);
    const rows = this.getRaw(resource).filter((row) => {
      const persisted = row as PersistedRow;
      return originalRow.id ? persisted.id !== originalRow.id : row !== original;
    });
    this.setRaw(resource, rows);
  }

  private forceCurrentSite(row: object): PersistedRow {
    const currentSite = this.access?.currentSite;
    return currentSite ? { ...row, site: currentSite } : { ...row };
  }

  private getRaw(resource: GmaoResource): unknown[] {
    const map: Record<GmaoResource, unknown[]> = {
      equipements: this.equipmentData(),
      tickets: this.ticketData(),
      'groupes-electrogenes': this.generatorData(),
      'releves-rh-ge': this.monthlyReadingData(),
      'fuel-ge': this.fuelData(),
      'consommations-groupes-ge': this.generatorFuelConsumptionData(),
      'fuel-ravitaillements': this.fuelDeliveryData(),
      'fuel-summary': this.fuelSummaryData(),
      pue: this.pueData(),
      'problemes-datacenter': this.problemData(),
      interventions: this.interventionData(),
      'pieces-rechange': this.sparePartData(),
    };
    return map[resource];
  }

  private setRaw(resource: GmaoResource, rows: unknown[]): void {
    if (resource === 'equipements') this.equipmentData.set(rows);
    else if (resource === 'tickets') this.ticketData.set(rows);
    else if (resource === 'groupes-electrogenes') this.generatorData.set(rows);
    else if (resource === 'releves-rh-ge') this.monthlyReadingData.set(rows);
    else if (resource === 'fuel-ge') this.fuelData.set(rows);
    else if (resource === 'consommations-groupes-ge') this.generatorFuelConsumptionData.set(rows);
    else if (resource === 'fuel-ravitaillements') this.fuelDeliveryData.set(rows);
    else if (resource === 'fuel-summary') this.fuelSummaryData.set(rows);
    else if (resource === 'pue') this.pueData.set(rows);
    else if (resource === 'problemes-datacenter') this.problemData.set(rows);
    else if (resource === 'interventions') this.interventionData.set(rows);
    else this.sparePartData.set(rows);
  }

  private readGlobal(rows: unknown[]): unknown[] {
    return rows.map((row) => ({ ...(row as SiteRow) }));
  }

  private read(rows: unknown[]): unknown[] {
    const site = this.access?.currentSite;
    if (!site) return rows;
    return rows
      .filter((row) => this.rowSite(row) === site)
      .map((row) => ({ ...(row as SiteRow) }));
  }

  private write(current: unknown[], next: unknown[]): unknown[] {
    const site = this.access?.currentSite;
    if (!site) return next.length < current.length ? current : next;
    const currentForSite = current.filter((row) => this.rowSite(row) === site);
    const addedCount = next.length - currentForSite.length;
    if (addedCount <= 0) return current;
    const additions = next.slice(0, addedCount).map((row) => ({ ...(row as SiteRow), site }));
    return [...additions, ...current];
  }

  private rowSite(row: unknown): string {
    return String((row as SiteRow)?.site ?? '');
  }
}