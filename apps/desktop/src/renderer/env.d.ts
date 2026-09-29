/** Provides the env module for the desktop application. */
import type { DesktopApi } from '../../../../packages/shared/src/index';
declare global {
  /** Describes the window contract used by this module. */
  interface Window {
    desktop: DesktopApi;
  }
}
