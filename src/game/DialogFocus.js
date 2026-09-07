// Pointer interaction returns to movement; keyboard interaction returns to a
// visible control. A delayed close must never steal focus from a newer dialog.
export function dialogFocus(game, dialog) {
  let pointer = false;
  dialog.addEventListener('pointerdown', () => { pointer = true; });
  dialog.addEventListener('keydown', () => { pointer = false; });
  // A close event is queued. A fresh click back into the scene must win over
  // the earlier keyboard dismissal when that event eventually restores focus.
  window.addEventListener('pointerdown', () => { if (!dialog.open) pointer = true; }, { capture: true, passive: true });
  return (...candidates) => {
    if (game.dialogOpen()) return;
    if (pointer) {
      if (document.activeElement?.matches('button')) document.activeElement.blur();
      return;
    }
    candidates.find(button => button?.checkVisibility() && !button.disabled)?.focus({ preventScroll: true });
  };
}

// Keep keyboard navigation in the active modal, including at browser-chrome boundaries.
export function installDialogTabLoop(root) {
  root.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return;
    const dialog = event.target.closest('dialog[open]');
    if (!dialog) return;
    const controls = [...dialog.querySelectorAll('button,a[href],input,select,textarea,summary,[tabindex]')]
      .filter(element => !element.disabled && element.tabIndex >= 0 && element.checkVisibility());
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  });
}
