import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GmaoDataStore } from '../data/gmao-data-store';


interface PieItem { label: string; value: number; color: string; }
interface ChartPoint { x: number; y: number; value: number; label: string; }
interface FuelBarGroup {
  label: string;
  center: number;
  stock: { x: number; y: number; height: number; value: number; available: boolean };
  consumption: { x: number; y: number; height: number; value: number };
}
interface EquipmentData { site: string; etat: string; dateMiseEnService: string; }
interface TicketData { site: string; nature: string; date: string; }
interface GeneratorData { site: string; code?: string; etat: string; moisReleve: string; }
interface ProblemData { site: string; statut: string; date: string; }
interface FuelData { site: string; periode: string; sortie: number; stockFinal: number | null; disponibiliteGrid: number; }
interface FuelSummaryData { periode: string; stockFinal: number; sortie: number; }
interface PueData { site: string; dateReleve: string; itKw: number; totalKw: number; pue: number; }

@Component({
  selector: 'app-tableau-de-bord-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './tableau-de-bord-page.html',
  styleUrls: ['./tableau-de-bord-page.scss'],
})
export class TableauDeBordPageComponent {
  get sites(): string[] { return this.dataStore.allowedSites; }
  selectedSite = '';
  dateFrom = '';
  dateTo = '';

  constructor(private readonly dataStore: GmaoDataStore = new GmaoDataStore()) {}

  get filteredEquipmentRows(): EquipmentData[] {
    return (this.dataStore.equipmentRows as EquipmentData[]).filter((row) =>
      this.matchesSite(row.site),
    );
  }

  get filteredTicketRows(): TicketData[] {
    return (this.dataStore.ticketRows as TicketData[]).filter((row) =>
      this.matchesSite(row.site) && this.matchesDate(row.date),
    );
  }

  get filteredGeneratorRows(): GeneratorData[] {
    // Un groupe sans aucun relevé RH (relevés supprimés) n'est plus suivi : il ne compte pas.
    const readings = this.dataStore.generatorReadingRows as Array<{ site?: string; groupeCode?: string }>;
    return (this.dataStore.generatorRows as GeneratorData[]).filter((row) =>
      readings.some((reading) => reading.site === row.site && reading.groupeCode === row.code)
      && this.matchesSite(row.site) && this.matchesPeriod(row.moisReleve),
    );
  }

  get filteredProblemRows(): ProblemData[] {
    return (this.dataStore.problemRows as ProblemData[]).filter((row) =>
      this.matchesSite(row.site) && this.matchesDate(row.date),
    );
  }

  get filteredFuelRows(): FuelData[] {
    return (this.dataStore.fuelRows as FuelData[]).filter((row) =>
      this.matchesSite(row.site) && this.matchesPeriod(row.periode),
    );
  }

  get filteredPueRows(): PueData[] {
    return (this.dataStore.pueRows as PueData[]).filter((row) =>
      this.matchesSite(row.site) && this.matchesPeriod(row.dateReleve.slice(0, 7)),
    );
  }

  resetFilters(): void {
    this.selectedSite = '';
    this.dateFrom = '';
    this.dateTo = '';
  }

  get equipmentItems(): PieItem[] {
    const rows = this.filteredEquipmentRows;
    return [
      this.pieItem('En service', rows.filter((row) => row.etat === 'En service').length, '#16a34a'),
      this.pieItem('En panne', rows.filter((row) => row.etat === 'En panne').length, '#dc2626'),
      this.pieItem('En maintenance', rows.filter((row) => row.etat === 'En maintenance').length, '#ff7900'),
      this.pieItem('Hors service', rows.filter((row) => row.etat === 'Hors service').length, '#4b4b4b'),
    ];
  }

  get ticketItems(): PieItem[] {
    const rows = this.filteredTicketRows;
    return [
      this.pieItem('PM', rows.filter((row) => row.nature === 'PM').length, '#ff7900'),
      this.pieItem('Visit', rows.filter((row) => row.nature === 'Visit').length, '#4b4b4b'),
      this.pieItem('WO', rows.filter((row) => row.nature === 'WO').length, '#000000'),
      this.pieItem('Curative', rows.filter((row) => row.nature === 'Curative').length, '#087a46'),
      this.pieItem('Incident', rows.filter((row) => row.nature === 'Incident').length, '#c91400'),
    ];
  }

  get generatorItems(): PieItem[] {
    const rows = this.filteredGeneratorRows;
    return [
      this.pieItem('Normal', rows.filter((row) => row.etat === 'Normal').length, '#16a34a'),
      this.pieItem('Urgente', rows.filter((row) => row.etat === 'PmUrgente').length, '#eab308'),
      this.pieItem('Dépassé', rows.filter((row) => row.etat === 'PmDepassee').length, '#dc2626'),
      this.pieItem('À venir', rows.filter((row) => row.etat === 'ASurveiller').length, '#767676'),
    ];
  }

  get problemItems(): PieItem[] {
    const rows = this.filteredProblemRows;
    return [
      this.pieItem('Open', rows.filter((row) => row.statut === 'Open').length, '#ff7900'),
      this.pieItem('Ongoing', rows.filter((row) => row.statut === 'Ongoing').length, '#767676'),
      this.pieItem('Closed', rows.filter((row) => row.statut === 'Closed').length, '#16a34a'),
    ];
  }

  get gridPeriods(): string[] {
    return [...new Set(this.filteredFuelRows.map((row) => row.periode).filter(Boolean))].sort();
  }

  get fuelSummaryRows(): FuelSummaryData[] {
    return (this.dataStore.fuelSummaryRows as FuelSummaryData[]).filter((row) => this.matchesPeriod(row.periode));
  }

  get showConsolidatedFuelStock(): boolean {
    return !this.selectedSite && this.fuelSummaryRows.length > 0;
  }

  get fuelPeriods(): string[] {
    const periods = this.showConsolidatedFuelStock
      ? this.fuelSummaryRows.map((row) => row.periode)
      : this.filteredFuelRows.map((row) => row.periode);
    return [...new Set(periods.filter(Boolean))].sort();
  }

  get monthsGrid(): string[] { return this.gridPeriods.map((period) => this.formatMonth(period)); }
  get fuelMonths(): string[] { return this.fuelPeriods.map((period) => this.formatMonth(period)); }
  get gridValues(): number[] {
    return this.gridPeriods.map((period) => {
      const rows = this.filteredFuelRows.filter((row) => row.periode === period);
      return rows.length ? rows.reduce((sum, row) => sum + Number(row.disponibiliteGrid || 0), 0) / rows.length : 0;
    });
  }
  private hasSiteStockForPeriod(period: string): boolean {
    return this.filteredFuelRows.some((row) =>
      row.periode === period && row.stockFinal !== null && row.stockFinal !== undefined,
    );
  }
  get usesConsolidatedStockFallback(): boolean {
    return Boolean(this.selectedSite) && this.fuelPeriods.some((period) =>
      !this.hasSiteStockForPeriod(period)
      && this.fuelSummaryRows.some((row) => row.periode === period && row.stockFinal !== null && row.stockFinal !== undefined),
    );
  }
  get fuelStockLegend(): string {
    return this.usesConsolidatedStockFallback ? 'Stock final consolidé' : 'Stock final du site';
  }
  get fuelStockAvailable(): boolean[] {
    return this.fuelPeriods.map((period) => this.showConsolidatedFuelStock
      || this.hasSiteStockForPeriod(period)
      || this.fuelSummaryRows.some((row) => row.periode === period && row.stockFinal !== null && row.stockFinal !== undefined),
    );
  }
  get showFuelStockBars(): boolean { return this.fuelStockAvailable.some(Boolean); }
  get fuelStock(): number[] {
    return this.fuelPeriods.map((period) => {
      if (this.showConsolidatedFuelStock) {
        return Number(this.fuelSummaryRows.find((row) => row.periode === period)?.stockFinal || 0);
      }
      const siteRows = this.filteredFuelRows.filter((row) =>
        row.periode === period && row.stockFinal !== null && row.stockFinal !== undefined,
      );
      if (siteRows.length) {
        return siteRows.reduce((total, row) => total + Number(row.stockFinal || 0), 0);
      }
      return Number(this.fuelSummaryRows.find((row) => row.periode === period)?.stockFinal || 0);
    });
  }
  get fuelConsumption(): number[] {
    return this.fuelPeriods.map((period) => {
      if (this.showConsolidatedFuelStock) {
        return Number(this.fuelSummaryRows.find((row) => row.periode === period)?.sortie || 0);
      }
      return this.filteredFuelRows
        .filter((row) => row.periode === period)
        .reduce((total, row) => total + Number(row.sortie || 0), 0);
    });
  }

  get puePeriods(): string[] {
    const rows = this.filteredPueRows;
    return [...new Set(rows.map((row) => row.dateReleve?.slice(0, 7)).filter(Boolean))].sort();
  }
  get pueMonths(): string[] { return this.puePeriods.map((period) => this.formatMonth(period)); }
  get pueValues(): number[] {
    return this.puePeriods.map((period) => {
      // PUE du mois = somme des kW totaux ÷ somme des kW IT des relevés journaliers (jamais la moyenne des PUE du jour).
      const rows = this.filteredPueRows.filter((row) => row.dateReleve.slice(0, 7) === period);
      const it = rows.reduce((sum, row) => sum + Number(row.itKw || 0), 0);
      return it > 0 ? rows.reduce((sum, row) => sum + Number(row.totalKw || 0), 0) / it : 0;
    });
  }

  get equipmentTotal(): number { return this.filteredEquipmentRows.length; }
  get ticketTotal(): number { return this.filteredTicketRows.length; }
  get generatorTotal(): number { return this.filteredGeneratorRows.length; }
  get problemTotal(): number { return this.filteredProblemRows.length; }
  get latestGridAvailability(): number { return this.gridValues.at(-1) ?? 0; }
  get latestFuelStock(): number { return this.fuelStock.at(-1) ?? 0; }
  get latestFuelConsumption(): number { return this.fuelConsumption.at(-1) ?? 0; }
  get fuelHeadlineValue(): number { return this.showFuelStockBars ? this.latestFuelStock : this.latestFuelConsumption; }
  get fuelContextLabel(): string {
    return this.showConsolidatedFuelStock
      ? 'Données consolidées du journal Fuel-GE'
      : `Données mensuelles Fuel${this.selectedSite ? ` — ${this.selectedSite}` : ' des sites autorisés'}`;
  }
  get latestPue(): number { return this.pueValues.at(-1) ?? 0; }
  get gridAxisMinimum(): number { return 0; }
  get gridAxisMaximum(): number { return 100; }
  get gridAxisMiddle(): number { return 50; }

  get fuelBarAxisMaximum(): number {
    const maximum = Math.max(0, ...this.fuelStock, ...this.fuelConsumption);
    return maximum ? Math.ceil(maximum / 10_000) * 10_000 : 10_000;
  }
  get fuelBarAxisMiddle(): number { return this.fuelBarAxisMaximum / 2; }
  get fuelBarGroups(): FuelBarGroup[] {
    const count = Math.min(this.fuelMonths.length, this.fuelStock.length, this.fuelConsumption.length);
    if (!count) return [];
    const left = 78, width = 554, baseline = 212;
    const slot = width / count;
    const barWidth = Math.min(30, slot * 0.3);
    const gap = Math.min(10, slot * 0.1);
    return Array.from({ length: count }, (_, index) => {
      const center = left + slot * (index + 0.5);
      const stockValue = this.fuelStock[index] ?? 0;
      const consumptionValue = this.fuelConsumption[index] ?? 0;
      const stockY = this.chartY(stockValue, 0, this.fuelBarAxisMaximum);
      const consumptionY = this.chartY(consumptionValue, 0, this.fuelBarAxisMaximum);
      return {
        label: this.fuelMonths[index] ?? '',
        center,
        stock: { x: center - gap / 2 - barWidth, y: stockY, height: baseline - stockY, value: stockValue, available: this.fuelStockAvailable[index] ?? false },
        consumption: { x: center + gap / 2, y: consumptionY, height: baseline - consumptionY, value: consumptionValue },
      };
    });
  }

  get pueAxisMinimum(): number { return 0; }
  get pueAxisMaximum(): number { return 3; }
  get pueAxisMiddle(): number { return 1.5; }
  get pueReferenceY(): number { return this.chartY(1.8, this.pueAxisMinimum, this.pueAxisMaximum); }

  pieBackground(items: PieItem[]): string {
    const total = this.sum(items);
    if (!total) return '#d4d4d8';
    let current = 0;
    const stops = items.filter((item) => item.value > 0).map((item) => {
      const start = current;
      current += (item.value / total) * 100;
      return `${item.color} ${start}% ${current}%`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  }

  percentage(item: PieItem, items: PieItem[]): string {
    const total = this.sum(items);
    return total ? `${((item.value / total) * 100).toFixed(1).replace('.', ',')}%` : '0%';
  }

  chartPoints(values: number[], labels: string[], minimum: number, maximum: number): ChartPoint[] {
    if (!values.length || maximum <= minimum) return [];
    const width = 554, left = 78, top = 24, height = 188;
    const step = values.length > 1 ? width / (values.length - 1) : 0;
    return values.map((value, index) => ({
      x: left + index * step,
      y: top + height - ((value - minimum) / (maximum - minimum)) * height,
      value,
      label: labels[index] ?? '',
    }));
  }

  pointsAttribute(values: number[], labels: string[], minimum: number, maximum: number): string {
    return this.chartPoints(values, labels, minimum, maximum).map((point) => `${point.x},${point.y}`).join(' ');
  }

  areaAttribute(values: number[], labels: string[], minimum: number, maximum: number): string {
    const points = this.chartPoints(values, labels, minimum, maximum);
    if (!points.length) return '';
    return `78,212 ${points.map((point) => `${point.x},${point.y}`).join(' ')} ${points.at(-1)?.x ?? 78},212`;
  }

  chartY(value: number, minimum: number, maximum: number): number {
    if (maximum <= minimum) return 212;
    return 24 + 188 - ((value - minimum) / (maximum - minimum)) * 188;
  }

  formatAxis(value: number, maximumFractionDigits = 0): string {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value);
  }
  formatNumber(value: number | undefined): string {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value ?? 0);
  }
  formatDecimal(value: number): string { return value.toFixed(2).replace('.', ','); }
  formatCompactLiters(value: number): string {
    return `${new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(value)} L`;
  }

  private dynamicBounds(values: number[], step: number, minimumPadding: number, included: number[] = []): { minimum: number; maximum: number } {
    const usable = [...values, ...included].filter((value) => Number.isFinite(value));
    if (!usable.length) return { minimum: 0, maximum: step };
    const lowest = Math.min(...usable);
    const highest = Math.max(...usable);
    const padding = Math.max(minimumPadding, (highest - lowest) * 0.15);
    let minimum = Math.floor((lowest - padding) / step) * step;
    let maximum = Math.ceil((highest + padding) / step) * step;
    if (maximum <= minimum) maximum = minimum + step;
    return { minimum, maximum };
  }
  private matchesSite(site: string): boolean {
    return !this.selectedSite || site === this.selectedSite;
  }

  private matchesDate(value: string): boolean {
    if (!value) return !this.dateFrom && !this.dateTo;
    return (!this.dateFrom || value >= this.dateFrom) && (!this.dateTo || value <= this.dateTo);
  }

  private matchesPeriod(period: string): boolean {
    if (!period) return !this.dateFrom && !this.dateTo;
    const periodStart = `${period}-01`;
    const [year, month] = period.split('-').map(Number);
    const periodEnd = year && month
      ? `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`
      : periodStart;
    return (!this.dateFrom || periodEnd >= this.dateFrom) && (!this.dateTo || periodStart <= this.dateTo);
  }
  private formatMonth(period: string): string {
    const [year, month] = period.split('-').map(Number);
    if (!year || !month) return period;
    return new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit' })
      .format(new Date(year, month - 1, 1)).replace('.', '');
  }
  private pieItem(label: string, value: number, color: string): PieItem { return { label, value, color }; }
  private sum(items: PieItem[]): number { return items.reduce((total, item) => total + item.value, 0); }
}