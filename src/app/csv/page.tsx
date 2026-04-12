"use client";

import { useRef, useState, type DragEvent } from "react";
import Papa from "papaparse";
import { AgGridReact } from "ag-grid-react";
import { ClientSideRowModelModule, ModuleRegistry, type ColDef } from "ag-grid-community";
import { Download, Search, Table2, Trash2, UploadCloud } from "lucide-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import styles from "./csv.module.css";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";

ModuleRegistry.registerModules([ClientSideRowModelModule]);

type CsvCell = string | number | boolean | null;
type CsvRow = Record<string, CsvCell>;

function isUsefulRow(row: CsvRow): boolean {
  return Object.values(row).some((value) => String(value ?? "").trim().length > 0);
}

export default function CsvViewer() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } =
    useToolFullscreen<HTMLDivElement>();
  const [rowData, setRowData] = useState<CsvRow[]>([]);
  const [columnDefs, setColumnDefs] = useState<ColDef<CsvRow>[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [quickFilterText, setQuickFilterText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasData = rowData.length > 0;

  const handleFileUpload = (file: File) => {
    setParseError(null);

    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: "greedy",
      dynamicTyping: true,
      complete: (results) => {
        const cleanedRows = (results.data as CsvRow[]).filter((row) => row && isUsefulRow(row));

        if (cleanedRows.length === 0) {
          setRowData([]);
          setColumnDefs([]);
          setFileName(file.name);
          setParseError("No readable rows were found in this file.");
          return;
        }

        const headers = Array.from(new Set(cleanedRows.flatMap((row) => Object.keys(row))));

        const nextColumns: ColDef<CsvRow>[] = headers.map((header) => ({
          field: header,
          headerName: header,
          sortable: true,
          filter: true,
          floatingFilter: true,
          resizable: true,
          valueFormatter: (params) => (params.value == null ? "" : String(params.value)),
        }));

        setColumnDefs(nextColumns);
        setRowData(cleanedRows);
        setFileName(file.name);

        if (results.errors.length > 0) {
          setParseError(results.errors[0]?.message ?? "Some rows could not be parsed.");
        }
      },
      error: (error) => {
        setParseError(error.message);
      },
    });
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);

    const droppedFile = event.dataTransfer.files?.[0];
    if (!droppedFile) {
      return;
    }

    if (!droppedFile.name.toLowerCase().endsWith(".csv")) {
      setParseError("Please upload a .csv file.");
      return;
    }

    handleFileUpload(droppedFile);
  };

  const clearData = () => {
    setRowData([]);
    setColumnDefs([]);
    setFileName("");
    setParseError(null);
    setQuickFilterText("");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const downloadJson = () => {
    if (!hasData) {
      return;
    }

    const blob = new Blob([JSON.stringify(rowData, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName ? fileName.replace(/\.csv$/i, ".json") : "rows.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      ref={containerRef}
      className={`${styles.container} pageShell animate-enter ${isFullscreen ? "toolFullscreen" : ""}`}
    >
      <header className="toolHeader">
        <div>
          <div className="toolTitleRow">
            <span className="toolIconBadge">
              <Table2 size={22} />
            </span>
            <div>
              <h2 className="toolTitle">CSV Viewer</h2>
              <p className="toolSubtitle">Load CSV data into a sortable grid with filters and quick search.</p>
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <ToolFullscreenButton
            isFullscreen={isFullscreen}
            onToggle={toggleFullscreen}
            supported={fullscreenSupported}
          />
          {hasData && (
            <button className="btn btnSecondary" onClick={downloadJson}>
              <Download size={15} />
              Export JSON
            </button>
          )}
          {hasData && (
            <button className="btn btnDanger" onClick={clearData}>
              <Trash2 size={15} />
              Close file
            </button>
          )}
        </div>
      </header>

      {hasData ? (
        <>
          <div className="toolMetaRow">
            <span className="statusChip">File: {fileName}</span>
            <span className="statusChip">Rows: {rowData.length}</span>
            <span className="statusChip">Columns: {columnDefs.length}</span>
            {parseError && <span className={styles.errorChip}>Parse note: {parseError}</span>}
          </div>

          <label className={styles.searchWrap}>
            <Search size={16} className={styles.searchIcon} />
            <input
              className={styles.searchInput}
              placeholder="Filter rows"
              value={quickFilterText}
              onChange={(event) => setQuickFilterText(event.target.value)}
            />
          </label>

          <section className={`${styles.gridCard} panel`}>
            <div className={`${styles.gridTheme} ag-theme-quartz`}>
              <AgGridReact<CsvRow>
                rowData={rowData}
                columnDefs={columnDefs}
                quickFilterText={quickFilterText}
                defaultColDef={{
                  flex: 1,
                  minWidth: 120,
                }}
                rowSelection="multiple"
                animateRows
                pagination
                paginationPageSize={100}
                paginationPageSizeSelector={[25, 50, 100, 250]}
                sideBar={{
                  toolPanels: ["columns", "filters"],
                }}
              />
            </div>
          </section>
        </>
      ) : (
        <section
          className={`${styles.uploadCard} panel ${isDragging ? styles.dragActive : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              fileInputRef.current?.click();
            }
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className={styles.hiddenInput}
            onChange={(event) => {
              const selectedFile = event.target.files?.[0];
              if (selectedFile) {
                handleFileUpload(selectedFile);
              }
            }}
          />

          <UploadCloud size={44} className={styles.uploadIcon} />
          <h3 className={styles.uploadTitle}>Drop a CSV file here</h3>
          <p className={styles.uploadText}>or click to choose one from your device.</p>
          {parseError && <p className={styles.uploadError}>{parseError}</p>}
        </section>
      )}
    </div>
  );
}
