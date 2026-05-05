"use client";
import { useMemo, useState } from "react";
import { Clock3 } from "lucide-react";
import styles from "../json-yaml/tool.module.css";
const DEFAULT_EPOCH = "1700000000";
const DEFAULT_ISO = "2023-11-14T22:13:20.000Z";
export default function Page(){const [epoch,setEpoch]=useState(DEFAULT_EPOCH);const date=useMemo(()=>{const n=Number(epoch);if(!Number.isFinite(n)) return "Invalid";return new Date(n*1000).toISOString();},[epoch]);const [iso,setIso]=useState(DEFAULT_ISO);const unix=useMemo(()=>{const t=Date.parse(iso);return Number.isNaN(t)?"Invalid":String(Math.floor(t/1000));},[iso]);
return <div className={`${styles.container} pageShell`}><header className="toolHeader"><div className="toolTitleRow"><span className="toolIconBadge"><Clock3 size={20}/></span><div><h2 className="toolTitle">Time Converter</h2><p className="toolSubtitle">Convert Unix timestamp and ISO date/time instantly.</p></div></div></header><section className={styles.grid}><div className="panel" style={{padding:'1rem'}}><h3>Unix → ISO</h3><input value={epoch} onChange={e=>setEpoch(e.target.value)} className={styles.area}/><p>{date}</p></div><div className="panel" style={{padding:'1rem'}}><h3>ISO → Unix</h3><input value={iso} onChange={e=>setIso(e.target.value)} className={styles.area}/><p>{unix}</p></div></section></div>}
