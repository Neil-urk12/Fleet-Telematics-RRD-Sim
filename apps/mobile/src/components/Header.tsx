import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors } from "../constants/theme";

interface HeaderProps {
  title?: string;
  subtitle?: string;
  showNavIcons?: boolean;
  onPressMenu?: () => void;
  onPressFilter?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  title = "EV Fleet Telematics",
  subtitle,
  showNavIcons = true,
  onPressMenu,
  onPressFilter,
}) => {
  return (
    <View style={styles.header}>
      {showNavIcons ? (
        <View style={styles.navRow}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={onPressMenu}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="menu" size={24} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={styles.titleContainer}>
            <Text style={styles.title}>{title}</Text>
            {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
          </View>

          <TouchableOpacity
            style={styles.iconButton}
            onPress={onPressFilter}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name="filter-variant"
              size={22}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        </View>
      ) : (
        <View>
          <Text style={styles.title}>{title}</Text>
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    marginBottom: 16,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: colors.bgSurfaceAlt,
  },
  titleContainer: {
    flex: 1,
    paddingHorizontal: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
});
