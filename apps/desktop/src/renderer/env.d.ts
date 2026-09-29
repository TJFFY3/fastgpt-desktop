/** Defines renderer UI behavior and presentation for the desktop chat workspace. */
import type { DesktopApi } from '../../../../packages/shared/src/index';
declare global {
  /** Specifies the contract callers must satisfy at this module boundary. */
  interface Window {
    desktop: DesktopApi;
  }
}
