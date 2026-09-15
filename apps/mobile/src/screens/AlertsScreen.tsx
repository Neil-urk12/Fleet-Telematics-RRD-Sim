import React, { useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors } from "../constants/theme";
import { Header } from "../components";
import type { TabType } from "../navigation";

interface AlertItem {
  id: string;
  type: "CRITICAL" | "WARNING" | "INFO";
  title: string;
  message: string;
  vehicleName: string;
  timeAgo: string;
  isRead: boolean;
}

const initialAlerts: AlertItem[] = [
  {
    id: "a1",
    type: "CRITICAL",
    title: "Low SOC Route-Risk Predicted",
    message: "Projected arrival SOC is 8.4%, breaching minimum 15% safety reserve threshold on 120km route.",
    vehicleName: "Freight Runner B",
    timeAgo: "12m ago",
    isRead: false,
  },
  {
    id: "a2",
    type: "WARNING",
    title: "High Ambient Thermal Load",
    message: "Ambient temp at 35°C with HVAC HIGH increased auxiliary consumption by +2.8 kWh.",
    vehicleName: "Delivery Van A",
    timeAgo: "34m ago",
    isRead: false,
  },
  {
    id: "a3",
    type: "WARNING",
    title: "Steep Gradient Energy Impact",
    message: "Route segment has +520m continuous elevation gain; potential energy demand is exceeding baseline.",
    vehicleName: "Urban Cargo C",
    timeAgo: "1h ago",
    isRead: false,
  },
  {
    id: "a4",
    type: "INFO",
    title: "Optimal Regen Energy Harvest",
    message: "Vehicle recovered 3.8 kWh during descent phase (+14.2% energy efficiency boost).",
    vehicleName: "Delivery Van A",
    timeAgo: "2h ago",
    isRead: true,
  },
];

interface AlertsScreenProps {
  onNavigateTab: (tab: TabType) => void;
  refreshing?: boolean;
  onRefresh?: () => void;
}

export const AlertsScreen: React.FC<AlertsScreenProps> = ({
  onNavigateTab,
  refreshing = false,
  onRefresh,
}) => {
  const [alerts, setAlerts] = useState<AlertItem[]>(initialAlerts);
  const [filter, setFilter] = useState<"ALL" | "CRITICAL" | "WARNING" | "INFO">("ALL");

  const filteredAlerts = alerts.filter(
    (a) => filter === "ALL" || a.type === filter
  );

  const handleDismiss = (id: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, isRead: true } : a))
    );
  };

  const handleMarkAllRead = () => {
    setAlerts((prev) => prev.map((a) => ({ ...a, isRead: true })));
  };

  const getTypeStyles = (type: AlertItem["type"]) => {
    switch (type) {
      case "CRITICAL":
        return {
          icon: "alert-circle" as const,
          color: colors.riskDanger,
          bg: colors.riskDangerBg,
          label: "CRITICAL",
        };
      case "WARNING":
        return {
          icon: "alert" as const,
          color: colors.riskCaution,
          bg: colors.riskCautionBg,
          label: "WARNING",
        };
      case "INFO":
        return {
          icon: "information-outline" as const,
          color: colors.info,
          bg: colors.infoBg,
          label: "INFO",
        };
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accentPrimary}
            colors={[colors.accentPrimary]}
            progressBackgroundColor={colors.bgSurface}
          />
        ) : undefined
      }
    >
      <Header
        title="Telematics Alerts"
        subtitle="Safety Warnings & Route-Risk Notifications"
      />

      {/* Filter Chips & Mark All Read */}
      <View style={styles.topBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {(["ALL", "CRITICAL", "WARNING", "INFO"] as const).map((cat) => {
            const count =
              cat === "ALL"
                ? alerts.length
                : alerts.filter((a) => a.type === cat).length;
            return (
              <TouchableOpacity
                key={cat}
                style={[
                  styles.filterChip,
                  filter === cat && styles.filterChipActive,
                ]}
                onPress={() => setFilter(cat)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    filter === cat && styles.filterChipTextActive,
                  ]}
                >
                  {cat} ({count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <TouchableOpacity onPress={handleMarkAllRead} style={styles.markReadBtn}>
          <Text style={styles.markReadText}>Mark Read</Text>
        </TouchableOpacity>
      </View>

      {/* Alerts List */}
      {filteredAlerts.length === 0 ? (
        <View style={styles.emptyCard}>
          <MaterialCommunityIcons
            name="check-circle-outline"
            size={40}
            color={colors.accentPrimary}
          />
          <Text style={styles.emptyTitle}>All Clear</Text>
          <Text style={styles.emptyText}>No alerts matching this filter</Text>
        </View>
      ) : (
        filteredAlerts.map((alert) => {
          const typeStyle = getTypeStyles(alert.type);
          return (
            <View
              key={alert.id}
              style={[styles.alertCard, alert.isRead && styles.alertCardRead]}
            >
              <View style={styles.alertHeader}>
                <View style={styles.badgeRow}>
                  <View
                    style={[
                      styles.typeBadge,
                      { backgroundColor: typeStyle.bg },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={typeStyle.icon}
                      size={14}
                      color={typeStyle.color}
                      style={{ marginRight: 4 }}
                    />
                    <Text
                      style={[styles.typeBadgeText, { color: typeStyle.color }]}
                    >
                      {typeStyle.label}
                    </Text>
                  </View>
                  <Text style={styles.vehicleTag}>{alert.vehicleName}</Text>
                </View>

                <Text style={styles.timeText}>{alert.timeAgo}</Text>
              </View>

              <Text style={styles.alertTitle}>{alert.title}</Text>
              <Text style={styles.alertMessage}>{alert.message}</Text>

              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => onNavigateTab("simulator")}
                >
                  <MaterialCommunityIcons
                    name="leaf-circle-outline"
                    size={16}
                    color={colors.accentPrimary}
                  />
                  <Text style={styles.actionBtnText}>Simulate Fix</Text>
                </TouchableOpacity>

                {!alert.isRead && (
                  <TouchableOpacity
                    style={styles.dismissBtn}
                    onPress={() => handleDismiss(alert.id)}
                  >
                    <Text style={styles.dismissText}>Dismiss</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  filterRow: {
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.badgeBg,
    borderColor: colors.accentPrimary,
  },
  filterChipText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "500",
  },
  filterChipTextActive: {
    color: colors.accentPrimary,
    fontWeight: "700",
  },
  markReadBtn: {
    paddingLeft: 8,
  },
  markReadText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  alertCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  alertCardRead: {
    opacity: 0.6,
  },
  alertHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  typeBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  vehicleTag: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  timeText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  alertTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 4,
  },
  alertMessage: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: 12,
  },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  actionBtnText: {
    color: colors.accentPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
  dismissBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: colors.bgSurfaceAlt,
    borderRadius: 6,
  },
  dismissText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  emptyCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 12,
    padding: 32,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 20,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
    marginTop: 10,
    marginBottom: 4,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
  },
});
