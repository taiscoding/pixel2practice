# pixel2practice

[![CI](https://github.com/taiscoding/pixel2practice/actions/workflows/ci.yml/badge.svg)](https://github.com/taiscoding/pixel2practice/actions/workflows/ci.yml)

Every radiologist has a diagnostic signature. This is a tool for learning yours.

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

## Point mode

The loop run backward. No sentence: draw a box where something looks off, and the reader characterizes your box two ways, once open over the whole film and once pointed at the marked region (red box overlay plus a zoomed crop, Set-of-Mark style). Bring your own key in the reader settings; it stays in your browser. Providers: Gemini (free tier, the default), OpenAI direct, OpenRouter (one key, many models including Claude; Anthropic's own API blocks browser calls), or Custom (any OpenAI-compatible endpoint: Ollama, proxies, other keys). Read pairs are logged and exportable, so pointed-vs-open becomes a measurable delta instead of a vibe.
