import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from './components/sidebar';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent],
  template: \<div class="d-flex">
    <app-sidebar></app-sidebar>
    <main class="flex-grow-1 p-3">
      <router-outlet></router-outlet>
    </main>
  </div>\
})
export class AppComponent {}
