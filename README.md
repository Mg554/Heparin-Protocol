# IV heparin protocol simulation

**Fictional data only. Do not prescribe, program a pump, or chart a result using this repository.** The rules are sample rules reconstructed from the old UI at `1dcae4bd`, not a validated implementation of a publication or site policy. Clipboard text is intended for documentation-format review, not for patient charts.

## Run and verify

From the repository root with Node.js 20+ and Python 3:

```sh
node --test
node --check heparin.mjs && node --check app.mjs && node --check sw.js
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/index.html`. There is no package installation, bundling step, or project linter. The clipboard requires a secure browser context (localhost or HTTPS) and permission; denied copies expose the note for manual copying. The app deliberately does not support offline calculations. If this repository was previously served to an installed browser, confirm that no old service worker or cached calculator is still accessible before using the demo. Treat existing hosted `main` and downloaded copies as unchanged by this branch.

## Audit findings and changes

| Finding at the audited revision | Change |
| --- | --- |
| The ACS starting-rate ceiling appeared in the reference table but was missing from calculation. VTE loading text did not show the cap used in code; titration had no maximum-rate enforcement. | Implement the repository's documented ACS initiation cap. Show sample bolus caps. Require an explicit scenario infusion ceiling and block outcomes exceeding it before or after rounding; it is not an invented titration cap. |
| The HTML accepted fractional aPTT values but branch endpoints such as 39 and 49 left those decimals in the next band. The same rounding path altered a “no change” rate. | Use explicit inclusive/exclusive sample boundaries and preserve the original rate for no-change rows. Block nonpositive outcomes and rounding that breaches the ceiling. Distinguish units/h from pump mL/h. |
| The original weight field did not identify a weight basis; several inputs lacked complete validation. An infusion-bag concentration was also used to suggest bolus volume. | Require the weight basis and dosing weight from the scenario; do not derive ideal or adjusted weight. Require explicit bag selection and a sample timestamp for aPTT. Do not calculate bolus volume. |
| Edits could leave a result visible for a prior weight, rate, lab, or concentration. An alternate page contained a second implementation. | Clear results, confirmation, and copy state on edits. Retire the duplicate calculator. |
| Anti-Xa was described, but there was no anti-Xa nomogram. HIT text relied on platelet change alone. The schedule, protamine, and combined warfarin/DOAC guidance were not reliable enough to reproduce. | Anti-Xa is alert-only. Withhold calculated output for critical findings, suspected HIT, active bleeding, or a substantial platelet fall. A fall is not a HIT diagnosis. Do not provide reversal, restart timing, repeat-testing instructions, or transition advice. |
| The legacy app loaded remote fonts and used inline handlers. The alternate HTML and worker on the audited revision were NUL-only. | Use same-origin modules, text-only rendering for dynamic values, and a content security policy. Retire the alternate HTML and worker. No runtime third-party packages, network calls, patient identifiers, or app persistence were added. |

## Before any clinical release

1. Have pharmacy, laboratory medicine, nursing, and the relevant service owners sign off on a versioned institutional nomogram. Verify the indication, weight basis and extreme-weight policy, cross-assay exclusions and timing, every interval endpoint, bolus and infusion caps, the actual pump library and concentration, no-bolus pathways, and hold/recheck/restart behavior.
2. Add independent protocol-derived fixtures, browser tests for keyboard/focus, clipboard failure, localization, and stale results, and CI. Exercise deployment, cache retirement, and out-of-scope workflows in a test environment first.
3. Design any real EHR documentation workflow separately: access, patient identity, audit trail, review and attribution, retention, privacy, and an explicit distinction between note text and medication orders.

Background references: [Anticoagulation Forum practical heparin guidance](https://link.springer.com/article/10.1007/s11239-015-1315-2) and the [ASH HIT guideline](https://pmc.ncbi.nlm.nih.gov/articles/PMC6258919/). These references do not validate the repository sample thresholds.
