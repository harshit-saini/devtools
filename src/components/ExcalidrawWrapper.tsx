"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Download, FileUp, RotateCcw, Save } from "lucide-react";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import styles from "./ExcalidrawWrapper.module.css";

const Excalidraw = dynamic(
  async () => {
    const mod = await import("@excalidraw/excalidraw");
    return mod.Excalidraw;
  },
  {
    ssr: false,
    loading: () => <div className={styles.loader}>Loading canvas...</div>,
  },
);

const SCENE_KEY = "devtools.draw.scene";
const SAVED_AT_KEY = "devtools.draw.savedAt";
type UpdateSceneInput = Parameters<ExcalidrawImperativeAPI["updateScene"]>[0];
type StoredScene = {
  elements: ExcalidrawInitialDataState["elements"];
  appState: ExcalidrawInitialDataState["appState"];
  files: ExcalidrawInitialDataState["files"];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractStoredScene(value: unknown): StoredScene | null {
  if (!isObject(value)) {
    return null;
  }

  if (!("elements" in value)) {
    return null;
  }

  return {
    elements: (value as StoredScene).elements,
    appState: sanitizeLoadedAppState((value as StoredScene).appState),
    files: (value as StoredScene).files,
  };
}

function sanitizeLoadedAppState(
  appState: ExcalidrawInitialDataState["appState"],
): ExcalidrawInitialDataState["appState"] {
  if (!isObject(appState)) {
    return appState;
  }

  const candidate = appState as Record<string, unknown>;
  const collaborators = candidate.collaborators;

  if (collaborators === undefined || collaborators instanceof Map) {
    return appState;
  }

  return {
    ...(candidate as object),
    collaborators: new Map(),
  } as ExcalidrawInitialDataState["appState"];
}

function toStorableAppState(
  appState: AppState | ExcalidrawInitialDataState["appState"],
): ExcalidrawInitialDataState["appState"] {
  if (!isObject(appState)) {
    return appState as ExcalidrawInitialDataState["appState"];
  }

  const clone = { ...(appState as Record<string, unknown>) };
  delete clone.collaborators;
  return clone as ExcalidrawInitialDataState["appState"];
}

function readStoredScene(): StoredScene | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(SCENE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return extractStoredScene(JSON.parse(raw));
  } catch {
    return null;
  }
}

function readSavedAt(): number | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(SAVED_AT_KEY);
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatSavedAt(value: number | null): string {
  if (!value) {
    return "No autosave yet";
  }

  return `Saved at ${new Date(value).toLocaleTimeString()}`;
}

type SceneElements = NonNullable<ExcalidrawInitialDataState["elements"]>;
function hasVisibleElements(elements: ExcalidrawInitialDataState["elements"] | undefined | null): boolean {
  if (!elements || elements.length === 0) {
    return false;
  }

  return elements.some((element) => !element.isDeleted);
}

export default function ExcalidrawWrapper() {
  const initialData = useMemo(() => readStoredScene(), []);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const skipNextPersistRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [lastSavedAt, setLastSavedAt] = useState<number | null>(() => readSavedAt());
  const [canRestore, setCanRestore] = useState(hasVisibleElements(initialData?.elements));
  const [notice, setNotice] = useState("");

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setNotice("");
    }, 1800);

    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const persistScene = (
    elements: SceneElements,
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      try {
        const payload: StoredScene = {
          elements,
          appState: toStorableAppState(appState),
          files,
        };

        window.localStorage.setItem(SCENE_KEY, JSON.stringify(payload));
        const now = Date.now();
        window.localStorage.setItem(SAVED_AT_KEY, String(now));
        setLastSavedAt(now);
        setCanRestore(hasVisibleElements(elements));
      } catch {
        setNotice("Autosave failed");
      }
    }, 600);
  };

  const applyScene = async (scene: StoredScene, successNotice: string) => {
    const api = apiRef.current;
    if (!api) {
      setNotice("Canvas is still loading");
      return;
    }

    try {
      const { restore } = await import("@excalidraw/excalidraw");
      const restored = restore(scene, null, null);

      const updatePayload: UpdateSceneInput = {
        elements: restored.elements,
        appState: restored.appState as UpdateSceneInput["appState"],
      };

      skipNextPersistRef.current = true;
      api.updateScene(updatePayload);
      api.addFiles(Object.values(restored.files));

      const storedScene: StoredScene = {
        elements: restored.elements,
        appState: toStorableAppState(restored.appState),
        files: restored.files,
      };

      window.localStorage.setItem(SCENE_KEY, JSON.stringify(storedScene));
      const now = Date.now();
      window.localStorage.setItem(SAVED_AT_KEY, String(now));
      setLastSavedAt(now);
      setCanRestore(hasVisibleElements(restored.elements));
      setNotice(successNotice);
    } catch {
      setNotice("Could not load that scene");
    }
  };

  const handleExport = async () => {
    const api = apiRef.current;
    if (!api) {
      setNotice("Canvas is still loading");
      return;
    }

    try {
      const { serializeAsJSON } = await import("@excalidraw/excalidraw");
      const serialized = serializeAsJSON(
        api.getSceneElements(),
        api.getAppState(),
        api.getFiles(),
        "local",
      );

      const blob = new Blob([serialized], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "diagram.excalidraw";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setNotice("Could not export scene");
    }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const api = apiRef.current;
    if (!api) {
      setNotice("Canvas is still loading");
      event.target.value = "";
      return;
    }

    try {
      const text = await file.text();
      const parsedScene = extractStoredScene(JSON.parse(text));
      if (!parsedScene) {
        setNotice("Could not import that scene file");
        return;
      }

      await applyScene(parsedScene, `Imported ${file.name}`);
    } catch {
      setNotice("Could not import that scene file");
    } finally {
      event.target.value = "";
    }
  };

  const handleRestore = async () => {
    const api = apiRef.current;
    if (!api) {
      setNotice("Canvas is still loading");
      return;
    }

    const savedScene = readStoredScene();
    if (!savedScene) {
      setNotice("No saved scene found");
      setCanRestore(false);
      return;
    }

    await applyScene(savedScene, "Saved scene restored");
  };

  const handleClear = () => {
    const api = apiRef.current;
    if (!api) {
      setNotice("Canvas is still loading");
      return;
    }

    if (!window.confirm("Clear the whole drawing canvas?")) {
      return;
    }

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    skipNextPersistRef.current = true;
    api.resetScene();
    window.localStorage.removeItem(SCENE_KEY);
    window.localStorage.removeItem(SAVED_AT_KEY);
    setLastSavedAt(null);
    setCanRestore(false);
    setNotice("Canvas cleared");
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        <div className={styles.metaGroup}>
          <span className="statusChip">Autosave enabled</span>
          <span className="statusChip">{formatSavedAt(lastSavedAt)}</span>
          {notice && <span className={styles.notice}>{notice}</span>}
        </div>

        <div className={styles.actions}>
          <button className="btn btnSecondary" onClick={() => fileInputRef.current?.click()}>
            <FileUp size={15} />
            Import
          </button>
          <button className="btn btnSecondary" onClick={handleExport}>
            <Download size={15} />
            Export
          </button>
          <button className="btn btnSecondary" onClick={handleRestore} disabled={!canRestore}>
            <Save size={15} />
            Restore
          </button>
          <button className="btn btnDanger" onClick={handleClear}>
            <RotateCcw size={15} />
            Clear
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".excalidraw,.json"
            className={styles.hiddenInput}
            onChange={handleImport}
          />
        </div>
      </div>

      <div className={styles.canvasArea}>
        <Excalidraw
          excalidrawAPI={(api) => {
            apiRef.current = api;
          }}
          initialData={initialData ?? undefined}
          onChange={(elements, appState, files) => {
            persistScene(elements as SceneElements, appState, files);
          }}
          theme="light"
        />
      </div>
    </div>
  );
}
