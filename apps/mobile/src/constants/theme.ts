// Theme tokens aligned with DESIGN.md
export const colors = {
  // Dark mode primary palette
  bgBase: "#0D0D0D",
  bgSurface: "#1A1A1A",
  bgSurfaceAlt: "#242424",
  border: "#2E2E2E",
  borderSelected: "#2ECC71",
  bgSelected: "#1B3A2A",

  // Typography
  textPrimary: "#FFFFFF",
  textSecondary: "#B3B3B3",
  textMuted: "#7A7A7A",
  heading: "#E5E7EB",

  // Accents
  primary: "#2ECC71",
  accentPrimary: "#2ECC71",
  accentPrimaryHover: "#27AE60",
  accentPrimarySubtle: "#1B3A2A",
  primaryText: "#FFFFFF",

  // Badges & Pills
  badgeBg: "#1B3A2A",
  badgeText: "#2ECC71",

  // Status Colors (Route-Risk Classification)
  riskSafe: "#2ECC71",
  riskSafeText: "#2ECC71",
  riskSafeBg: "#133E26",
  riskCaution: "#F1C40F",
  riskCautionText: "#F1C40F",
  riskCautionBg: "#3D3408",
  riskDanger: "#E74C3C",
  riskDangerText: "#E74C3C",
  riskDangerBg: "#401714",
  info: "#3498DB",
  infoText: "#3498DB",
  infoBg: "#142F44",

  // Bottom Navigation
  navBg: "#111111",
  navBorder: "#222222",
  navActive: "#2ECC71",
  navInactive: "#6B7280",

  // Error alert
  errorBg: "#3F1818",
  errorText: "#FCA5A5",
  errorButtonBg: "#DC2626",
} as const;
