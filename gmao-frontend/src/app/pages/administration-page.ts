import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-administration-page',
  standalone: true,
  imports: [RouterOutlet],
  template: `
    <section class="administration-shell">
      <router-outlet></router-outlet>
    </section>
  `,
  styles: `
    :host { display:block; min-height:100%; }
    .administration-shell { min-height:100%; }
  `,
})
export class AdministrationPageComponent {}
