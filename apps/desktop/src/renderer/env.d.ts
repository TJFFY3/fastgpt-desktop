/** Defines renderer UI behavior and presentation for the desktop chat workspace. */
/* 中文：定义桌面聊天工作区的渲染层界面和交互行为。 */
import type { DesktopApi } from '../../../../packages/shared/src/index';
declare global {
  /** Specifies the contract callers must satisfy at this module boundary. */
  /* 中文：定义调用方在模块边界需要遵守的接口契约。 */
  interface Window {
    desktop: DesktopApi;
  }
}
