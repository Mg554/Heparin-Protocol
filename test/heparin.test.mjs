import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { calculate, formatNote } from '../heparin.mjs';

const now = new Date('2026-03-04T12:30:00Z');
const base = { mode: 'start', protocol: 'vte', safety: 'clear', confirm: true, basis: 'actual', weight: '70', concentration: '50', ceiling: '2000' };
const tit = { ...base, mode: 'titrate', assay: 'aptt', current: '1000', lab: '60', collected: '2026-03-04T09:00' };
const run = (input, overrides = {}) => calculate({ ...input, ...overrides }, now);
function blocked(input, overrides, code) {
  const result = run(input, overrides);
  assert.equal(result.ok, false);
  assert.equal(result.code, code);
  assert.equal('doseRate' in result, false);
  assert.equal(formatNote(result), null);
}

test('standard initiation, documented bolus caps and ACS starting cap', () => {
  const vte = run(base);
  assert.deepEqual([vte.rawBolus, vte.bolus, vte.doseRate, vte.pumpRate], [5600, 5000, 1260, 25.2]);
  const acs = run(base, { protocol: 'acs' });
  assert.deepEqual([acs.bolus, acs.doseRate, acs.capped], [4000, 840, false]);
  const capped = run(base, { protocol: 'acs', weight: '100', concentration: '40' });
  assert.deepEqual([capped.rawRate, capped.doseRate, capped.delivered, capped.capped], [1200, 1000, 1000, true]);
  assert.equal(run(base, { protocol: 'high' }).bolus, 0);
  blocked(tit, { protocol: 'high' }, 'protocol');
});

test('decimal aPTT follows explicit inequalities for both protocols', () => {
  const cases = {
    vte: [['39.99', 3], ['40', 2], ['49.99', 2], ['50', 1], ['59.99', 1], ['60', 0], ['100', 0], ['100.01', -1], ['120', -1], ['120.01', -2], ['150', -2], ['150.01', null]],
    acs: [['39.99', 2], ['40', 1], ['49.99', 1], ['50', 0], ['70', 0], ['70.01', -1], ['90', -1], ['90.01', -2], ['120', -2], ['120.01', null]],
  };
  for (const [protocol, rows] of Object.entries(cases)) {
    for (const [lab, factor] of rows) {
      if (factor === null) blocked(tit, { protocol, lab }, 'critical');
      else assert.equal(run(tit, { protocol, lab }).factor, factor, `${protocol} ${lab}`);
    }
  }
  const high = run(tit, { lab: '130' });
  assert.deepEqual([high.high, high.holdMinutes, high.doseRate], [true, 30, 860]);
  assert.equal(run(tit, { lab: '40', weight: '100' }).bolus, 3000);
});

test('no-change preserves a running rate; unsafe changes are blocked', () => {
  const unchanged = run(tit, { current: '1003.27' });
  assert.deepEqual([unchanged.doseRate, unchanged.delivered, unchanged.pumpRate], [1003.27, 1003.27, null]);
  blocked(tit, { current: '0' }, 'current');
  blocked(tit, { lab: '145', current: '100' }, 'nonpositive');
  blocked(tit, { ceiling: '999' }, 'currentAboveCeiling');
  blocked(tit, { lab: '55', ceiling: '1050' }, 'aboveCeiling');
  blocked(base, { weight: '31.66', concentration: '40', ceiling: '570' }, 'pumpAboveCeiling');
  blocked(base, { weight: '30.28', ceiling: '545' }, 'aboveCeiling');
});

test('requires explicit inputs and rejects malformed or unsafe measurements', () => {
  for (const weight of ['', ' ', '-30', '0', 'NaN', 'Infinity', '1e2', '0x50', '70kg', '29.99', '200.01', '70.123', 70]) blocked(base, { weight }, 'weight');
  assert.equal(run(base, { weight: '30' }).ok, true);
  assert.equal(run(base, { weight: '200', ceiling: '5000' }).ok, true);
  for (const [field, value, code] of [['basis', '', 'basis'], ['ceiling', '', 'ceiling'], ['concentration', '55', 'concentration'], ['confirm', false, 'confirm'], ['protocol', 'constructor', 'protocol']]) blocked(base, { [field]: value }, code);
  for (const lab of ['', '0', '-12', 'text', '1e2', '9.99']) blocked(tit, { lab }, 'aptt');
  for (const collected of ['', '2026-02-29T10:00', '2026-03-04T12:31', '2026-03-04T24:00']) blocked(tit, { collected }, 'collected');
  blocked(tit, { lab: '301' }, 'critical');
});

test('critical and HIT safety stops, and anti-Xa never returns an aPTT dose', () => {
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

test('note uses only the calculated snapshot and labels dates and units', () => {
  const note = formatNote(run(tit, { lab: '55', basis: 'adjusted', plateletReference: '220', plateletCurrent: '200' }));
  assert.match(note, /^SIMULATION DRAFT — NOT AN ORDER/);
  assert.match(note, /2026-03-04T12:30:00.000Z.*audit-demo-1/);
  assert.match(note, /70 kg \(adjusted\)/);
  assert.match(note, /aPTT: 55 s.*2026-03-04T09:00:00.000Z/);
  assert.match(note, /220 → 200/);
  assert.match(note, /1000 → 1070 units\/h/);
  assert.match(note, /21.4 mL\/h/);
});
