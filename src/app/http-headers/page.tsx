"use client";
import { useMemo, useState } from "react";
import { Network } from "lucide-react";
import styles from "../json-yaml/tool.module.css";
export default function Page(){const [raw,setRaw]=useState("Content-Type: application/json\nAuthorization: Bearer token");const parsed=useMemo(()=>raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(l=>{const i=l.indexOf(":");return i===-1?{k:"",v:l}:{k:l.slice(0,i).trim(),v:l.slice(i+1).trim()};}),[raw]);
return <div className={`${styles.container} pageShell`}><header className="toolHeader"><div className="toolTitleRow"><span className="toolIconBadge"><Network size={20}/></span><div><h2 className="toolTitle">HTTP Header Inspector</h2><p className="toolSubtitle">Parse raw HTTP headers into key/value rows.</p></div></div></header><section className={styles.grid}><textarea className={styles.area} value={raw} onChange={e=>setRaw(e.target.value)}/><div className="panel" style={{padding:'1rem'}}>{parsed.map((h,idx)=><div key={idx}><strong>{h.k||"(invalid)"}</strong>: {h.v}</div>)}</div></section></div>}
