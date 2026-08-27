import React from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps Tab/Shift+Tab focus cycling inside `containerRef` while `active`,
 * calls `onClose` on Escape, and restores focus to whatever was focused
 * before mount on cleanup.
 *
 * `@devdigest/ui`'s `Drawer` (vendor, do-not-touch — `src/vendor/ui/kit/Drawer.tsx`)
 * renders only the dialog chrome; it has no focus trap or Escape handling of
 * its own. This hook lives here (not in vendor/ui) because it is a
 * single-consumer concern for `PreviewDrawer` only (AC "keyboard-operable
 * Preview drawer with visible focus" + NFR accessibility).
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  active: boolean,
) {
  React.useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null,
      );

    const first = focusable()[0];
    (first ?? container).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusable();
      const firstEl = els[0];
      const lastEl = els[els.length - 1];
      if (!firstEl || !lastEl) return;
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [active, containerRef, onClose]);
}
