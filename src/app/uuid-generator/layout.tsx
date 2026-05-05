import type { Metadata } from "next"; import { createRouteMetadata } from "@/lib/routeMetadata";
export const metadata: Metadata = createRouteMetadata({ title:"UUID Generator", description:"Generate UUIDs locally with browser crypto.", canonicalPath:"/uuid-generator"});
export default function L({children}:{children:React.ReactNode}){return children;}
