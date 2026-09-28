import { useEffect, useState } from "react";
export function useCommandTimer(runId:string,callId:string,terminal:boolean,finishedMs?:number):number {
  const [sample,setSample]=useState({key:`${runId}:${callId}`,ms:finishedMs??0});
  useEffect(()=>{let alive=true,base=finishedMs??0,anchor=performance.now(),active=false;const key=`${runId}:${callId}`;setSample({key,ms:base});
    const update=async()=>{try{const next=await window.desktop.sandbox.timing(runId,callId);if(!alive||finishedMs!==undefined)return;base=Math.max(base,next.elapsedMs);anchor=performance.now();active=next.active&&!terminal;setSample({key,ms:base});}catch{/* no authority to estimate before a main-owned sample */}};void update();
    const timer=!terminal&&finishedMs===undefined?setInterval(()=>{setSample({key,ms:base+(active?Math.max(0,performance.now()-anchor):0)});void update();},500):undefined;return()=>{alive=false;if(timer)clearInterval(timer);};
  },[runId,callId,terminal,finishedMs]);return sample.key===`${runId}:${callId}`?sample.ms:finishedMs??0;
}
