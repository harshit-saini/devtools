import type { Metadata } from "next"; import { createRouteMetadata } from "@/lib/routeMetadata";
export const metadata: Metadata = createRouteMetadata({ title:"JSON to YML", description:"Convert JSON to YAML locally.", canonicalPath:"/json-yaml"});
export default function L({children}:{children:React.ReactNode}){return children;}
