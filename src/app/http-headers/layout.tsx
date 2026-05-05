import type { Metadata } from "next"; import { createRouteMetadata } from "@/lib/routeMetadata";
export const metadata: Metadata = createRouteMetadata({ title:"HTTP Header Inspector", description:"Inspect and parse HTTP headers locally.", canonicalPath:"/http-headers"});
export default function L({children}:{children:React.ReactNode}){return children;}
