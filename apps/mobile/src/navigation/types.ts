export type TabType =
  | "dashboard"
  | "vehicles"
  | "garage"
  | "planner"
  | "route"
  | "battery"
  // Legacy aliases
  | "fleet"
  | "simulator"
  | "alerts"
  | "more";

export interface TabItem {
  id: TabType;
  label: string;
  icon: string;
  badgeCount?: number;
}
