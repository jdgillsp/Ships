// A second touch may not synthesize a click while the primary thumb is held.
// Equipment controls still need ordinary click/keyboard behavior for other inputs.
export function secondaryTouchActivation(button) {
  let held = null, activated = null;
  button.addEventListener('pointerdown', event => {
    if (event.isPrimary) activated = null;
    if (event.pointerType !== 'touch' || event.isPrimary || button.disabled || held) return;
    held = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    button.setPointerCapture(event.pointerId); event.preventDefault();
  });
  button.addEventListener('pointermove', event => {
    if (held?.id === event.pointerId && Math.hypot(event.clientX - held.x, event.clientY - held.y) > 10) held.moved = true;
  });
  button.addEventListener('pointerup', event => {
    if (held?.id !== event.pointerId) return;
    const touch = held; held = null; event.preventDefault();
    const rect = button.getBoundingClientRect();
    if (touch.moved || button.disabled || !button.checkVisibility() || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    activated = { id: event.pointerId, time: performance.now() };
    button.click();
  });
  const cancel = event => { if (held?.id === event.pointerId) held = null; };
  button.addEventListener('pointercancel', cancel); button.addEventListener('lostpointercapture', cancel);
  // Suppress a delayed native click if a browser also emits one for this touch.
  button.addEventListener('click', event => {
    if (event.isTrusted && activated?.id === event.pointerId && performance.now() - activated.time < 700) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
}
