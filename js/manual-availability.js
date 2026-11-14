const STATUS_LABELS = Object.freeze({
  out: 'Indisponibile',
  doubtful: 'In dubbio',
  suspended: 'Squalificato'
});
const MAX_REASON_LENGTH = 160;
const MAX_PLAYERS_PER_ROUND = 1000;
const VALID_ROUND = /^(?:[1-9]|[12][0-9]|3[0-8])$/;
const VALID_PLAYER_ID = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}._:-]{0,119}$/u;

function recordObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function validPlayerId(id) {
  return typeof id === 'string' && VALID_PLAYER_ID.test(id)
    && id !== 'prototype' && !Object.hasOwn(Object.prototype, id);
}

export function manualAvailabilityRecord(value) {
  if (!recordObject(value)) return null;
  const { status, reason, diffidato } = value;
  const validStatus = typeof status === 'string' && Object.hasOwn(STATUS_LABELS, status) ? status : null;
  const warned = diffidato === true;
  if (validStatus === null && !warned) return null;
  const description = typeof reason === 'string' ? reason.trim().slice(0, MAX_REASON_LENGTH) : '';
  return { status: validStatus, reason: description || null, diffidato: warned };
}

export function sanitizeManualAvailability(value) {
  const result = {};
  if (!recordObject(value)) return result;
  for (const [round, players] of Object.entries(value)) {
    if (!VALID_ROUND.test(round) || !recordObject(players)) continue;
    const accepted = [];
    for (const [id, entry] of Object.entries(players)) {
      if (!validPlayerId(id)) continue;
      const record = manualAvailabilityRecord(entry);
      if (record) accepted.push([id, record]);
      if (accepted.length >= MAX_PLAYERS_PER_ROUND) break;
    }
    if (accepted.length) result[round] = Object.fromEntries(accepted);
  }
  return result;
}

export function lineupManualLabel(value) {
  const record = manualAvailabilityRecord(value);
  if (!record) return '';
  return [STATUS_LABELS[record.status], record.diffidato ? 'Diffidato' : null].filter(Boolean).join(' · ');
}

export function renderManualAvailability({ player, round, record, html }) {
  if (!validPlayerId(player?.id) || !Number.isInteger(round) || !VALID_ROUND.test(String(round))) return '';
  const saved = manualAvailabilityRecord(record);
  return `<section class="dialog-section manual-availability" aria-labelledby="manual-availability-title">
    <h3 id="manual-availability-title">Disponibilità manuale · Giornata ${round}</h3>
    <form id="manual-availability" data-player-id="${html(player.id)}" data-round="${round}">
      <div class="form-fields">
        <label class="field-label">Disponibilità<select name="status">
          <option value="">Usa le fonti</option>
          ${Object.entries(STATUS_LABELS).map(([status, label]) =>
            `<option value="${status}"${saved?.status === status ? ' selected' : ''}>${label}</option>`).join('')}
        </select></label>
        <label class="field-label">Motivazione<input name="reason" type="text" maxlength="${MAX_REASON_LENGTH}" value="${html(saved?.reason ?? '')}"></label>
      </div>
      <div class="actions">
        <label><input type="checkbox" name="diffidato"${saved?.diffidato ? ' checked' : ''}> Diffidato</label>
        <button type="submit">Salva segnalazione</button>
      </div>
    </form>
  </section>`;
}
