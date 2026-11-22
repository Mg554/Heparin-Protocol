import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { calculate, formatNote, preparation } from '../heparin.mjs';

const now = new Date('2026-03-04T12:30:00Z');
const base = { mode: 'start', protocol: 'vte', safety: 'clear', confirm: true, basis: 'actual', weight: '70', container: 'bag', totalUnits: '25000', finalVolume: '500', ceiling: '2000' };
const tit = { ...base, mode: 'titrate', assay: 'aptt', current: '1000', lab: '60', collected: '2026-03-04T09:00' };
const run = (input, overrides = {}) =&gt; calculate({ ...input, ...overrides }, now);
function blocked(input, overrides, code) {
  const result = run(input, overrides);
  assert.equal(result.ok, false);
  assert.equal(result.code, code);
  assert.equal('doseRate' in result, false);
  assert.equal(formatNote(result), null);
}

test('standard initiation, documented bolus caps and ACS starting cap', () =&gt; {
  const vte = run(base);
  assert.deepEqual(\[vte.rawBolus, vte.bolus, vte.doseRate, vte.pumpRate\], \[5600, 5000, 1260, 25.2\]);
  const acs = run(base, { protocol: 'acs' });
  assert.deepEqual(\[acs.bolus, acs.doseRate, acs.capped\], \[4000, 840, false\]);
  const capped = run(base, { protocol: 'acs', weight: '100', totalUnits: '20000' });
  assert.deepEqual(\[capped.rawRate, capped.doseRate, capped.deliveredText, capped.capped\], \[1200, 1000, '1000', true\]);
  assert.equal(run(base, { protocol: 'high' }).bolus, 0);
  blocked(tit, { protocol: 'high' }, 'protocol');
});

test('decimal aPTT follows explicit inequalities for both protocols', () =&gt; {
  const cases = {
    vte: \[\['39.99', 3\], \['40', 2\], \['49.99', 2\], \['50', 1\], \['59.99', 1\], \['60', 0\], \['100', 0\], \['100.01', -1\], \['120', -1\], \['120.01', -2\], \['150', -2\], \['150.01', null\]\],
    acs: \[\['39.99', 2\], \['40', 1\], \['49.99', 1\], \['50', 0\], \['70', 0\], \['70.01', -1\], \['90', -1\], \['90.01', -2\], \['120', -2\], \['120.01', null\]\],
  };
  for (const \[protocol, rows\] of Object.entries(cases)) {
    for (const \[lab, factor\] of rows) {
      if (factor === null) blocked(tit, { protocol, lab }, 'critical');
      else assert.equal(run(tit, { protocol, lab }).factor, factor, `${protocol} ${lab}`);
    }
  }
  const high = run(tit, { lab: '130' });
  assert.deepEqual(\[high.high, high.holdMinutes, high.doseRate\], \[true, 30, 860\]);
  assert.equal(run(tit, { lab: '40', weight: '100' }).bolus, 3000);
});

test('no-change preserves a running rate; unsafe changes are blocked', () =&gt; {
  const unchanged = run(tit, { current: '1003.27' });
  assert.deepEqual(\[unchanged.doseRate, unchanged.deliveredText, unchanged.pumpRate\], \[1003.27, '1003.27', null\]);
  blocked(tit, { current: '0' }, 'current');
  blocked(tit, { lab: '145', current: '100' }, 'nonpositive');
  blocked(tit, { ceiling: '999' }, 'currentAboveCeiling');
  blocked(tit, { lab: '55', ceiling: '1050' }, 'aboveCeiling');
  blocked(base, { weight: '31.66', totalUnits: '20000', finalVolume: '500', ceiling: '570' }, 'pumpAboveCeiling');
  blocked(base, { weight: '30.28', ceiling: '545' }, 'aboveCeiling');
});

test('requires explicit inputs and rejects malformed or unsafe measurements', () =&gt; {
  for (const weight of \['', ' ', '-30', '0', 'NaN', 'Infinity', '1e2', '0x50', '70kg', '29.99', '200.01', '70.123', 70\]) blocked(base, { weight }, 'weight');
  assert.equal(run(base, { weight: '30' }).ok, true);
  assert.equal(run(base, { weight: '200', ceiling: '5000' }).ok, true);
  for (const \[field, value, code\] of \[\['basis', '', 'basis'\], \['ceiling', '', 'ceiling'\], \['container', '', 'container'\], \['confirm', false, 'confirm'\], \['protocol', 'constructor', 'protocol'\]\]) blocked(base, { \[field\]: value }, code);
  for (const lab of \['', '0', '-12', 'text', '1e2', '9.99'\]) blocked(tit, { lab }, 'aptt');
  for (const collected of \['', '2026-02-29T10:00', '2026-03-04T12:31', '2026-03-04T24:00'\]) blocked(tit, { collected }, 'collected');
  blocked(tit, { lab: '301' }, 'critical');
});

test('critical and HIT safety stops, and anti-Xa never returns an aPTT dose', () =&gt; {
  blocked(tit, { critical: true }, 'critical');
  blocked(tit, { safety: 'hit' }, 'hit');
  blocked(base, { safety: 'bleed' }, 'bleed');
  blocked(base, { plateletReference: '201', plateletCurrent: '100.50' }, 'plateletFall');
  blocked(base, { plateletReference: '201' }, 'platelets');
  blocked(base, { plateletCurrent: 100 }, 'platelets');
  assert.equal(run(base, { plateletReference: '201', plateletCurrent: '100.51' }).ok, true);
  blocked(tit, { assay: 'antiXa', lab: '.701', antiXaUpper: '.700' }, 'antiXaHigh');
  blocked(tit, { assay: 'antiXa', lab: '.700', antiXaUpper: '.700' }, 'antiXaUnsupported');
  blocked(tit, { assay: 'antiXa', lab: '0', antiXaUpper: '.700' }, 'antiXaUnsupported');
  blocked(tit, { assay: 'antiXa', lab: '.400', antiXaUpper: '' }, 'antiXaLimit');
});

test('note uses only the calculated snapshot and labels dates and units', () =&gt; {
  const note = formatNote(run(tit, { lab: '55', basis: 'adjusted', plateletReference: '220', plateletCurrent: '200' }));
  assert.match(note, /^SIMULATION DRAFT — NOT AN ORDER/);
  assert.match(note, /2026-03-04T12:30:00.000Z.\*audit-demo-2/);
  assert.match(note, /70 kg $$adjusted$$/);
  assert.match(note, /aPTT: 55 s.\*2026-03-04T09:00:00.000Z/);
  assert.match(note, /220 → 200/);
  assert.match(note, /1000 → 1070 units/h/);
  assert.match(note, /21.4 mL/h/);
  assert.match(note, /Infusion bag: 25000 units in 500 mL final volume $$50 units\/mL$$/);
});

test('editable preparations support both containers and retain exact ratios for conversion', () =&gt; {
  const custom = { container: 'syringe', totalUnits: '10000', finalVolume: '48' };
  const r = run(base, custom);
  assert.deepEqual(r.prep, { ok: true, container: 'Syringe', totalUnits: 10000, finalVolume: 48, concentrationText: '≈ 208.333333' });
  assert.deepEqual(\[r.bolus, r.doseRate, r.pumpRate, r.deliveredText\], \[5000, 1260, 6, '1250'\]);
  assert.deepEqual(r.roundingDifference, { direction: 'below', unitsText: '10' });
  assert.match(formatNote(r), /Pump rounding: 10 units/h below/);
  assert.match(formatNote(r), /Syringe: 10000 units in 48 mL final volume.\*208.333333 units/mL/);
  assert.equal(preparation({ ...base, totalUnits: '1000', finalVolume: '12.50' }).concentrationText, '80');
  assert.equal(run(base, { ...custom, totalUnits: '1200', finalVolume: '13' }).pumpRate, 13.7); // Exact half step.
});

test('missing, zero, negative, malformed and ambiguous preparation inputs are blocked', () =&gt; {
  for (const totalUnits of \['', '0', '-1', '25000.5', '25,000', '1e4', 'Infinity', '1000001'\]) blocked(base, { totalUnits }, 'totalUnits');
  for (const finalVolume of \['', '0', '-1', '10 mL', '1,25', '2.001', '1e2', '10000.01'\]) blocked(base, { finalVolume }, 'finalVolume');
});

test('exact pump conversion preserves caps and titration direction with custom concentrations', () =&gt; {
  blocked(base, { weight: '31.66', totalUnits: '10000', finalVolume: '250.01', ceiling: '570' }, 'pumpAboveCeiling');
  const atCeiling = run(base, { totalUnits: '10000', finalVolume: '80', ceiling: '1262.50' });
  assert.deepEqual(\[atCeiling.pumpRate, atCeiling.deliveredText\], \[10.1, '1262.5'\]);
  assert.deepEqual(atCeiling.roundingDifference, { direction: 'above', unitsText: '2.5' });
  blocked(base, { totalUnits: '10000', finalVolume: '80', ceiling: '1262.49' }, 'pumpAboveCeiling');
  blocked(base, { protocol: 'acs', weight: '100', totalUnits: '11000', finalVolume: '12' }, 'pumpAboveCeiling');
  blocked(base, { totalUnits: '25000', finalVolume: '.01' }, 'pumpZero');
  blocked(tit, { lab: '55', current: '1000', totalUnits: '10000', finalVolume: '5' }, 'direction');
  blocked(tit, { lab: '110', current: '1000', totalUnits: '10000', finalVolume: '5' }, 'direction');
});