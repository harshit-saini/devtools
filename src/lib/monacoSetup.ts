"use client";

import { loader } from "@monaco-editor/react";

let configurePromise: Promise<void> | null = null;

// By default @monaco-editor/react fetches Monaco from a CDN (cdn.jsdelivr.net) at runtime.
// Networks that block that host (corporate proxies, ad blockers, offline dev) leave every
// Monaco-based tool stuck on "Loading..." forever. Point the loader at the copy already
// bundled from node_modules instead, so nothing depends on that CDN being reachable.
//
// The dynamic import below must stay dynamic (not a static top-level import): monaco-editor
// touches `window` as soon as its module graph evaluates, which crashes Next.js's server-side
// prerender even inside a "use client" file, since client components are still rendered on the
// server for the initial HTML. Callers must await ensureMonacoConfigured() and only render
// <Editor>/<DiffEditor> once it resolves, so this always wins the race against
// @monaco-editor/react's own loader.init() call (which defaults to the CDN if it fires first).
export function ensureMonacoConfigured(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (!configurePromise) {
    configurePromise = import("monaco-editor").then((monaco) => {
      window.MonacoEnvironment = {
        getWorker(_workerId: string, label: string) {
          switch (label) {
            case "json":
              return new Worker(new URL("monaco-editor/esm/vs/language/json/json.worker", import.meta.url));
            case "css":
            case "scss":
            case "less":
              return new Worker(new URL("monaco-editor/esm/vs/language/css/css.worker", import.meta.url));
            case "html":
            case "handlebars":
            case "razor":
              return new Worker(new URL("monaco-editor/esm/vs/language/html/html.worker", import.meta.url));
            case "typescript":
            case "javascript":
              return new Worker(new URL("monaco-editor/esm/vs/language/typescript/ts.worker", import.meta.url));
            default:
              return new Worker(new URL("monaco-editor/esm/vs/editor/editor.worker", import.meta.url));
          }
        },
      };

      loader.config({ monaco });
    });
  }

  return configurePromise;
}
