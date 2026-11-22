import { calculate, formatNote } from './heparin.mjs';

const el = (id) => document.getElementById(id);
const form = el('calculator');
const field = (name) => form.elements.namedItem(name);
const messages = {
  hit: 'Suspected heparin-induced thrombocytopenia (HIT). No dose displayed. Follow the local HIT escalation pathway.',
  bleed: 'Active bleeding flagged. No dose displayed. Follow the local urgent escalation pathway.',
  safety: 'Select the scenario’s bleeding or HIT status.',
  platelets: 'Enter both platelet counts in ×10⁹/L, with a positive reference count.',
  plateletFall: 'Platelet fall of at least 50%. No dose displayed. Verify the trend and escalate for assessment; this is not a HIT diagnosis.',
  mode: 'Select initiation or titration.',
  protocol: 'Select a sample protocol supported by this workflow.',
  critical: 'Critical lab flag or aPTT in the highest sample band. No dose or restart displayed. Follow local critical-result procedures.',
  antiXaValue: 'Enter a reportable UFH anti-Xa result in IU/mL (up to three decimal places).',
  antiXaLimit: 'Enter the positive upper anti-Xa limit from the scenario, in IU/mL.',
  antiXaHigh: 'UFH anti-Xa exceeds the entered upper limit. No adjustment displayed. Use the local anti-Xa protocol.',
  antiXaUnsupported: 'No approved anti-Xa dosing rules are configured. No adjustment displayed.',
  assay: 'Select the assay used for the monitoring sample.',
  aptt: 'Enter a numeric aPTT of at least 10 seconds for this simulation.',
  current: 'Enter a positive running rate up to 5,000 units/h. This workflow does not start or restart an infusion.',
  collected: 'Enter a valid sample collection date and time in UTC, not in the future.',
  confirm: 'Verify the fictional inputs and check the confirmation box.',
  basis: 'Select the dosing-weight basis specified by the scenario.',
  weight: 'Enter a dosing weight from 30 to 200 kg, with up to two decimal places. Outside this sample range, no dose is displayed.',
  concentration: 'Select the infusion bag concentration specified by the scenario.',
  ceiling: 'Enter a positive scenario ceiling up to 5,000 units/h, with up to two decimal places.',
  currentAboveCeiling: 'The current rate already exceeds the entered ceiling. No adjustment displayed.',
  nonpositive: 'The sample adjustment would produce a nonpositive rate. No adjustment or restart displayed.',
  aboveCeiling: 'The calculated or rounded rate exceeds the entered ceiling. No dose displayed.',
  pumpAboveCeiling: 'Pump rounding would exceed the applicable ceiling. No pump setting displayed.',
  direction: 'Pump rounding does not preserve the intended adjustment. Review manually; no pump setting displayed.',
};
let snapshot = null;

function clear() {
  snapshot = null;
  el('result').hidden = true;
  el('note').value = '';
  el('breakdown').replaceChildren();
  el('warnings').textContent = '';
  el('error').hidden = true;
  el('error').textContent = '';
  el('copy-status').textContent = '';
  form.querySelectorAll('[aria-invalid]').forEach((input) => input.removeAttribute('aria-invalid'));
}

function configureAssay() {
  const assay = field('assay').value;
  const xa = assay === 'antiXa';
  el('lab-label').textContent = xa ? 'UFH anti-Xa (IU/mL)' : assay === 'aptt' ? 'aPTT (seconds)' : 'Lab result';
  el('anti-limit').hidden = !xa;
  field('antiXaUpper').disabled = !xa;
  el('sample-time').hidden = xa;
  el('current-rate').hidden = xa;
  field('collected').disabled = xa;
  field('current').disabled = xa;
}

function configureMode() {
  const titrating = location.hash === '#titrate';
  form.reset();
  clear();
  field('mode').value = titrating ? 'titrate' : 'start';
  el('labs').hidden = !titrating;
  el('labs').disabled = !titrating;
  el('high').hidden = titrating;
  el('high').disabled = titrating;
  el(titrating ? 'init-link' : 'titrate-link').removeAttribute('aria-current');
  el(titrating ? 'titrate-link' : 'init-link').setAttribute('aria-current', 'location');
  configureAssay();
}

function invalidate(event) {
  if (event.target !== field('confirm')) field('confirm').checked = false;
  clear();
}
form.addEventListener('input', invalidate);
form.addEventListener('change', (event) => {
  invalidate(event);
  if (event.target === field('assay')) {
    field('lab').value = '';
    field('antiXaUpper').value = '';
    field('collected').value = '';
    field('current').value = '';
    field('critical').checked = false;
    configureAssay();
  }
});
window.addEventListener('hashchange', configureMode);
window.addEventListener('pageshow', (event) => { if (event.persisted) configureMode(); });

form.addEventListener('submit', (event) => {
  event.preventDefault();
  clear();
  const data = Object.fromEntries(new FormData(form));
  const result = calculate({ ...data, confirm: data.confirm === 'on', critical: data.critical === 'on' });
  if (!result.ok) {
    const error = el('error');
    error.hidden = false;
    error.textContent = messages[result.code] ?? 'Calculation unavailable. Verify the inputs.';
    if (result.field) {
      const input = field(result.field);
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }
    return;
  }
  const r = result;
  const warnings = [
    r.high ? 'aPTT is above the sample target.' : '',
    r.holdMinutes ? `Sample nomogram hold: ${r.holdMinutes} minutes. No restart is authorized.` : '',
    r.rawBolus > r.bolus ? `Sample bolus cap applied (${r.bolusCap} units).` : '',
    r.capped ? `Sample ACS starting-rate cap applied (${r.doseRate} units/h).` : '',
  ].filter(Boolean);
  el('warnings').textContent = warnings.join(' ');
  el('warnings').hidden = warnings.length === 0;
  const lines = [
    `${r.protocol} · ${r.weight} kg (${r.basis})${r.band ? ` · ${r.lab} s matched ${r.band}` : ''}.`,
    r.bolusFactor === 0 ? 'Sample bolus: none.' : `Bolus: ${r.bolusFactor} units/kg × ${r.weight} kg = ${r.rawBolus} units; sample cap ${r.bolusCap} units → ${r.bolus} units. Infusion-bag concentration is not used for bolus volume.`,
    r.noChange ? `No change: keep the current ${r.current} units/h without rounding. No new pump setting.` :
      `${r.current === null ? '' : `${r.current} units/h + `}(${r.factor} units/kg/h × ${r.weight} kg) = ${r.rawRate} units/h. Round to nearest 10 → ${r.roundedRate} units/h${r.capped ? `; apply starting cap → ${r.doseRate} units/h` : ''}.`,
    r.noChange ? '' : `${r.doseRate} units/h ÷ ${r.concentration} units/mL, rounded to 0.1 mL/h → ${r.pumpRate.toFixed(1)} mL/h (${r.delivered} units/h delivered at pump precision).`,
  ].filter(Boolean);
  el('breakdown').replaceChildren(...lines.map((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
  snapshot = r;
  el('note').value = formatNote(r);
  el('result').hidden = false;
  el('result-title').focus();
});

el('copy').addEventListener('click', async () => {
  const captured = snapshot;
  if (!captured) return;
  try {
    await navigator.clipboard.writeText(formatNote(captured));
    if (snapshot === captured) el('copy-status').textContent = 'Simulation note copied.';
  } catch {
    if (snapshot !== captured) return;
    const note = el('note');
    note.closest('details').open = true;
    note.focus();
    note.select();
    el('copy-status').textContent = 'Clipboard unavailable. The note is selected for manual copying.';
  }
});
configureMode();
el('controls').disabled = false;
