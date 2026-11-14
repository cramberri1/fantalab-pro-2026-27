import assert from 'node:assert/strict';
import test from 'node:test';
import {
  lineupManualLabel, manualAvailabilityRecord, renderManualAvailability, sanitizeManualAvailability
} from '../js/manual-availability.js';

test('keeps absence and warning separate, with empty fields represented explicitly', () => {
  assert.equal(manualAvailabilityRecord({ status: '', reason: 'Nessuna segnalazione', diffidato: false }), null);
  assert.deepEqual(manualAvailabilityRecord({ status: 'invalid', diffidato: true }),
    { status: null, reason: null, diffidato: true });
  assert.deepEqual(manualAvailabilityRecord({ status: 'doubtful', reason: '  Allenamento a parte  ', diffidato: 'false' }),
    { status: 'doubtful', reason: 'Allenamento a parte', diffidato: false });
  assert.equal(lineupManualLabel({ status: 'suspended', diffidato: true }), 'Squalificato · Diffidato');
  assert.equal(manualAvailabilityRecord({ status: 'out', reason: 'x'.repeat(200) }).reason.length, 160);
});

test('imports only valid rounds and safe player IDs from a backup', () => {
  const raw = JSON.parse(`{
    "__proto__":{"polluted":true},
    "0":{"a":{"status":"out"}},
    "01":{"a":{"status":"out"}},
    "1":{"__proto__":{"status":"out"},"constructor":{"status":"out"},"bad id":{"status":"out"},
      "csv:torino:FWD:luís":{"status":"out","reason":"Infortunio"},"valid":{"status":"invalid"}},
    "2":[],
    "38":{"tb-123":{"status":null,"diffidato":true}},
    "39":{"a":{"status":"out"}}
  }`);
  const sanitized = sanitizeManualAvailability(raw);
  assert.deepEqual(sanitized, {
    1: { 'csv:torino:FWD:luís': { status: 'out', reason: 'Infortunio', diffidato: false } },
    38: { 'tb-123': { status: null, reason: null, diffidato: true } }
  });
  assert.equal(Object.getPrototypeOf(sanitized[1]), Object.prototype);
  assert.equal({}.polluted, undefined);
});

test('renders the round, current values and escaped reason in the player editor', () => {
  const html = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  const form = renderManualAvailability({
    player: { id: 'tb-123' }, round: 12, html,
    record: { status: 'suspended', reason: 'A "<B"', diffidato: true }
  });
  assert.match(form, /id="manual-availability" data-player-id="tb-123" data-round="12"/);
  assert.match(form, /name="status"/);
  assert.match(form, /value="suspended" selected>Squalificato/);
  assert.match(form, /name="reason" type="text" maxlength="160" value="A &quot;&lt;B&quot;"/);
  assert.match(form, /name="diffidato" checked/);
  assert.equal(renderManualAvailability({ player: { id: 'tb-123' }, round: 39, html }), '');
});
