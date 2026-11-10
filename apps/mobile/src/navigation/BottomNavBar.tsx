import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../constants/theme";
import type { TabType } from "./types";

interface BottomNavBarProps {
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
  alertCount?: number;
}

export const BottomNavBar: React.FC<BottomNavBarProps> = ({
  currentTab,
  onSelectTab,
  alertCount = 0,
}) => {
  const insets = useSafeAreaInsets();

  // Normalize legacy tab names
  const activeNormalizedTab: TabType =
    currentTab === "fleet" ? "vehicles" :
    currentTab === "simulator" ? "planner" :
    currentTab;

  const tabs: {
    id: TabType;
    label: string;
    activeIcon: keyof typeof MaterialCommunityIcons.glyphMap;
    inactiveIcon: keyof typeof MaterialCommunityIcons.glyphMap;
    showBadge?: boolean;
  }[] = [
    {
      id: "dashboard",
      label: "Dashboard",
      activeIcon: "view-grid",
      inactiveIcon: "view-grid-outline",
    },
    {
      id: "vehicles",
      label: "Vehicles",
      activeIcon: "truck",
      inactiveIcon: "truck-outline",
    },
    {
      id: "garage",
      label: "Garage",
      activeIcon: "garage",
      inactiveIcon: "garage-open-variant",
    },
    {
      id: "planner",
      label: "Trip planner",
      activeIcon: "check-circle",
      inactiveIcon: "check-circle-outline",
    },
    {
      id: "route",
      label: "Route & charging",
      activeIcon: "map",
      inactiveIcon: "map-outline",
    },
    {
      id: "battery",
      label: "Battery",
      activeIcon: "battery-charging",
      inactiveIcon: "battery-charging-outline",
    },
  ];

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom, 6) },
      ]}
    >
      <View style={styles.navRow}>
        {tabs.map((tab) => {
          const isActive =
            activeNormalizedTab === tab.id || currentTab === tab.id;
          const iconColor = isActive ? colors.accentCyan : colors.navInactive;
          const iconName = isActive ? tab.activeIcon : tab.inactiveIcon;

          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tabItem, isActive && styles.tabItemActive]}
              onPress={() => onSelectTab(tab.id)}
              activeOpacity={0.7}
            >
              <View style={styles.iconWrapper}>
                <MaterialCommunityIcons
                  name={iconName}
                  size={20}
                  color={iconColor}
                />
                {tab.showBadge && alertCount > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {alertCount > 9 ? "9+" : alertCount}
                    </Text>
                  </View>
                )}
              </View>
              <Text
                numberOfLines={1}
                style={[
                  styles.tabLabel,
                  { color: iconColor, fontWeight: isActive ? "600" : "400" },
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.bgBase,
    borderTopWidth: 1,
    borderTopColor: colors.borderColor,
    paddingTop: 6,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRadius: 12,
  },
  tabItemActive: {
    backgroundColor: "rgba(0, 194, 255, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(0, 194, 255, 0.35)",
  },
  iconWrapper: {
    position: "relative",
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  tabLabel: {
    fontSize: 9.5,
    marginTop: 2,
    letterSpacing: 0.1,
    textAlign: "center",
  },
  badge: {
    position: "absolute",
    top: -3,
    right: -7,
    backgroundColor: colors.riskDanger,
    borderRadius: 8,
    minWidth: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
    borderWidth: 1.5,
    borderColor: colors.bgBase,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 8,
    fontWeight: "700",
  },
});
