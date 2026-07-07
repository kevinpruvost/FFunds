# FFunds

Base Astro + Starlight site for investment knowledge documentation and simulations.

## Commands

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

## Mise à jour des données

Les données historiques mensuelles des actifs sont stockées dans `src/data/prices.json`. Ce fichier est généré par le script `scripts/fetch-prices.mjs` qui interroge l'API Yahoo Finance au moment du build.

- Pour rafraîchir les données : `npm run fetch-data` (nécessite une connexion Internet)
- Pour ajouter de nouveaux tickers : éditez `src/data/tickers.config.json` puis relancez `npm run fetch-data`
- Le hook `prebuild` rafraîchit automatiquement les données lors d'un `npm run build` local. En CI (GitHub Pages), le workflow utilise le fichier `prices.json` déjà commité.
