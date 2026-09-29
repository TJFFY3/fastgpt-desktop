import { expect, test } from "vitest";
import { containerArgs, localEndpoint, assertCapabilities, sandboxPath } from "../src/policy";
const image="sha256:"+"a".repeat(64),owner="11111111-1111-4111-8111-111111111111";
test("fixed create policy has real quotas and no host mounts, network, privileges or extra swap",()=>{
  const args=containerArgs(image,owner);for(const [flag,value]of [["--network","none"],["--user","1000:1000"],["--cap-drop","ALL"],["--memory","1g"],["--memory-swap","1g"],["--pids-limit","128"],["--cpus","2"],["--log-driver","none"],["--cgroupns","private"],["--ipc","private"],["--pull","never"]])expect(args[args.indexOf(flag)+1]).toBe(value);
  expect(args).toContain("--read-only");expect(args).toContain("no-new-privileges:true");expect(args).toContain("/workspace:rw,nosuid,nodev,size=1073741824,nr_inodes=16384,mode=0700,uid=1000,gid=1000");
  expect(args.some(a=>a.includes("/tmp:rw,nosuid,nodev,noexec,size=67108864"))).toBe(true);for(const flag of ["--privileged","--mount","-v","--volume","--publish","--device","--pid"])expect(args).not.toContain(flag);
  expect(args).toContain(image);expect(()=>containerArgs("node:latest",owner)).toThrow(expect.objectContaining({code:"IMAGE_UNTRUSTED"}));expect(()=>containerArgs(image,"../../bad")).toThrow();
  for(const key of ["HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","NO_PROXY","FTP_PROXY","http_proxy","https_proxy","all_proxy","no_proxy","ftp_proxy"])expect(args).toContain(`${key}=`);
});
test("only local socket endpoints and proven Linux cgroup/seccomp capabilities are accepted",()=>{
  expect(localEndpoint("unix:///var/run/docker.sock")).toBe(true);expect(localEndpoint("npipe:////./pipe/dockerDesktopLinuxEngine")).toBe(true);for(const endpoint of ["tcp://127.0.0.1:2375","ssh://server","http://server","npipe:////server/pipe/docker_engine"])expect(localEndpoint(endpoint)).toBe(false);
  const info={OSType:"linux",CgroupVersion:"2",MemoryLimit:true,SwapLimit:true,PidsLimit:true,CpuCfsQuota:true,SecurityOptions:["name=seccomp,profile=builtin","name=cgroupns"]};expect(()=>assertCapabilities(info)).not.toThrow();expect(()=>assertCapabilities({...info,SwapLimit:false})).toThrow(expect.objectContaining({code:"SANDBOX_UNAVAILABLE"}));
});
test.each(["../../secret","/root","a//b","a\\b","CON.txt","e\u0301","tail."])("rejects path %s",path=>expect(()=>sandboxPath(path)).toThrow(expect.objectContaining({code:"UNSAFE_PATH"})));
