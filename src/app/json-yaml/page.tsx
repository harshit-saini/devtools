"use client";
import { useState } from "react";
import { ArrowRightLeft, FileJson } from "lucide-react";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";
import styles from "./tool.module.css";

function toYaml(value: unknown, indent = 0): string {
  const space = "  ".repeat(indent);
  if (Array.isArray(value)) return value.map((v) => `${space}- ${toYaml(v, indent + 1).trimStart()}`).join("\n");
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([k,v])=>`${space}${k}: ${typeof v === "object" && v !== null ? `\n${toYaml(v, indent+1)}` : String(v)}`).join("\n");
  return `${value ?? "null"}`;
}
export default function Page(){const {containerRef,isFullscreen,fullscreenSupported,toggleFullscreen}=useToolFullscreen<HTMLDivElement>();const [json,setJson]=useState('{\n  "name": "theme",\n  "colors": ["#111827", "#60a5fa"]\n}');const [yaml,setYaml]=useState("");const [error,setError]=useState("");
const convert=()=>{try{setYaml(toYaml(JSON.parse(json)));setError("");}catch{setError("Invalid JSON input.");}};
return <div ref={containerRef} className={`${styles.container} pageShell ${isFullscreen?"toolFullscreen":""}`}><header className="toolHeader"><div className="toolTitleRow"><span className="toolIconBadge"><FileJson size={20}/></span><div><h2 className="toolTitle">JSON to YML</h2><p className="toolSubtitle">Convert JSON into readable YAML locally.</p></div></div><div className={styles.actions}><ToolFullscreenButton isFullscreen={isFullscreen} onToggle={toggleFullscreen} supported={fullscreenSupported}/><button className="btn btnSecondary" onClick={convert}><ArrowRightLeft size={14}/>Convert</button></div></header>{error&&<div className="statusChip">{error}</div>}<section className={styles.grid}><textarea className={styles.area} value={json} onChange={e=>setJson(e.target.value)} /><textarea className={styles.area} value={yaml} readOnly /></section></div>}
