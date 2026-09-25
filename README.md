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

### Indices MSCI et fichiers locaux

- `npm run fetch-msci` met à jour les cinq CSV MSCI depuis la source officielle en **Net / USD**. Puis `npm run fetch-data` régénère `prices.json` avec ces CSV et les cours Yahoo.
- La fréquence quotidienne permet de prendre la dernière observation de chaque mois, y compris le mois en cours **non terminé**. La date exacte reste dans le CSV ; la clé dans `prices.json` est `YYYY-MM`.
- L'historique existant est conservé, avec contrôle du chevauchement. Momentum conserve sa base 100 au 31/01/1997, différente des niveaux bruts de l'API.
- `npm run fetch-msci` est explicite : `fetch-data` et `prebuild` continuent à lire les CSV locaux, sans rafraîchir MSCI automatiquement.
- Tests : `node --test scripts/*.test.mjs`.
- KMLM combine l'historique fourni depuis 1988 et une prolongation par les rendements de l'ETF Yahoo depuis mai 2026 ; ce n'est pas une série d'indice pur. Les nouveaux mois restent dans `kmlm.csv` et sont repris par `fetch-data`.

État et provenance de la mise à jour : [`src/data/SOURCES.md`](src/data/SOURCES.md).
