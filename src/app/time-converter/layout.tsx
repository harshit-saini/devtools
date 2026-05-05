import type { Metadata } from "next"; import { createRouteMetadata } from "@/lib/routeMetadata";
export const metadata: Metadata = createRouteMetadata({ title:"Time Converter", description:"Convert UNIX and ISO date values.", canonicalPath:"/time-converter"});
export default function L({children}:{children:React.ReactNode}){return children;}
