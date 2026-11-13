const HANDLE = '[data-lineup-drag]';
const DROP = '[data-lineup-drop]';
const SCROLL_ZONE = '[data-lineup-scroll]';
const DROP_CLASSES = ['is-lineup-drop-valid', 'is-lineup-drop-invalid', 'is-lineup-drop-after'];

function scrollDelta(y, top, bottom, margin) {
  if (y < top + margin) return -Math.ceil(19 * Math.min(1, (top + margin - y) / margin));
  if (y > bottom - margin) return Math.ceil(19 * Math.min(1, (y - bottom + margin) / margin));
  return 0;
}

export function wireLineupDrag(root, { getFeedback, onDrop }) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  let drag;
  let suppressClick = false;

  function hitTest(x, y) {
    const hovered = doc.elementFromPoint(x, y);
    const zone = hovered?.closest(DROP);
    if (!zone || !root.contains(zone)) return {};
    const { lineupDrop: role, dropPosition: position, dropPlayer: playerId } = zone.dataset;
    const bounds = zone.getBoundingClientRect();
    return { zone, target: { role, position, playerId, after: role === 'reserve' && !!playerId && y > bounds.top + bounds.height / 2 } };
  }

  function highlight({ zone, target }) {
    if (drag.zone !== zone) drag.zone?.classList.remove(...DROP_CLASSES);
    drag.zone = zone;
    if (!zone) return;
    const allowed = !!getFeedback(drag.id, target);
    zone.classList.toggle(DROP_CLASSES[0], allowed);
    zone.classList.toggle(DROP_CLASSES[1], !allowed);
    zone.classList.toggle(DROP_CLASSES[2], target.after);
  }

  function finish() {
    const previous = drag;
    drag = undefined;
    if (!previous?.ghost) return;
    win.cancelAnimationFrame(previous.frame);
    previous.ghost.remove();
    previous.handle.classList.remove('is-lineup-drag-source');
    previous.zone?.classList.remove(...DROP_CLASSES);
    root.classList.remove('is-lineup-dragging');
    if (root.hasPointerCapture(previous.pointerId)) root.releasePointerCapture(previous.pointerId);
  }

  function autoscroll() {
    if (!drag?.ghost) return;
    if (!drag.handle.isConnected) {
      finish();
      return;
    }
    const { x, y } = drag;
    const area = doc.elementFromPoint(x, y)?.closest(SCROLL_ZONE);
    let scrolled = false;
    if (area && root.contains(area)) {
      const bounds = area.getBoundingClientRect();
      const delta = scrollDelta(y, bounds.top, bounds.bottom, Math.min(38, bounds.height / 4));
      const before = area.scrollTop;
      if (delta) area.scrollTop += delta;
      scrolled = area.scrollTop !== before;
    }
    if (!scrolled && x >= 0 && x < win.innerWidth) {
      const delta = scrollDelta(y, 0, win.innerHeight, 58);
      if (delta) {
        const before = win.scrollY;
        win.scrollBy({ top: delta, behavior: 'instant' });
        scrolled = before !== win.scrollY;
      }
    }
    if (scrolled) highlight(hitTest(x, y));
    drag.frame = win.requestAnimationFrame(autoscroll);
  }

  doc.addEventListener('pointerdown', event => {
    if (event.isPrimary && !drag) suppressClick = false;
  }, true);
  root.addEventListener('pointerdown', event => {
    const handle = event.target.closest(HANDLE);
    if (!handle || handle.disabled || drag || !event.isPrimary || event.button !== 0) return;
    const { clientX: x, clientY: y, pointerId, pointerType } = event;
    drag = { handle, id: handle.dataset.lineupDrag, x, y, pointerId, threshold: pointerType === 'touch' ? 9 : 5 };
  });
  doc.addEventListener('pointermove', event => {
    if (drag?.pointerId !== event.pointerId) return;
    const { clientX: x, clientY: y } = event;
    if (!drag.ghost) {
      if (Math.hypot(x - drag.x, y - drag.y) < drag.threshold) return;
      suppressClick = true;
      root.setPointerCapture(event.pointerId);
      drag.ghost = doc.createElement('div');
      drag.ghost.className = 'lineup-drag-ghost';
      drag.ghost.textContent = drag.handle.dataset.dragLabel || drag.handle.textContent.trim();
      drag.ghost.setAttribute('aria-hidden', 'true');
      Object.assign(drag.ghost.style, { position: 'fixed', pointerEvents: 'none' });
      doc.body.append(drag.ghost);
      drag.handle.classList.add('is-lineup-drag-source');
      root.classList.add('is-lineup-dragging');
      drag.frame = win.requestAnimationFrame(autoscroll);
    }
    event.preventDefault();
    drag.x = x;
    drag.y = y;
    drag.ghost.style.left = `${x}px`;
    drag.ghost.style.top = `${y}px`;
    highlight(hitTest(x, y));
  }, { passive: false });
  doc.addEventListener('pointerup', event => {
    if (drag?.pointerId !== event.pointerId) return;
    const { id, ghost } = drag;
    const { target } = ghost ? hitTest(event.clientX, event.clientY) : {};
    finish();
    if (target) onDrop(id, target);
  });
  doc.addEventListener('pointercancel', event => {
    if (drag?.pointerId === event.pointerId) finish();
  });
  root.addEventListener('lostpointercapture', event => {
    if (event.target === root && drag?.pointerId === event.pointerId) finish();
  });
  win.addEventListener('blur', finish);
  doc.addEventListener('keydown', event => {
    if (event.key === 'Escape') finish();
  });
  root.addEventListener('click', event => {
    if (!suppressClick || event.detail === 0) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}
