export type ReportCell = string | number | null;

export type ReportColumn = {
  key: string;
  label: string;
  /** Peso relativo del ancho en el PDF. */
  width?: number;
  align?: "left" | "right";
};

/** Un reporte es una tabla principal más metadatos; CSV y PDF se generan desde la misma estructura. */
export type Report = {
  title: string;
  fileName: string;
  meta: Array<[string, string]>;
  summary?: Array<[string, string]>;
  columns: ReportColumn[];
  rows: Array<Record<string, ReportCell>>;
  notes: string[];
};
