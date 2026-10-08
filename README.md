# pixel2practice

Every radiologist has a diagnostic signature: where their eyes go, how they decide, how it drifts with training and fatigue. This is a tool for learning yours, and for studying how signatures form.

Read a finding sentence, box the pixels, score IoU ≥ 0.25 against radiologist teaching targets.

## Run locally

```bash
npm install
npm run dev
```

Demo CXRs ship by default. For real report sentences, build drills from X-Raydar (see **DATA.md**).

## Build drills

```bash
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy
python3 scripts/build-drills.py --xraydar --limit 60 --min-cue-score 2
npm run dev
```

## Deploy

GitHub Pages (source deploy, demo fallback if drills are not in the repo):

```bash
npm run build
# push to main; Actions publishes to GitHub Pages
```

Full drill pack (includes `public/drills/` in the build):

```bash
npm run build
npm run deploy:cloudflare
```

## Self-eval

Session stats and attempt logs persist in the browser, so you can watch your signature develop over time. Export the JSON log when you want a record for later review.
