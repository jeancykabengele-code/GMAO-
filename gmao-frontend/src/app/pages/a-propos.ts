import { Component } from '@angular/core';

@Component({
  selector: 'app-a-propos',
  standalone: true,
  template: `
    <section class="about-page">
      <p>
        La plateforme GMAO ORDC centralise le suivi des équipements, des interventions, des tickets,
        des pièces de rechange et des indicateurs techniques des différents sites. Elle permet aux
        équipes de disposer d’informations fiables et à jour, de mieux planifier les opérations de
        maintenance, d’améliorer la traçabilité des actions et de faciliter la prise de décision afin
        de renforcer la disponibilité et la performance des infrastructures.
      </p>
    </section>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 32px;
      box-sizing: border-box;
    }

    .about-page {
      width: 100%;
      max-width: 900px;
      padding: 32px;
      border-radius: 16px;
      background: rgba(244, 244, 245, 0.96);
      box-shadow: 0 18px 46px rgba(20, 20, 20, 0.18);
    }

    p {
      margin: 0;
      color: #3f444c;
      font-size: 1rem;
      font-style: italic;
      line-height: 1.75;
    }

    @media (max-width: 640px) {
      :host {
        padding: 20px;
      }

      .about-page {
        padding: 24px;
      }
    }
  `,
})
export class AProposComponent {}