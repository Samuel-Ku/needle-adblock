# Needle AdBlock — prototype

An experimental Chrome Manifest V3 extension that finds ad-shaped DOM blocks, classifies them locally with [Cactus-Compute/needle3](https://huggingface.co/Cactus-Compute/needle3), and removes or highlights confirmed matches.

This is a throwaway prototype. It answers one question: can the base Needle3 model make useful decisions about advertising elements without an API key or an inference server? The model is really executed; no heuristic result replaces it. Accuracy for this task is limited.

## Run it with one command

Node.js 22 or newer is required:

```sh
npm run prototype
```

The command downloads the official artifacts when needed, verifies their SHA-256 hashes, and starts a local server. Open the [demo page](http://127.0.0.1:8787/prototype/demo.html) and click **Load model & start scanning**. It uses the same model, classifier, and DOM scanner as the extension. The initial mode is Highlight. The page shows settings, recent decisions, and live statistics; you can change the threshold, remove blocks, restore them, and add a dynamically loaded ad.

The model is 35,335,380 bytes and the runtime is approximately 0.7 MB. Internet access is needed during the initial setup. Later runs use the local files. Stop the server with `Ctrl+C`. No npm dependencies need to be installed.

## Install the extension

1. Run `npm run setup` (or the command above).
2. Open `chrome://extensions` and enable Developer mode.
3. Click **Load unpacked** and select the `extension` directory.
4. Reload a regular HTTP/HTTPS page and open the extension popup.

The installed extension does not need the local server. The executable JavaScript/WASM files and model weights are packaged locally; the extension does not load code from a CDN. Chrome 116 or newer is required. Browser settings pages and the Chrome Web Store are unsupported.

Controls include enable/disable, a 0.30–0.95 threshold, Remove/Highlight, animation, notifications, Rescan, and Restore. The default extension settings are enabled, Remove, and 0.70. Disabling restores removed blocks. Settings and statistics live in `chrome.storage.session` and reset when the browser session ends. The demo keeps all state in page memory.

## How decisions are made

1. The DOM scanner looks for ad attributes, classes, known advertising hosts, and short disclosures such as Sponsored, Advertisement, and localized equivalents. An ordinary iframe is not enough by itself.
2. The scanner climbs to a card boundary while avoiding page containers, forms, and editors. DOM changes and scrolling schedule another scan after 600 ms. Each request contains up to 12 candidates.
3. An offscreen document owns a Worker with the local WebAssembly runtime. Candidates are processed sequentially and the model conversation is reset between them. The model receives normalized visible text and the disclosure; empty blocks receive only limited element and iframe-host metadata.
4. Needle3 returns one category: `editorial`, `advertisement`, `sponsored`, `paid placement`, `partner offer`, or `promoted`. An action requires an advertising category and sufficient `confidence`. Confidence is confidence in the model response, not the probability that an element is an ad. Empty, refused, invalid, and uncertain responses leave the element visible.
5. Removal leaves a DOM marker for Restore. Original nodes are retained, up to 100 per page session. If a parent container disappears from the DOM, restoration may be impossible; reload the page in that case.

## Privacy and limitations

- The extension has no API keys, backend, analytics, or remote classification requests. Its CSP permits only packaged resources. The visited site continues to make its own network requests.
- This is cosmetic DOM removal after loading. It does not block ad requests, trackers, malicious resources, or video ads.
- The base Needle3 model was not trained specifically for advertising. It can miss ads, hide content incorrectly, and react to instructions inside page text. Highlight mode lets you inspect decisions before removal.
- Explicit English disclosure labels work best. Manual checks found missed Ukrainian and German ads and opaque advertising iframes; editorial discussions of advertising and phrases such as “not sponsored” sometimes caused false positives. Candidate gating reduces risk but cannot guarantee correctness. High confidence is not a guarantee.
- Scanning is bounded by the number of inspected nodes; closed Shadow DOM and cross-origin iframe contents are unavailable. The outer iframe node can be hidden when it has sufficient advertising evidence.
- The first run loads the model into memory; processing time depends on the CPU and candidate count. This is a desktop Chrome prototype.

## Interactive logic check

```sh
npm run logic
```

The terminal prototype prints the full state, raw model response, and resulting action. Press `e` for the next example, enter arbitrary text for a new candidate, use `t 0.8` to change the threshold, and press `q` to quit. State is not persisted.

`npm run check` validates JavaScript syntax and extension package completeness. The throwaway prototype intentionally has no automated test suite.

## Sources and reproducibility

- [Needle3 model and files](https://huggingface.co/Cactus-Compute/needle3).
- [Official runtime/API](https://github.com/cactus-compute/needle) and [confidence guidance](https://cactuscompute.com/blog/needle-confidence).
- Pinned artifact revision: `b274efcb211a9eef48c9a88da4b43bd569696a39`. Checksums are recorded in `scripts/prepare.mjs`.
- Needle artifacts are distributed under Apache-2.0; the license is copied to `extension/vendor/LICENSE-Needle.txt`. The model is authored by Cactus Compute, Inc.
- The prototype code was written independently. Model artifacts are not committed to Git; `npm run setup` restores them.

The experiment and validation record are in `PROTOTYPE-NOTES.md`.
