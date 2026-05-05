import type { Metadata } from "next"; import { createRouteMetadata } from "@/lib/routeMetadata";
export const metadata: Metadata = createRouteMetadata({ title:"Color Theme Picker", description:"Pick colors and generate website theme variables.", canonicalPath:"/color-tools"});
export default function L({children}:{children:React.ReactNode}){return children;}
