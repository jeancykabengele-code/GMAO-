import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-ravitaillement-fuel-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ravitaillement-fuel-page.html',
  styleUrls: ['./ravitaillement-fuel-page.scss'],
})
export class RavitaillementFuelPageComponent {
  formOpen = false;
  entry = {
    date: '', site: '', fournisseur: '', bonLivraison: '', carburant: 'Diesel',
    quantite: null as number | null, stockAvant: null as number | null,
    stockApres: null as number | null, citerne: '', receptionnePar: '', commentaires: '',
  };

  openForm(): void { this.formOpen = true; }
  closeForm(): void { this.formOpen = false; }
}