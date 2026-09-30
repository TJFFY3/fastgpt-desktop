/** Keeps keyboard focus within an open modal and returns it to the initiating control. */
/* 中文：弹窗打开后限制键盘焦点范围，关闭时恢复原焦点，并支持 Escape 退出。 */
import { useEffect, useRef, type RefObject } from 'react';

/* 中文：使用最新关闭回调和禁用状态，避免表单编辑期间重新初始化焦点。 */
export function useDialogFocus(
  container: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
  disabled = false,
) {
  const current = useRef({ onClose, disabled });
  current.current = { onClose, disabled };
  useEffect(() => {
    if (!open || !container.current) return;
    const dialog = container.current;
    const previous = document.activeElement;
    const elements = () =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ),
      ].filter((element) => element.getClientRects().length > 0);
    elements()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !current.current.disabled) {
        event.preventDefault();
        current.current.onClose();
      }
      if (event.key !== 'Tab') return;
      const focusable = elements();
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0],
        last = focusable.at(-1)!;
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [container, open]);
}
