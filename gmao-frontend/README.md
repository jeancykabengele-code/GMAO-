# Frontend GMAO ORDC

Interface Angular 22 de la plateforme DC SiteOps Reporting.

## Charte Orange

- Helvetica Neue 55, 65 et 75, chargées depuis `public/assets/orange/fonts/`.
- Master Logo officiel responsive dans `public/assets/orange/logo/`.
- Icônes Solaris locales dans `public/assets/orange/icons/` ; `bootstrap-icons` n’est pas utilisé.
- Orange `#FF7900` comme couleur d’action et de série principale des graphiques.
- Noir, blanc et gris numérique pour les surfaces et les informations neutres.
- Vert, Orange et rouge limités aux états métier utiles : validation, attention et criticité.

## Démarrer localement

```powershell
npm install
npm start
```

L’application est disponible sur [http://localhost:4200](http://localhost:4200).

## Vérifier

```powershell
npm test -- --watch=false --reporters verbose --progress=false
npm run build
```

Bilan vérifié le 22 septembre 2026 : **49 tests réussis dans 14 suites** et compilation de production réussie.

## Déploiement

La branche `main` déclenche le déploiement Vercel. La production est disponible sur [gmao-ordc.vercel.app](https://gmao-ordc.vercel.app).

Avant de publier, vérifier au minimum les écrans publics et les écrans métier desktop/mobile, les boutons, les formulaires, les alertes, les fenêtres, ainsi que les graphiques.
