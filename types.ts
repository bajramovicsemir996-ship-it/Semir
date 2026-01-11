
export interface DashboardData {
  headers: string[];
  rows: any[];
  summary: string;
  charts: ChartConfig[];
  metrics: Metric[];
}

export interface ChartConfig {
  id: string;
  type: 'bar' | 'line' | 'pie' | 'area';
  title: string;
  xAxis: string;
  yAxis: string;
}

export interface Metric {
  label: string;
  value: string | number;
  change?: string;
  isPositive?: boolean;
}

export interface AnalysisState {
  loading: boolean;
  error: string | null;
  data: DashboardData | null;
  step: 'upload' | 'map' | 'analyze';
}

export const REQUIRED_COLUMNS = [
  "Plant Name",
  "Chronic Issue",
  "Failures Description",
  "Action Plan",
  "Class",
  "Duration Loss",
  "Frequency",
  "Category",
  "Progress",
  "Completion",
  "Start Time",
  "End Time"
] as const;

export type RequiredColumn = typeof REQUIRED_COLUMNS[number];

export interface ColumnMapping {
  [key: string]: string; // key is RequiredColumn, value is the Excel header name
}
