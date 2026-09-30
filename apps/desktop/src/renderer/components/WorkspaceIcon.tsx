/** Shared line icons for workspace navigation and actions. */
/* 中文：为工作空间导航和操作提供统一的线性图标。 */
export type WorkspaceIconName =
  | 'home'
  | 'grid'
  | 'book'
  | 'history'
  | 'star'
  | 'search'
  | 'arrow'
  | 'settings'
  | 'chat'
  | 'help'
  | 'file'
  | 'close';

/* 中文：使用本地 SVG 路径绘制图标，不依赖外部字体或图片服务。 */
export function WorkspaceIcon({ name, size = 18 }: { name: WorkspaceIconName; size?: number }) {
  const paths: Record<WorkspaceIconName, string> = {
    home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    book: 'M3 5h4l1 14H4a1 1 0 0 1-1-1ZM10 4h4v15h-4ZM16 6l3-.6 2 13.6-3 .6Z',
    history: 'M12 3a9 9 0 1 1-9 9 9 9 0 0 1 9-9ZM12 7v5l3 2',
    star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
    search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    arrow: 'M4 12h16m-6-6 6 6-6 6',
    settings:
      'm9 3-.5 3-2.5 1.5-3-.5-1.5 3 2.5 2v3l-2.5 2 1.5 3 3-.5 2.5 1.5.5 3h4l.5-3 2.5-1.5 3 .5 1.5-3-2.5-2v-3l2.5-2-1.5-3-3 .5L13.5 6 13 3ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    chat: 'M4 4h16v12H9l-5 4ZM8 8h8M8 12h5',
    help: 'M12 17h.01M9.5 9a2.5 2.5 0 1 1 4 2c-1 .5-1.5 1-1.5 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    file: 'M14 2H5v20h14V7ZM14 2v6h5M8 12h8M8 16h6',
    close: 'm6 6 12 12M18 6 6 18',
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
