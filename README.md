# ThoughtSpot (default branch: `main`)

A Vite + TypeScript custom chart (package name `truck-gauge`) built on the ThoughtSpot Chart SDK (`@thoughtspot/ts-chart-sdk`). It renders a gauge with warning/critical thresholds, and is deployed to GitHub Pages at base path `/ThoughtSpot/`.

## Architecture

```
ThoughtSpot Answer/Liveboard
      |  Chart SDK context (getChartContext)
      v
index.html (#container) --> src/main.ts (gauge inputs: value, minimum, maximum,
                                warningStart, criticalStart, label, unit)
      |  push to main
      v
GitHub Actions (deploy-pages.yml) --> npm ci / npm run build --> GitHub Pages
```

## Folder inventory

| Path | Description |
|---|---|
| `index.html` | Host page with `#container`, loads `src/main.ts` |
| `src/main.ts` | Gauge chart logic (input parsing/validation, HTML escaping, rendering) |
| `src/counter.ts`, `src/style.css`, `src/assets/` | Vite template leftovers / styles / images |
| `public/` | Static icons |
| `vite.config.ts` | Vite config, `base: '/ThoughtSpot/'` |
| `tsconfig.json`, `package.json` | TypeScript and npm config |
| `.github/workflows/deploy-pages.yml` | Build and deploy to GitHub Pages (Node 22) |

## Develop
```
npm ci
npm run dev      # local dev server
npm run build    # tsc + vite build -> dist/
```

## Deployment
Pushes to `main` (or manual dispatch) run build then deploy-pages. Dependencies: typescript ~6.0.2, vite ^8.1.1, @thoughtspot/ts-chart-sdk ^1.2.1.

## Security notices
No hardcoded credentials detected in tracked source/config files. Workflow permissions: contents read, pages write, id-token write.

---
*Generated using Abacus AI Agent on 2026-11-26*
