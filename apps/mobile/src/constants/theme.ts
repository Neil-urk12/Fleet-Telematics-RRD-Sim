// Theme tokens aligned with DESIGN.md and web index.css
export const colors = {
  // Web synced dark mode palette
  bgPrimary: "#0a0e17",
  bgSecondary: "#0d1321",
  bgPanel: "#111827",
  bgInput: "#1a2332",
  borderColor: "#1e2d3d",
  borderGlow: "rgba(0, 194, 255, 0.15)",

  // Classic/Fallback tokens
  bgBase: "#0a0e17",
  bgSurface: "#111827",
  bgSurfaceAlt: "#1a2332",
  border: "#1e2d3d",
  borderSelected: "#00c2ff",
  bgSelected: "#0e3048",

  // Typography
  textPrimary: "#e2e8f0",
  textSecondary: "#9aa8bd",
  textMuted: "#7f8a9c",
  heading: "#f8fafc",

  // Accents
  primary: "#00c2ff",
  accentPrimary: "#00c2ff",
  accentPrimaryHover: "#00a6db",
  accentPrimarySubtle: "#0e3048",
  accentCyan: "#00c2ff",
  accentGreen: "#10b981",
  accentRed: "#ef4444",
  accentYellow: "#f59e0b",
  accentOrange: "#f97316",
  primaryText: "#FFFFFF",

  // Badges & Pills
  badgeBg: "#0e3048",
  badgeText: "#00c2ff",

  // Status Colors (Route-Risk Classification)
  riskSafe: "#10b981",
  riskSafeText: "#10b981",
  riskSafeBg: "#063826",
  riskCaution: "#f59e0b",
  riskCautionText: "#f59e0b",
  riskCautionBg: "#3d2806",
  riskDanger: "#ef4444",
  riskDangerText: "#ef4444",
  riskDangerBg: "#3b1212",
  info: "#00c2ff",
  infoText: "#00c2ff",
  infoBg: "#0c283f",

  // Bottom Navigation
  navBg: "#0a0e17",
  navBorder: "#1e2d3d",
  navActive: "#00c2ff",
  navActiveBg: "#0e3048",
  navInactive: "#64748b",

  // Error alert
  errorBg: "#3b1212",
  errorText: "#fca5a5",
  errorButtonBg: "#dc2626",
} as const;
