// Repository-derived sample rules only. This is not an approved clinical protocol.
export const VERSION = 'audit-demo-2';
const protocols = {
  vte: { label: 'DVT/PE', loading: [80, 5000], start: 18, startCap: Infinity, target: [60, 100], zones: [
    [40, false, 3, 80, 5000, 0], [50, false, 2, 40, 3000, 0], [60, false, 1, 0, 0, 0],
    [100, true, 0, 0, 0, 0], [120, true, -1, 0, 0, 0], [150, true, -2, 0, 0, 30],
  ] },
  acs: { label: 'ACS/NSTEMI', loading: [60, 4000], start: 12, startCap: 1000, target: [50, 70], zones: [
    [40, false, 2, 60, 4000, 0], [50, false, 1, 0, 0, 0], [70, true, 0, 0, 0, 0],
    [90, true, -1, 0, 0, 0], [120, true, -2, 0, 0, 30],
  ] },
  high: { label: 'High bleeding risk (sample)', loading: [0, 0], start: 18, startCap: Infinity },
};

// Parse a plain decimal without JS coercion, exponent notation, or silent rounding.
function decimal(raw, min, max, places = 2) {
  if (typeof raw !== 'string' || raw.length > 32) return null;
  const value = raw.trim();
  if (!new RegExp(`^(?:[0-9]+(?:\\.[0-9]{1,${places}})?|\\.[0-9]{1,${places}})$`).test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}
const stop = (code, field = null) => ({ ok: false, code, field });
const q2 = (n) => Math.round(n * 100) / 100;

// Exact rational arithmetic for the preparation and pump conversion. Values rounded
// for display never feed back into a calculation or a ceiling comparison.
const roundRatio = (n, d) => (2n * n + d) / (2n * d);
function ratioText(n, d) {
  const scale = 1000000n;
  const scaled = roundRatio(n * scale, d);
  const fraction = String(scaled % scale).padStart(6, '0').replace(/0+$/, '');
  return `${scaled * d === n * scale ? '' : '≈ '}${scaled / scale}${fraction ? `.${fraction}` : ''}`;
}

export function preparation(input) {
  const container = input.container === 'bag' ? 'Infusion bag' : input.container === 'syringe' ? 'Syringe' : null;
  if (!container) return stop('container', 'container');
  // Data-entry bounds for the simulation, not approved concentration limits.
  const totalUnits = decimal(input.totalUnits, 1, 1000000, 1);
  if (totalUnits === null || !Number.isInteger(totalUnits)) return stop('totalUnits', 'totalUnits');
  const finalVolume = decimal(input.finalVolume, 0.01, 10000);
  if (finalVolume === null) return stop('finalVolume', 'finalVolume');
  const volumeHundredths = BigInt(Math.round(finalVolume * 100));
  const concentrationText = ratioText(BigInt(totalUnits) * 100n, volumeHundredths);
  return { ok: true, container, totalUnits, finalVolume, concentrationText };
}

export function calculate(input, now = new Date()) {
  if (input.safety !== 'clear') return stop(input.safety === 'hit' ? 'hit' : input.safety === 'bleed' ? 'bleed' : 'safety', 'safety');
  const present = (value) => value != null && (typeof value !== 'string' || value.trim() !== '');
  const pairEntered = present(input.plateletReference) || present(input.plateletCurrent);
  const plateletReference = pairEntered ? decimal(input.plateletReference, 0.01, 10000) : null;
  const plateletCurrent = pairEntered ? decimal(input.plateletCurrent, 0, 10000) : null;
  if (pairEntered && plateletReference === null) return stop('platelets', 'plateletReference');
  if (pairEntered && plateletCurrent === null) return stop('platelets', 'plateletCurrent');
  if (pairEntered && Math.round(plateletCurrent * 200) <= Math.round(plateletReference * 100)) return stop('plateletFall');
  const titrating = input.mode === 'titrate';
  if (!titrating && input.mode !== 'start') return stop('mode', 'mode');
  const protocol = Object.hasOwn(protocols, input.protocol) ? protocols[input.protocol] : null;
  if (!protocol || (titrating && !protocol.zones)) return stop('protocol', 'protocol');
  if (titrating && input.critical === true) return stop('critical');
  let lab = null;
  let current = null;
  let row = null;
  let collected = null;
  let band = null;
  if (titrating) {
    if (input.assay === 'antiXa') {
      lab = decimal(input.lab, 0, 1000, 3);
      if (lab === null) return stop('antiXaValue', 'lab');
      const upper = decimal(input.antiXaUpper, 0.001, 1000, 3);
      if (upper === null) return stop('antiXaLimit', 'antiXaUpper');
      return stop(lab > upper ? 'antiXaHigh' : 'antiXaUnsupported');
    }
    if (input.assay !== 'aptt') return stop('assay', 'assay');
    lab = decimal(input.lab, 0.01, Infinity);
    if (lab === null) return stop('aptt', 'lab');
    if (lab > protocol.zones.at(-1)[0]) return stop('critical');
    if (lab < 10) return stop('aptt', 'lab');
    row = protocol.zones.find(([upper, inclusive]) => inclusive ? lab <= upper : lab < upper);
    const prev = protocol.zones[protocol.zones.indexOf(row) - 1];
    band = `${prev ? `${prev[0]} ${prev[1] ? '<' : '≤'} ` : ''}aPTT ${row[1] ? '≤' : '<'} ${row[0]} s`;
    current = decimal(input.current, 0.01, 5000);
    if (current === null) return stop('current', 'current');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.collected || '')) return stop('collected', 'collected');
    const sampleTime = new Date(`${input.collected}:00Z`);
    if (!Number.isFinite(+sampleTime) || sampleTime.toISOString().slice(0, 16) !== input.collected || +sampleTime > +now) return stop('collected', 'collected');
    collected = sampleTime.toISOString();
  }
  if (input.confirm !== true) return stop('confirm', 'confirm');
  if (!['actual', 'ideal', 'adjusted'].includes(input.basis)) return stop('basis', 'basis');
  const weight = decimal(input.weight, 30, 200);
  if (weight === null) return stop('weight', 'weight');
  const prep = preparation(input);
  if (!prep.ok) return prep;
  const ceiling = decimal(input.ceiling, 0.01, 5000);
  if (ceiling === null) return stop('ceiling', 'ceiling');
  if (current !== null && current > ceiling) return stop('currentAboveCeiling');
  const factor = titrating ? row[2] : protocol.start;
  const noChange = titrating && factor === 0;
  const rawRate = q2((current ?? 0) + factor * weight);
  const [bolusFactor, bolusCap] = titrating ? row.slice(3, 5) : protocol.loading;
  const rawBolus = q2(bolusFactor * weight);
  const bolus = Math.min(rawBolus, bolusCap);
  const roundedRate = noChange ? rawRate : Math.round(rawRate / 10) * 10;
  const tableCap = titrating ? Infinity : protocol.startCap;
  const doseRate = Math.min(roundedRate, tableCap);
  if (rawRate <= 0 || doseRate <= 0) return stop('nonpositive');
  if (Math.min(rawRate, tableCap) > ceiling || doseRate > ceiling) return stop('aboveCeiling');
  let pumpRate = null;
  let roundingDifference = null;
  let deliveredText = noChange ? String(current) : null;
  if (!noChange) {
    const volume = BigInt(Math.round(prep.finalVolume * 100));
    const units = BigInt(prep.totalUnits);
    const pumpTenths = roundRatio(BigInt(doseRate) * volume, units * 10n);
    if (pumpTenths === 0n) return stop('pumpZero');
    const deliveredNumerator = pumpTenths * units * 10n;
    const deliveredHundredths = deliveredNumerator * 100n;
    const maximumHundredths = BigInt(Math.round(Math.min(ceiling, tableCap) * 100));
    if (deliveredHundredths > maximumHundredths * volume) return stop('pumpAboveCeiling');
    if (titrating) {
      const currentHundredths = BigInt(Math.round(current * 100));
      const difference = deliveredHundredths - currentHundredths * volume;
      if (factor > 0 ? difference <= 0n : difference >= 0n) return stop('direction');
    }
    pumpRate = Number(pumpTenths) / 10;
    deliveredText = ratioText(deliveredNumerator, volume);
    const difference = deliveredNumerator - BigInt(doseRate) * volume;
    if (difference !== 0n) {
      roundingDifference = { direction: difference > 0n ? 'above' : 'below', unitsText: ratioText(difference > 0n ? difference : -difference, volume) };
    }
  }
  return {
    ok: true, mode: input.mode, protocol: protocol.label, basis: input.basis, weight, current, lab, collected, band,
    plateletReference, plateletCurrent, prep, ceiling, factor, rawRate, roundedRate, doseRate,
    deliveredText, pumpRate, roundingDifference, noChange, bolusFactor, rawBolus, bolusCap, bolus,
    capped: !titrating && rawRate > tableCap, high: titrating && lab > protocol.target[1],
    holdMinutes: row?.[5] ?? 0, calculatedAt: now.toISOString(),
  };
}

export function formatNote(r) {
  if (!r.ok) return null;
  return [
    'SIMULATION DRAFT — NOT AN ORDER — DO NOT PLACE IN A PATIENT CHART',
    `Calculation time (UTC): ${r.calculatedAt} | ${VERSION}`,
    `Workflow: ${r.mode} | Scenario: ${r.protocol} | Dosing weight: ${r.weight} kg (${r.basis})`,
    r.lab === null ? 'Monitoring lab: not used for this initiation sample.' : `aPTT: ${r.lab} s | Sample time (UTC): ${r.collected}${r.high ? ' | Above sample target' : ''}`,
    r.plateletReference === null ? 'Platelet trend: not entered.' : `Platelets (×10^9/L), reference → current: ${r.plateletReference} → ${r.plateletCurrent}`,
    `${r.prep.container}: ${r.prep.totalUnits} units in ${r.prep.finalVolume} mL final volume (${r.prep.concentrationText} units/mL) | Entered ceiling: ${r.ceiling} units/h`,
    `Bolus example: ${r.bolus} units${r.rawBolus > r.bolus ? ' (sample cap applied)' : ''}`,
    `Current → example dose rate: ${r.current ?? 'not applicable'} → ${r.doseRate} units/h${r.capped ? ' (sample starting cap applied)' : ''}`,
    r.noChange ? 'No rate change; no new pump setting.' : `Illustrative pump rate: ${r.pumpRate.toFixed(1)} mL/h (${r.deliveredText} units/h at pump precision)`,
    r.roundingDifference ? `Pump rounding: ${r.roundingDifference.unitsText} units/h ${r.roundingDifference.direction} the intended example rate.` : '',
    r.holdMinutes ? `Sample nomogram hold: ${r.holdMinutes} minutes; no restart authorized.` : '',
  ].filter(Boolean).join('\n');
}
