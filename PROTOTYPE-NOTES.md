# Prototype record

## Question

Can a small local Needle3 model drive cosmetic advertisement removal while preserving ordinary page content, with no API key or remote inference?

## Decision

The integration is feasible: packaged WebAssembly, an MV3 offscreen document, and one serial worker can run the actual model. The selected schema asks for one of six purpose/disclosure categories: editorial, advertisement, sponsored, paid placement, partner offer, or promoted. The input is a neutral classification request followed by quoted, normalized evidence capped at 440 characters; each inference resets its conversation.

The base model recognizes explicit English disclosure language better than it judges meaning. It is not a reliable general advertisement classifier. Model confidence is confidence in a tool response and must not be presented as an advertisement probability. Empty calls, suppressed calls, missing confidence, invalid output, and model errors all preserve the element. Real DOM advertising evidence is required before inference; an ordinary iframe is not enough.

Removal is reversible within the live document, with a 100-element retention cap. Settings are session-only. These are experimental decisions, not a production accuracy claim.

## Captured source

The experiment is captured on the `prototype/needle-local-adblock` branch. No production implementation or validated web-wide accuracy threshold is claimed.

## Model observations

An early boolean schema recognized a short VPN example but missed most realistic cards. Asking a leading yes/no question caused every demo card to be called advertising, so that approach was rejected. Explicit disclosure categories worked on the larger cards without that question. These development fixtures helped select the prompt, so their scores are not independent accuracy estimates.

Separate probes with the selected schema found high-confidence false positives on articles discussing advertising and phrases such as “not sponsored” and “no advertisement.” Ukrainian and German advertisements, opaque ad frames, and unlabeled offers were missed. A dedicated labeled dataset and model adaptation would be needed before production use.

## Validation record

Verified on 2026-09-22 with the pinned model and Chromium:

- JavaScript syntax and extension asset checks pass with `npm run check`.
- Browser demo: 8 candidates; 7 advertising fixtures highlighted and the editorial candidate kept. A batch took about 4.9 seconds after warmup on this machine.
- The same fixtures switched to Remove: 7 were removed; Restore returned the original nodes. Disable cancels pending actions and restores the page.
- A dynamic sponsored fixture entered the observer pipeline and received an advertising decision at approximately 0.90 confidence.
- The browser console reported no page errors; recorded demo requests all targeted the local server.
- The unpacked MV3 extension loaded in a fresh Chromium profile; its service worker, offscreen document, packaged WASM/model, warmup, and popup transport all worked.
- The interactive terminal prototype loaded the actual runtime and exposed the raw model response and decision.

The demo contains six varied advertisements plus one short calibration example, two editorial articles, navigation/editor picks, and a newsletter form. These observations demonstrate the plumbing and selected examples; they do not establish web-wide accuracy. No automated test suite was added to this throwaway branch.
