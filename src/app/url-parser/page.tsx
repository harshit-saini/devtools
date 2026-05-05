"use client";
import { useMemo, useState } from "react";
import { Link2 } from "lucide-react";
import styles from "../json-yaml/tool.module.css";
export default function Page(){const [urlText,setUrlText]=useState('https://example.com:8080/path?a=1&b=2#top');const parsed=useMemo(()=>{try{return new URL(urlText);}catch{return null;}},[urlText]);
return <div className={`${styles.container} pageShell`}><header className="toolHeader"><div className="toolTitleRow"><span className="toolIconBadge"><Link2 size={20}/></span><div><h2 className="toolTitle">URL Parser / Builder</h2><p className="toolSubtitle">Break URLs into parts and inspect query params.</p></div></div></header><div className="panel" style={{padding:'1rem',display:'grid',gap:'0.5rem'}}><textarea className={styles.area} value={urlText} onChange={e=>setUrlText(e.target.value)} />{parsed?<><div>Protocol: {parsed.protocol}</div><div>Host: {parsed.host}</div><div>Pathname: {parsed.pathname}</div><div>Hash: {parsed.hash||'-'}</div><div>Query: {parsed.search||'-'}</div></>:<div>Invalid URL</div>}</div></div>}
