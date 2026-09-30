/** Defines renderer UI behavior and presentation for the desktop chat workspace. */
/* 中文：定义桌面聊天工作区的渲染层界面和交互行为。 */
import type { ProviderView } from '../../../../../packages/shared/src/index';
/** Implements one focused part of this module’s public responsibility. */
/* 中文：实现本模块职责中的一项具体操作。 */
export function ModelPicker({
  providers,
  value,
  disabled,
  onChange,
}: {
  providers: ProviderView[];
  value: string;
  disabled: boolean;
  onChange(id: string): void;
}) {
  const remote = providers.find((p) => p.id === value)?.fastgpt;
  return (
    <div className="model-selector">
      <span className="model-dot" />
      <select
        aria-label={remote ? '当前远程应用' : '当前模型'}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {!providers.length && <option value="">尚未配置模型</option>}
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <span className="local-badge">{remote ? 'FastGPT' : 'LOCAL'}</span>
    </div>
  );
}
