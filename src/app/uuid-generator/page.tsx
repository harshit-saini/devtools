"use client";
import { useState } from "react";
import { Fingerprint } from "lucide-react";
import styles from "../json-yaml/tool.module.css";
export default function Page(){const [count,setCount]=useState(5);const [items,setItems]=useState<string[]>([]);const gen=()=>setItems(Array.from({length:count},()=>crypto.randomUUID()));
return <div className={`${styles.container} pageShell`}><header className="toolHeader"><div className="toolTitleRow"><span className="toolIconBadge"><Fingerprint size={20}/></span><div><h2 className="toolTitle">UUID Generator</h2><p className="toolSubtitle">Generate secure UUID v4 values in-browser.</p></div></div></header><div className="panel" style={{padding:'1rem'}}><input type="number" min={1} max={100} value={count} onChange={e=>setCount(Number(e.target.value)||1)}/><button className="btn btnSecondary" onClick={gen}>Generate</button><textarea className={styles.area} value={items.join('\n')} readOnly/></div></div>}
