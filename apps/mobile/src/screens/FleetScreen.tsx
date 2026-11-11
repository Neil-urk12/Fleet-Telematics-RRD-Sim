import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { Vehicle, VehicleUpdate } from "@fleet/api-client";
import { colors } from "../constants/theme";
import { VehicleCard } from "../components/VehicleCard";
import { ErrorBanner } from "../components/ErrorBanner";

const TEXT_FIELDS = [
  { key: "id", label: "Vehicle ID", hint: "Unique, e.g. EV-101" },
  { key: "name", label: "Name", hint: "Display name, e.g. Delivery van 1" },
  { key: "model", label: "Make & model", hint: "e.g. Tesla Model 3" },
] as const;

const NUMBER_FIELDS = [
  { key: "battery_capacity_kwh", label: "Battery capacity (kWh)", hint: "Usable pack size, e.g. 75", min: 0, max: Infinity, minInclusive: false },
  { key: "baseline_efficiency_wh_km", label: "Efficiency (Wh/km)", hint: "Typical use, e.g. 160", min: 0, max: Infinity, minInclusive: false },
  { key: "current_soc", label: "Current charge (%)", hint: "State of charge, 0–100", min: 0, max: 100, minInclusive: true },
  { key: "current_soh", label: "Battery health (%)", hint: "State of health, 0–100", min: 0, max: 100, minInclusive: true },
  { key: "curb_mass_kg", label: "Curb mass (kg)", hint: "Unloaded weight", min: 0, max: Infinity, minInclusive: false },
  { key: "regen_efficiency", label: "Regen efficiency (0–1)", hint: "Share of downhill energy recovered", min: 0, max: 1, minInclusive: true },
] as const;

const STATUSES = ["AVAILABLE", "IN_USE", "CHARGING", "MAINTENANCE"];

type NumberKey = typeof NUMBER_FIELDS[number]["key"];
type FieldKey = typeof TEXT_FIELDS[number]["key"] | NumberKey;
type Draft = Record<FieldKey, string>;

const EMPTY_DRAFT: Draft = {
  id: "", name: "", model: "",
  battery_capacity_kwh: "", baseline_efficiency_wh_km: "",
  current_soc: "80", current_soh: "100", curb_mass_kg: "2500", regen_efficiency: "0.6",
};

const numberOf = (v: Vehicle, key: NumberKey) => v[key] ?? Number(EMPTY_DRAFT[key]);

const draftFrom = (v: Vehicle): Draft => ({
  id: v.id,
  name: v.name,
  model: v.model,
  ...Object.fromEntries(NUMBER_FIELDS.map(({ key }) => [key, String(numberOf(v, key))])) as Record<NumberKey, string>,
});

function validateVehicleDraft(draft: Draft, takenIds: string[]): Partial<Record<FieldKey, string>> {
  const errors: Partial<Record<FieldKey, string>> = {};
  for (const { key, label } of TEXT_FIELDS) {
    if (!draft[key].trim()) errors[key] = `${label} is required.`;
  }
  if (!errors.id && takenIds.includes(draft.id.trim())) {
    errors.id = "A vehicle with this ID already exists.";
  }
  for (const { key, min, max, minInclusive } of NUMBER_FIELDS) {
    const raw = draft[key].trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value)) errors[key] = "Enter a number.";
    else if (minInclusive ? value < min : value <= min) {
      errors[key] = minInclusive ? `Must be at least ${min}.` : `Must be greater than ${min}.`;
    } else if (value > max) {
      errors[key] = `Must be at most ${max}.`;
    }
  }
  return errors;
}

export interface FleetScreenProps {
  vehicles: Vehicle[];
  selectedVehicle: Vehicle | null;
  loading?: boolean;
  error?: string | null;
  dataStatus?: "demo" | "live" | "cached";
  onSelectVehicle: (vehicle: Vehicle) => void;
  onRefresh?: () => void;
  onSimulateWithVehicle?: (vehicle: Vehicle) => void;
  refreshing?: boolean;
  onNavigateTab?: (tab: any) => void;
  onUpdateVehicle?: (vehicleId: string, payload: VehicleUpdate) => Promise<Vehicle>;
  onDeleteVehicle?: (vehicleId: string) => Promise<void>;
}

export const FleetScreen: React.FC<FleetScreenProps> = ({
  vehicles,
  selectedVehicle,
  error,
  dataStatus = "demo",
  onSelectVehicle,
  onRefresh,
  refreshing = false,
  onNavigateTab,
  onUpdateVehicle,
  onDeleteVehicle,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const editingVehicle = vehicles.find((v) => v.id === editingId) ?? null;
  const canSubmit = dataStatus === "live";

  const filteredVehicles = vehicles.filter((v) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      v.id.toLowerCase().includes(q) ||
      v.name.toLowerCase().includes(q) ||
      v.model.toLowerCase().includes(q)
    );
  });

  return (
    <KeyboardAvoidingView
      style={styles.keyboardContainer}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accentCyan}
              colors={[colors.accentCyan]}
              progressBackgroundColor={colors.bgSurface}
            />
          ) : undefined
        }
      >
        {/* Page Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Vehicles</Text>
          <Text style={styles.subtitle}>Register vehicles and browse the fleet.</Text>
        </View>

        {error && <ErrorBanner message={error} onRetry={onRefresh ?? (() => {})} />}

        {/* Top Section: VehicleForm (when editing) or Fleet Garage CTA */}
        {editingVehicle ? (
          <MobileVehicleForm
            key={editingVehicle.id}
            editing={editingVehicle}
            vehicles={vehicles}
            canSubmit={canSubmit}
            onUpdate={onUpdateVehicle}
            onStopEditing={() => setEditingId(null)}
          />
        ) : (
          <View style={styles.garageCtaCard}>
            <View style={styles.garageCtaTop}>
              <View style={styles.garageIconWrap}>
                <MaterialCommunityIcons name="garage" size={24} color={colors.accentCyan} />
              </View>
              <View style={styles.garageCtaTextWrap}>
                <Text style={styles.garageCtaTitle}>Fleet garage</Text>
                <Text style={styles.garageCtaSubtitle}>
                  {vehicles.length === 0
                    ? "The garage is empty. Open it to register your first vehicle."
                    : "Add new vehicles and look over the fleet in 3D."}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.openGarageBtn,
                vehicles.length === 0 && !canSubmit && styles.btnDisabled,
              ]}
              disabled={vehicles.length === 0 && !canSubmit}
              onPress={() => onNavigateTab?.("garage")}
              activeOpacity={0.8}
            >
              <Text style={styles.openGarageBtnText}>Open garage</Text>
              <MaterialCommunityIcons name="arrow-right" size={16} color="#0a0e17" />
            </TouchableOpacity>

            {!canSubmit && (
              <Text style={styles.fieldHint}>
                Connect to the fleet backend to add vehicles.
              </Text>
            )}
          </View>
        )}

        {/* Middle Section: Vehicle Actions for Selected Vehicle */}
        {selectedVehicle && (
          <MobileVehicleActions
            key={selectedVehicle.id}
            vehicle={selectedVehicle}
            canSubmit={canSubmit}
            isEditing={editingId === selectedVehicle.id}
            onEdit={() => setEditingId(selectedVehicle.id)}
            onDelete={onDeleteVehicle}
          />
        )}

        {/* Bottom Section: Fleet Panel & Vehicle List */}
        <View style={styles.fleetPanel}>
          <View style={styles.fleetPanelHeader}>
            <Text style={styles.fleetPanelTitle}>VEHICLES</Text>
            <View style={styles.panelBadge}>
              <Text style={styles.panelBadgeText}>
                {filteredVehicles.length} OF {vehicles.length} SHOWN
              </Text>
            </View>
          </View>

          {/* Search container */}
          <View style={styles.searchBar}>
            <MaterialCommunityIcons
              name="magnify"
              size={18}
              color={colors.textMuted}
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Search Vehicles"
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialCommunityIcons name="close-circle" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Vehicle List */}
          <View style={styles.fleetList}>
            {filteredVehicles.length > 0 ? (
              filteredVehicles.map((v) => (
                <VehicleCard
                  key={v.id}
                  vehicle={v}
                  isSelected={v.id === selectedVehicle?.id}
                  onSelect={onSelectVehicle}
                />
              ))
            ) : (
              <View style={styles.emptySearch}>
                <Text style={styles.emptySearchText}>
                  {vehicles.length === 0
                    ? "No vehicles registered yet."
                    : `No vehicle found with ID "${searchQuery}"`}
                </Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export const VehiclesScreen = FleetScreen;

// ── Mobile Vehicle Form ───────────────────────────────────────────────────────
function MobileVehicleForm({
  editing,
  vehicles,
  canSubmit,
  onUpdate,
  onStopEditing,
}: {
  editing: Vehicle;
  vehicles: Vehicle[];
  canSubmit: boolean;
  onUpdate?: (vehicleId: string, payload: VehicleUpdate) => Promise<Vehicle>;
  onStopEditing: () => void;
}) {
  const [baseline, setBaseline] = useState<Vehicle>(editing);
  const [draft, setDraft] = useState<Draft>(draftFrom(editing));
  const [status, setStatus] = useState<string>(editing.status ?? "AVAILABLE");
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const errors = validateVehicleDraft(
    draft,
    vehicles.map((v) => v.id).filter((id) => id !== baseline.id)
  );

  const changes = (base: Vehicle): VehicleUpdate => {
    const update: VehicleUpdate & Record<string, unknown> = {};
    if (draft.name.trim() !== base.name) update.name = draft.name.trim();
    if (draft.model.trim() !== base.model) update.model = draft.model.trim();
    for (const { key } of NUMBER_FIELDS) {
      if (Number(draft[key]) !== numberOf(base, key)) update[key] = Number(draft[key]);
    }
    if (status !== base.status) update.status = status;
    return update;
  };

  const handleSubmit = async () => {
    setShowErrors(true);
    setMessage(null);
    if (Object.keys(errors).length > 0 || submitting || !canSubmit) return;

    const update = changes(baseline);
    if (Object.keys(update).length === 0) {
      setMessage({ kind: "ok", text: "No changes to save." });
      return;
    }

    setSubmitting(true);
    try {
      if (onUpdate) {
        const vehicle = await onUpdate(baseline.id, update);
        setBaseline(vehicle);
        setMessage({ kind: "ok", text: `${vehicle.id} updated.` });
      }
    } catch (err) {
      setMessage({
        kind: "error",
        text: `Could not save changes: ${err instanceof Error ? err.message : "request failed"}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const renderField = (
    key: FieldKey,
    label: string,
    hint: string,
    numeric: boolean,
    locked = false
  ) => {
    const errorText = showErrors ? errors[key] : undefined;
    return (
      <View style={styles.fieldGroup} key={key}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TextInput
          style={[
            styles.textInput,
            locked && styles.textInputLocked,
            !!errorText && styles.textInputError,
          ]}
          value={draft[key]}
          editable={!locked}
          keyboardType={numeric ? "decimal-pad" : "default"}
          onChangeText={(val) => setDraft((d) => ({ ...d, [key]: val }))}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {errorText ? (
          <Text style={styles.fieldErrorText}>{errorText}</Text>
        ) : (
          <Text style={styles.fieldHint}>{locked ? "IDs can't be changed" : hint}</Text>
        )}
      </View>
    );
  };

  return (
    <View style={styles.formCard}>
      <View style={styles.formHeader}>
        <Text style={styles.formTitle}>Edit {baseline.id}</Text>
        <Text style={styles.formSubtitle}>
          Only the fields you change are saved. Changing charge or health marks the battery state as manually entered.
        </Text>
      </View>

      {/* Text fields */}
      {TEXT_FIELDS.map((f) => renderField(f.key, f.label, f.hint, false, f.key === "id"))}

      {/* Status Picker Chips */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Status</Text>
        <View style={styles.statusChipsRow}>
          {STATUSES.map((s) => {
            const isSelected = status === s;
            return (
              <TouchableOpacity
                key={s}
                style={[styles.statusChip, isSelected && styles.statusChipSelected]}
                onPress={() => setStatus(s)}
                activeOpacity={0.7}
              >
                <Text style={[styles.statusChipText, isSelected && styles.statusChipTextSelected]}>
                  {s.replace("_", " ")}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.fieldHint}>Current operating status</Text>
      </View>

      {/* Numeric fields */}
      {NUMBER_FIELDS.map((f) => renderField(f.key, f.label, f.hint, true))}

      {/* Actions */}
      <View style={styles.formActions}>
        <TouchableOpacity
          style={[styles.saveBtn, (submitting || !canSubmit) && styles.btnDisabled]}
          disabled={submitting || !canSubmit}
          onPress={handleSubmit}
          activeOpacity={0.8}
        >
          <Text style={styles.saveBtnText}>
            {submitting ? "Saving…" : "Save changes"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.doneBtn}
          onPress={onStopEditing}
          activeOpacity={0.7}
        >
          <Text style={styles.doneBtnText}>Done editing</Text>
        </TouchableOpacity>

        {!canSubmit && (
          <Text style={styles.fieldHint}>
            Connect to the fleet backend to change vehicles.
          </Text>
        )}

        {message && (
          <Text
            style={[
              styles.feedbackText,
              message.kind === "ok" ? styles.feedbackOk : styles.feedbackError,
            ]}
          >
            {message.text}
          </Text>
        )}
      </View>
    </View>
  );
}

// ── Mobile Vehicle Actions ────────────────────────────────────────────────────
function MobileVehicleActions({
  vehicle,
  canSubmit,
  isEditing,
  onEdit,
  onDelete,
}: {
  vehicle: Vehicle;
  canSubmit: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onDelete?: (vehicleId: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete(vehicle.id);
    } catch (err) {
      setError(`Could not delete: ${err instanceof Error ? err.message : "request failed"}`);
      setDeleting(false);
    }
  };

  return (
    <View style={styles.actionsCard}>
      <View style={styles.actionsHeader}>
        <Text style={styles.actionsTitle}>SELECTED · {vehicle.id}</Text>
        <Text style={styles.actionsSubtitle}>
          {vehicle.name} · {vehicle.model}
        </Text>
      </View>

      {confirming ? (
        <View style={styles.confirmBox}>
          <Text style={styles.confirmText}>
            Delete {vehicle.id}? Its history and telemetry are removed; saved assessments are kept.
          </Text>
          <View style={styles.actionsButtonsRow}>
            <TouchableOpacity
              style={[styles.deleteConfirmBtn, deleting && styles.btnDisabled]}
              disabled={deleting}
              onPress={handleDelete}
              activeOpacity={0.8}
            >
              <Text style={styles.deleteConfirmBtnText}>
                {deleting ? "Deleting…" : `Delete ${vehicle.id}`}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.keepBtn}
              disabled={deleting}
              onPress={() => setConfirming(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.keepBtnText}>Keep</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.actionsButtonsRow}>
          <TouchableOpacity
            style={[styles.editBtn, (!canSubmit || isEditing) && styles.btnDisabled]}
            disabled={!canSubmit || isEditing}
            onPress={onEdit}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name="pencil-outline"
              size={16}
              color={!canSubmit || isEditing ? colors.textMuted : colors.accentCyan}
              style={{ marginRight: 6 }}
            />
            <Text
              style={[
                styles.editBtnText,
                (!canSubmit || isEditing) && { color: colors.textMuted },
              ]}
            >
              {isEditing ? "Editing" : "Edit"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.deleteBtn, !canSubmit && styles.btnDisabled]}
            disabled={!canSubmit}
            onPress={() => setConfirming(true)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name="trash-can-outline"
              size={16}
              color={!canSubmit ? colors.textMuted : "#fca5a5"}
              style={{ marginRight: 6 }}
            />
            <Text
              style={[
                styles.deleteBtnText,
                !canSubmit && { color: colors.textMuted },
              ]}
            >
              Delete
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {error && <Text style={styles.fieldErrorText}>{error}</Text>}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  keyboardContainer: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
  header: {
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },

  // Fleet Garage CTA Card
  garageCtaCard: {
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderColor,
    borderStyle: "dashed",
    padding: 16,
    marginBottom: 12,
  },
  garageCtaTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  garageIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: colors.bgSurfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  garageCtaTextWrap: {
    flex: 1,
  },
  garageCtaTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 2,
  },
  garageCtaSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  openGarageBtn: {
    backgroundColor: colors.accentCyan,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  openGarageBtnText: {
    color: "#0a0e17",
    fontWeight: "700",
    fontSize: 13,
  },
  garageHint: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 8,
  },

  // Vehicle Actions Card
  actionsCard: {
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderColor,
    padding: 14,
    marginBottom: 12,
  },
  actionsHeader: {
    marginBottom: 12,
  },
  actionsTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.accentCyan,
    fontFamily: "monospace",
    letterSpacing: 0.5,
  },
  actionsSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  actionsButtonsRow: {
    flexDirection: "row",
    gap: 8,
  },
  editBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.accentCyan,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  editBtnText: {
    color: colors.accentCyan,
    fontWeight: "700",
    fontSize: 13,
  },
  deleteBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.4)",
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  deleteBtnText: {
    color: "#fca5a5",
    fontWeight: "700",
    fontSize: 13,
  },
  confirmBox: {
    backgroundColor: colors.bgSurfaceAlt,
    borderRadius: 8,
    padding: 10,
  },
  confirmText: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 10,
  },
  deleteConfirmBtn: {
    flex: 1,
    backgroundColor: colors.accentRed,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteConfirmBtnText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 13,
  },
  keepBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderColor,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  keepBtnText: {
    color: colors.textSecondary,
    fontWeight: "600",
    fontSize: 13,
  },

  // Vehicle Form Card
  formCard: {
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderColor,
    padding: 14,
    marginBottom: 12,
  },
  formHeader: {
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderColor,
    paddingBottom: 10,
  },
  formTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  formSubtitle: {
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 15,
    marginTop: 4,
  },
  fieldGroup: {
    marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: 4,
  },
  textInput: {
    backgroundColor: colors.bgInput,
    borderWidth: 1,
    borderColor: colors.borderColor,
    borderRadius: 8,
    color: colors.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  textInputLocked: {
    opacity: 0.6,
    backgroundColor: colors.bgSurfaceAlt,
  },
  textInputError: {
    borderColor: colors.riskDanger,
  },
  fieldHint: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 3,
  },
  fieldErrorText: {
    fontSize: 11,
    color: colors.errorText,
    marginTop: 3,
  },
  statusChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginVertical: 4,
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.borderColor,
    backgroundColor: colors.bgSurfaceAlt,
  },
  statusChipSelected: {
    borderColor: colors.accentCyan,
    backgroundColor: "rgba(0, 194, 255, 0.12)",
  },
  statusChipText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  statusChipTextSelected: {
    color: colors.accentCyan,
    fontWeight: "700",
  },
  formActions: {
    marginTop: 12,
    gap: 8,
  },
  saveBtn: {
    backgroundColor: colors.accentCyan,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  saveBtnText: {
    color: "#0a0e17",
    fontWeight: "700",
    fontSize: 14,
  },
  doneBtn: {
    borderWidth: 1,
    borderColor: colors.borderColor,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  doneBtnText: {
    color: colors.textSecondary,
    fontWeight: "600",
    fontSize: 13,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  feedbackText: {
    fontSize: 12,
    marginTop: 4,
  },
  feedbackOk: {
    color: colors.accentGreen,
  },
  feedbackError: {
    color: colors.errorText,
  },

  // Fleet Panel & Search
  fleetPanel: {
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderColor,
    padding: 14,
  },
  fleetPanelHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  fleetPanelTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textPrimary,
    letterSpacing: 0.5,
  },
  panelBadge: {
    backgroundColor: colors.badgeBg,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  panelBadgeText: {
    color: colors.badgeText,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bgInput,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderColor,
    paddingHorizontal: 10,
    height: 38,
    marginBottom: 12,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 13,
    padding: 0,
  },
  fleetList: {
    gap: 8,
  },
  emptySearch: {
    paddingVertical: 20,
    alignItems: "center",
  },
  emptySearchText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
  },
});
