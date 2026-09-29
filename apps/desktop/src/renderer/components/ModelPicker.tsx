import type { ProviderView } from "../../../../../packages/shared/src/index";
export function ModelPicker({providers,value,disabled,onChange}:{providers:ProviderView[];value:string;disabled:boolean;onChange(id:string):void}) {
  return <div className="model-selector"><span className="model-dot" />
    <select aria-label="当前模型" value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>
      {!providers.length && <option value="">尚未配置模型</option>}
      {providers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
    </select><span className="local-badge">LOCAL</span>
  </div>;
}
