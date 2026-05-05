import type { Metadata } from "next"; import { createRouteMetadata } from "@/lib/routeMetadata";
export const metadata: Metadata = createRouteMetadata({ title:"URL Parser", description:"Parse and inspect URLs locally.", canonicalPath:"/url-parser"});
export default function L({children}:{children:React.ReactNode}){return children;}
