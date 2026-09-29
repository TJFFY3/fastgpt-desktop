import { AppError, relativePathSchema } from "../../shared/src/index";
export const immutableImage=(image:string)=>/^sha256:[a-f0-9]{64}$/.test(image);
export function containerArgs(image:string,owner:string):string[]{
  if(!immutableImage(image))throw new AppError("IMAGE_UNTRUSTED","只允许已验证的不可变镜像");if(!/^[a-f0-9-]{36}$/.test(owner))throw new AppError("INVALID_INPUT","容器归属无效");
  const proxies=["HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","NO_PROXY","FTP_PROXY","http_proxy","https_proxy","all_proxy","no_proxy","ftp_proxy"].flatMap(key=>["--env",`${key}=`]);
  return ["create","--name",`fastgpt-${owner}`,"--label",`org.fastgpt.desktop.owner=${owner}`,"--pull","never","--network","none","--user","1000:1000","--read-only","--cap-drop","ALL","--security-opt","no-new-privileges:true","--memory","1g","--memory-swap","1g","--pids-limit","128","--cpus","2","--log-driver","none","--cgroupns","private","--ipc","private","--init","--tmpfs","/workspace:rw,nosuid,nodev,size=1073741824,nr_inodes=16384,mode=0700,uid=1000,gid=1000","--tmpfs","/tmp:rw,nosuid,nodev,noexec,size=67108864,nr_inodes=4096,mode=1777","--env","HOME=/tmp","--env","LANG=C.UTF-8","--env","PATH=/usr/local/bin:/usr/bin:/bin","--env","PYTHONDONTWRITEBYTECODE=1",...proxies,image,"/usr/bin/python3","-I","/opt/fastgpt/runner.py","idle"];
}
export function localEndpoint(endpoint:string):boolean{return /^unix:\/\/\/[^\x00-\x1f]+$/.test(endpoint)||/^npipe:\/\/\/\/\.\/pipe\/[a-zA-Z0-9_-]+$/.test(endpoint);}
export function assertCapabilities(value:unknown):void {
  const v=value as Record<string,unknown>|null;if(!v||v.OSType!=="linux"||v.CgroupVersion!=="2"||["MemoryLimit","SwapLimit","PidsLimit","CpuCfsQuota"].some(k=>v[k]!==true)||!Array.isArray(v.SecurityOptions)||!v.SecurityOptions.includes("name=seccomp,profile=builtin")||!v.SecurityOptions.includes("name=cgroupns"))throw new AppError("SANDBOX_UNAVAILABLE","容器引擎未证明必需的 Linux 资源和安全限制");
}
export function sandboxPath(path:string):string {if(!relativePathSchema.safeParse(path).success||path!==path.normalize("NFC")||path.split("/").some(p=>/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw new AppError("UNSAFE_PATH","沙箱相对路径无效");return path;}
