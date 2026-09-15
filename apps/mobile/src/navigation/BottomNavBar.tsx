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
  alertCount = 3,
}) => {
  const insets = useSafeAreaInsets();

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
      activeIcon: "view-dashboard",
      inactiveIcon: "view-dashboard-outline",
    },
    {
      id: "fleet",
      label: "Fleet",
      activeIcon: "car",
      inactiveIcon: "car-outline",
    },
    {
      id: "simulator",
      label: "Simulator",
      activeIcon: "leaf-circle",
      inactiveIcon: "leaf-circle-outline",
    },
    {
      id: "alerts",
      label: "Alerts",
      activeIcon: "bell",
      inactiveIcon: "bell-outline",
      showBadge: alertCount > 0,
    },
    {
      id: "more",
      label: "More",
      activeIcon: "menu",
      inactiveIcon: "menu",
    },
  ];

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom, 8) },
      ]}
    >
      <View style={styles.navRow}>
        {tabs.map((tab) => {
          const isActive = currentTab === tab.id;
          const iconColor = isActive ? colors.navActive : colors.navInactive;
          const iconName = isActive ? tab.activeIcon : tab.inactiveIcon;

          return (
            <TouchableOpacity
              key={tab.id}
              style={styles.tabItem}
              onPress={() => onSelectTab(tab.id)}
              activeOpacity={0.7}
            >
              <View style={styles.iconWrapper}>
                <MaterialCommunityIcons
                  name={iconName}
                  size={24}
                  color={iconColor}
                />
                {tab.showBadge && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {alertCount > 9 ? "9+" : alertCount}
                    </Text>
                  </View>
                )}
              </View>
              <Text
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
    backgroundColor: colors.navBg,
    borderTopWidth: 1,
    borderTopColor: colors.navBorder,
    paddingTop: 8,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
  },
  iconWrapper: {
    position: "relative",
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  tabLabel: {
    fontSize: 11,
    marginTop: 4,
    letterSpacing: 0.1,
  },
  badge: {
    position: "absolute",
    top: -3,
    right: -7,
    backgroundColor: colors.riskDanger,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: colors.navBg,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
  },
});
