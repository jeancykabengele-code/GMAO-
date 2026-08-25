import { Component } from '@angular/core';

@Component({
  selector: 'app-accueil-page',
  standalone: true,
  template: `
    <section class="home-page" aria-label="Accueil GMAO ORDC">
      <div class="welcome-content">
        <h1>Bienvenue dans votre espace de travail.</h1>
        <span class="orange-line" aria-hidden="true"></span>
        <p>
          Pilotez un environnement fiable, structur&eacute; et pr&ecirc;t &agrave; accompagner
          les exigences d'une organisation &agrave; grande &eacute;chelle.
        </p>
      </div>
    </section>
  `,
  styles: `
    :host { display: block; height: 100%; overflow: hidden; }

    .home-page {
      position: relative;
      display: flex;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      align-items: center;
      padding: clamp(36px, 7vw, 110px);
      overflow: hidden;
      background-color: var(--anthracite);
      background-image: url('/images/home-dashboard-background.png');
      background-position: center center;
      background-size: cover;
      background-repeat: no-repeat;
      isolation: isolate;
    }

    .home-page::before {
      content: '';
      position: absolute;
      inset: 0;
      z-index: -1;
      background: linear-gradient(90deg, rgba(15, 15, 15, 0.88) 0%, rgba(25, 25, 25, 0.66) 38%, rgba(25, 25, 25, 0.08) 72%);
      animation: veil-reveal 1.1s ease-out both;
    }

    .welcome-content { width: min(600px, 49vw); color: #fff; }

    .eyebrow {
      display: inline-block;
      margin-bottom: 15px;
      color: var(--orange);
      font-size: 0.78rem;
      font-weight: 900;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      animation: rise-in 0.65s 0.12s cubic-bezier(0.22, 1, 0.36, 1) both;
    }

    h1 {
      max-width: 570px;
      margin: 0;
      font-size: clamp(1.9rem, 3.8vw, 3.9rem);
      line-height: 1.04;
      letter-spacing: -0.04em;
      text-wrap: balance;
      animation: rise-in 0.8s 0.24s cubic-bezier(0.22, 1, 0.36, 1) both;
    }

    .orange-line {
      display: block;
      width: 92px;
      height: 5px;
      margin: 23px 0 20px;
      border-radius: 999px;
      background: var(--orange);
      transform-origin: left;
      animation: line-grow 0.7s 0.62s cubic-bezier(0.22, 1, 0.36, 1) both;
    }

    p {
      max-width: 550px;
      margin: 0;
      color: rgba(255, 255, 255, 0.84);
      font-size: clamp(0.92rem, 1.2vw, 1.1rem);
      line-height: 1.6;
      animation: rise-in 0.75s 0.72s cubic-bezier(0.22, 1, 0.36, 1) both;
    }

    @keyframes veil-reveal { from { opacity: 1; } to { opacity: 0.92; } }
    @keyframes rise-in { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes line-grow { from { opacity: 0; transform: scaleX(0); } to { opacity: 1; transform: scaleX(1); } }

    @media (max-width: 780px) {
      .home-page { align-items: flex-end; padding: 34px 28px 64px; background-position: 64% center; }
      .home-page::before { background: linear-gradient(0deg, rgba(15, 15, 15, 0.94) 0%, rgba(20, 20, 20, 0.68) 55%, rgba(20, 20, 20, 0.18) 100%); }
      .welcome-content { width: 100%; }
    }

    @media (prefers-reduced-motion: reduce) {
      .home-page::before, .eyebrow, h1, .orange-line, p { animation: none; }
    }
  `,
})
export class AccueilPageComponent {}