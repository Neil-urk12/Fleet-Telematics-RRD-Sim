import React, { useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors } from "../constants/theme";
import { Header } from "../components";
import { API_URL, client } from "../config/api";

interface MoreScreenProps {
  onRefreshBackend: () => void;
  refreshing?: boolean;
}

export const MoreScreen: React.FC<MoreScreenProps> = ({
  onRefreshBackend,
  refreshing = false,
}) => {
  const [pingStatus, setPingStatus] = useState<"idle" | "testing" | "success" | "fail">("idle");
  const [useMetric, setUseMetric] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [hapticFeedback, setHapticFeedback] = useState(true);

  const handleTestPing = async () => {
    setPingStatus("testing");
    try {
      await client.getVehicles();
      setPingStatus("success");
      onRefreshBackend();
    } catch {
      setPingStatus("fail");
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleTestPing}
          tintColor={colors.accentPrimary}
          colors={[colors.accentPrimary]}
          progressBackgroundColor={colors.bgSurface}
        />
      }
    >
      <Header
        title="Settings & System"
        subtitle="Telematics Configuration & Diagnostics"
      />

      {/* Backend Connection Diagnostic */}
      <View style={styles.sectionCard}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Backend API Status</Text>
          <View
            style={[
              styles.statusDot,
              pingStatus === "fail"
                ? styles.statusDotRed
                : styles.statusDotGreen,
            ]}
          />
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Server URL</Text>
          <Text style={styles.infoVal}>{API_URL}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>FastAPI Engine</Text>
          <Text style={styles.infoVal}>Uvicorn v0.34 (Port 8000)</Text>
        </View>

        <TouchableOpacity
          style={styles.pingButton}
          onPress={handleTestPing}
          disabled={pingStatus === "testing"}
        >
          <MaterialCommunityIcons
            name={
              pingStatus === "success"
                ? "check-network-outline"
                : pingStatus === "fail"
                ? "close-network-outline"
                : "network-strength-4"
            }
            size={18}
            color={
              pingStatus === "fail"
                ? colors.riskDanger
                : colors.accentPrimary
            }
            style={{ marginRight: 8 }}
          />
          <Text style={styles.pingButtonText}>
            {pingStatus === "testing"
              ? "Testing Connection..."
              : pingStatus === "success"
              ? "Connection Verified (Healthy)"
              : pingStatus === "fail"
              ? "Connection Failed (Check IP)"
              : "Test API Ping"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Simulation Engine Specs */}
      <View style={styles.sectionCard}>
        <Text style={styles.cardTitle}>Physics Engine Specifications</Text>

        <View style={styles.specItem}>
          <MaterialCommunityIcons name="wind-turbine" size={20} color={colors.accentPrimary} />
          <View style={styles.specTextCol}>
            <Text style={styles.specName}>Aerodynamic Drag</Text>
            <Text style={styles.specDesc}>0.5 * rho * Cd * A * v^2 with ambient air density</Text>
          </View>
        </View>

        <View style={styles.specItem}>
          <MaterialCommunityIcons name="tire" size={20} color={colors.accentPrimary} />
          <View style={styles.specTextCol}>
            <Text style={styles.specName}>Rolling Resistance</Text>
            <Text style={styles.specDesc}>Crr * mass * g with dynamic cargo payloads</Text>
          </View>
        </View>

        <View style={styles.specItem}>
          <MaterialCommunityIcons name="image-filter-hdr" size={20} color={colors.accentPrimary} />
          <View style={styles.specTextCol}>
            <Text style={styles.specName}>Potential Energy (Gradient)</Text>
            <Text style={styles.specDesc}>delta_h * mass * g ascent draw with regen recovery</Text>
          </View>
        </View>

        <View style={styles.specItem}>
          <MaterialCommunityIcons name="air-conditioner" size={20} color={colors.accentPrimary} />
          <View style={styles.specTextCol}>
            <Text style={styles.specName}>Auxiliary & HVAC Cabin Load</Text>
            <Text style={styles.specDesc}>Ambient temperature-dependent thermal cycle draw</Text>
          </View>
        </View>
      </View>

      {/* Preferences */}
      <View style={styles.sectionCard}>
        <Text style={styles.cardTitle}>Preferences</Text>

        <View style={styles.prefRow}>
          <View>
            <Text style={styles.prefTitle}>Auto-Refresh Telematics</Text>
            <Text style={styles.prefDesc}>Poll fleet metrics periodically</Text>
          </View>
          <Switch
            value={autoRefresh}
            onValueChange={setAutoRefresh}
            trackColor={{ false: colors.border, true: colors.badgeBg }}
            thumbColor={autoRefresh ? colors.accentPrimary : colors.textMuted}
          />
        </View>

        <View style={styles.prefRow}>
          <View>
            <Text style={styles.prefTitle}>Metric Units (km, kWh)</Text>
            <Text style={styles.prefDesc}>Use SI metric system</Text>
          </View>
          <Switch
            value={useMetric}
            onValueChange={setUseMetric}
            trackColor={{ false: colors.border, true: colors.badgeBg }}
            thumbColor={useMetric ? colors.accentPrimary : colors.textMuted}
          />
        </View>

        <View style={styles.prefRow}>
          <View>
            <Text style={styles.prefTitle}>Haptic Feedback</Text>
            <Text style={styles.prefDesc}>Vibrate on simulation finish</Text>
          </View>
          <Switch
            value={hapticFeedback}
            onValueChange={setHapticFeedback}
            trackColor={{ false: colors.border, true: colors.badgeBg }}
            thumbColor={hapticFeedback ? colors.accentPrimary : colors.textMuted}
          />
        </View>
      </View>

      {/* App Info Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          EV Fleet Telematics & RRD Sim • v1.0.0
        </Text>
        <Text style={styles.footerSub}>Mobile Monorepo • React Native & Expo</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  sectionCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusDotGreen: {
    backgroundColor: colors.accentPrimary,
  },
  statusDotRed: {
    backgroundColor: colors.riskDanger,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  infoVal: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: "500",
  },
  pingButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgSurfaceAlt,
    borderRadius: 8,
    paddingVertical: 10,
    marginTop: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pingButtonText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
  specItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  specTextCol: {
    flex: 1,
  },
  specName: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: 2,
  },
  specDesc: {
    fontSize: 12,
    color: colors.textMuted,
  },
  prefRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  prefTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: 2,
  },
  prefDesc: {
    fontSize: 12,
    color: colors.textMuted,
  },
  footer: {
    alignItems: "center",
    marginTop: 10,
    marginBottom: 20,
  },
  footerText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  footerSub: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
});
