import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { TelemetryEvent, Vehicle } from "@fleet/api-client";
import { colors } from "../constants/theme";
import {
  CHARGING_STATIONS,
  ELEVATION_PROFILE,
  ROUTE_DISTANCE_KM,
  ROUTE_GEOMETRY,
  ROUTE_WAYPOINTS,
} from "../manilaBaguioRoute";

interface RouteScreenProps {
  vehicles: Vehicle[];
  telemetry: Record<string, TelemetryEvent>;
  dataStatus: "demo" | "live" | "cached";
  selectedVehicle: Vehicle | null;
  onSelectVehicle: (vehicle: Vehicle) => void;
  onNavigateTab?: (tab: "vehicles" | "planner") => void;
}

const SPEEDS = [1, 2, 4, 8];
const TILE = 256;
const LABELLED = new Set(["Manila", "Baguio"]);

function worldPx(lat: number, lon: number, zoom: number) {
  const n = 2 ** zoom;
  const x = ((lon + 180) / 360) * n * TILE;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * TILE;
  return { x, y };
}

const CUMULATIVE = ROUTE_GEOMETRY.reduce<number[]>((cum, [lat, lon], i) => {
  if (i === 0) return [0];
  const [plat, plon] = ROUTE_GEOMETRY[i - 1];
  const dx = (lon - plon) * Math.cos(((lat + plat) / 2) * (Math.PI / 180));
  return [...cum, cum[i - 1] + Math.hypot(dx, lat - plat)];
}, []);

function pointAlongRoute(t: number): [number, number] {
  const target = Math.min(1, Math.max(0, t)) * CUMULATIVE[CUMULATIVE.length - 1];
  const found = CUMULATIVE.findIndex((d) => d >= target);
  const i = Math.max(1, found === -1 ? CUMULATIVE.length - 1 : found);
  const span = CUMULATIVE[i] - CUMULATIVE[i - 1];
  const f = span > 0 ? (target - CUMULATIVE[i - 1]) / span : 0;
  const [lat1, lon1] = ROUTE_GEOMETRY[i - 1];
  const [lat2, lon2] = ROUTE_GEOMETRY[i];
  return [lat1 + (lat2 - lat1) * f, lon1 + (lon2 - lon1) * f];
}

function routeFractionAt(lat: number, lon: number): number {
  let bestDist = Infinity;
  let bestAlong = 0;
  for (let i = 1; i < ROUTE_GEOMETRY.length; i++) {
    const [lat1, lon1] = ROUTE_GEOMETRY[i - 1];
    const [lat2, lon2] = ROUTE_GEOMETRY[i];
    const k = Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
    const [sx, sy] = [(lon2 - lon1) * k, lat2 - lat1];
    const [px, py] = [(lon - lon1) * k, lat - lat1];
    const len2 = sx * sx + sy * sy;
    const f = len2 > 0 ? Math.min(1, Math.max(0, (px * sx + py * sy) / len2)) : 0;
    const dist = Math.hypot(px - f * sx, py - f * sy);
    if (dist < bestDist) {
      bestDist = dist;
      bestAlong = CUMULATIVE[i - 1] + f * (CUMULATIVE[i] - CUMULATIVE[i - 1]);
    }
  }
  return bestAlong / CUMULATIVE[CUMULATIVE.length - 1];
}

function interpolate(data: { distance: number; elevation?: number; soc?: number }[], key: "elevation" | "soc", target: number) {
  if (data.length === 0) return 0;
  const first = data[0][key] ?? 0;
  const last = data[data.length - 1][key] ?? 0;
  if (target <= data[0].distance) return first;
  if (target >= data[data.length - 1].distance) return last;
  for (let i = 0; i < data.length - 1; i++) {
    const p1 = data[i];
    const p2 = data[i + 1];
    if (target >= p1.distance && target <= p2.distance) {
      const span = p2.distance - p1.distance;
      const f = span > 0 ? (target - p1.distance) / span : 0;
      return (p1[key] ?? 0) + ((p2[key] ?? 0) - (p1[key] ?? 0)) * f;
    }
  }
  return last;
}

function buildSocCurve(vehicle: Vehicle) {
  const styleMultiplier = 1;
  const hvacKw = 1;
  const regenEfficiency = 0.22;
  const payloadKg = 450;
  const payloadFactor = 1 + (payloadKg / 1000) * 0.15;
  const startSoc = vehicle.current_soc ?? 80;
  const capacity = vehicle.battery_capacity_kwh;
  const efficiency = vehicle.baseline_efficiency_wh_km;
  let used = 0;
  let prevElevation = ELEVATION_PROFILE[0].elevation;
  let prevDistance = 0;
  return ELEVATION_PROFILE.map(({ distance, elevation }) => {
    const seg = distance - prevDistance;
    const delta = elevation - prevElevation;
    if (seg > 0 && capacity > 0) {
      const baseKwh = (seg * efficiency * styleMultiplier * payloadFactor) / 1000;
      const climbKwh =
        delta > 0
          ? ((1800 + payloadKg) * 9.81 * delta) / 3600000
          : (((1800 + payloadKg) * 9.81 * delta) / 3600000) * regenEfficiency;
      const hvacKwh = hvacKw * (seg / 75);
      used += Math.max(0, baseKwh + climbKwh + hvacKwh);
    }
    prevDistance = distance;
    prevElevation = elevation;
    const remaining = Math.max(0, (startSoc / 100) * capacity - used);
    const soc = capacity > 0 ? Math.max(2, Math.min(100, (remaining / capacity) * 100)) : 0;
    return { distance, soc };
  });
}

function availabilityColor(available: number, total: number) {
  const ratio = total > 0 ? available / total : 0;
  if (ratio > 0.5) return colors.accentGreen;
  if (ratio > 0) return colors.accentYellow;
  return colors.accentRed;
}

function estimateChargeTime(soc: number, capacityKwh: number, chargerKw: number) {
  const energyNeeded = ((80 - Math.min(soc, 80)) / 100) * capacityKwh;
  if (energyNeeded <= 0) return 0;
  return (energyNeeded / (chargerKw * 0.88)) * 60;
}

function LineSegment({
  x1, y1, x2, y2, color, thickness,
}: { x1: number; y1: number; x2: number; y2: number; color: string; thickness: number }) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < 0.5) return null;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: x1 + dx / 2 - length / 2,
        top: y1 + dy / 2 - thickness / 2,
        width: length,
        height: thickness,
        backgroundColor: color,
        borderRadius: thickness / 2,
        transform: [{ rotate: `${angle}deg` }],
      }}
    />
  );
}

export const RouteScreen: React.FC<RouteScreenProps> = ({
  vehicles,
  telemetry,
  dataStatus,
  selectedVehicle,
  onSelectVehicle,
  onNavigateTab,
}) => {
  const current = selectedVehicle ?? vehicles[0] ?? null;
  const [isRunning, setIsRunning] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [progress, setProgress] = useState(0.48);
  const [stationId, setStationId] = useState<string | null>(null);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [chartWidth, setChartWidth] = useState(0);
  const sliderWidth = useRef(1);
  const runningRef = useRef(isRunning);
  const speedRef = useRef(speed);
  runningRef.current = isRunning;
  speedRef.current = speed;

  useEffect(() => {
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;
      if (!runningRef.current) return;
      setProgress((prev) => {
        const next = prev + (dt * speedRef.current) / 60;
        return next >= 1 ? 0 : next;
      });
    }, 50);
    return () => clearInterval(id);
  }, []);

  const socData = useMemo(() => (current ? buildSocCurve(current) : []), [current]);
  const distanceKm = progress * ROUTE_DISTANCE_KM;
  const currentElevation = interpolate(ELEVATION_PROFILE, "elevation", distanceKm);
  const currentSoc = interpolate(socData, "soc", distanceKm);
  const maxElev = Math.max(...ELEVATION_PROFILE.map((point) => point.elevation), 1600);
  const peak = ELEVATION_PROFILE.reduce((best, point) => (point.elevation > best.elevation ? point : best));

  const positioned = vehicles.flatMap((vehicle) => {
    const reading = telemetry[vehicle.id];
    return reading && Number.isFinite(reading.latitude) && Number.isFinite(reading.longitude)
      ? [{ vehicle, lat: reading.latitude as number, lon: reading.longitude as number }]
      : [];
  });
  const unreported = vehicles.filter((vehicle) => !positioned.some((item) => item.vehicle.id === vehicle.id));
  const positionLabel =
    dataStatus === "live" ? "REPORTED POSITIONS" : dataStatus === "cached" ? "SAVED POSITIONS" : "DEMO POSITIONS";

  const mapFrame = useMemo(() => {
    if (mapSize.width < 20 || mapSize.height < 20) return null;
    let zoom = 6;
    for (let candidate = 6; candidate <= 11; candidate++) {
      const pixels = ROUTE_GEOMETRY.map(([lat, lon]) => worldPx(lat, lon, candidate));
      const minX = Math.min(...pixels.map((p) => p.x));
      const maxX = Math.max(...pixels.map((p) => p.x));
      const minY = Math.min(...pixels.map((p) => p.y));
      const maxY = Math.max(...pixels.map((p) => p.y));
      if (maxX - minX < mapSize.width - 28 && maxY - minY < mapSize.height - 28) zoom = candidate;
      else break;
    }
    const pixels = ROUTE_GEOMETRY.map(([lat, lon]) => worldPx(lat, lon, zoom));
    const minX = Math.min(...pixels.map((p) => p.x));
    const maxX = Math.max(...pixels.map((p) => p.x));
    const minY = Math.min(...pixels.map((p) => p.y));
    const maxY = Math.max(...pixels.map((p) => p.y));
    const originX = minX - (mapSize.width - (maxX - minX)) / 2;
    const originY = minY - (mapSize.height - (maxY - minY)) / 2;
    const toLocal = (lat: number, lon: number) => {
      const point = worldPx(lat, lon, zoom);
      return { x: point.x - originX, y: point.y - originY };
    };
    const simplified = ROUTE_GEOMETRY.filter((_, index) => index % 2 === 0 || index === ROUTE_GEOMETRY.length - 1);
    return { toLocal, simplified: simplified.map(([lat, lon]) => toLocal(lat, lon)) };
  }, [mapSize]);

  if (!current || vehicles.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>No vehicles yet</Text>
        <Text style={styles.emptySubtitle}>
          Add your first vehicle to see fleet data, plan trips and view battery details.
        </Text>
        <TouchableOpacity style={styles.emptyButton} onPress={() => onNavigateTab?.("vehicles")}>
          <Text style={styles.emptyButtonText}>Add a vehicle</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const chartH = 150;
  const plotLeft = 28;
  const plotBottom = 18;
  const plotH = chartH - 22 - plotBottom;
  const plotW = Math.max(0, chartWidth - plotLeft - 8);
  const xAt = (distance: number) => plotLeft + (distance / ROUTE_DISTANCE_KM) * plotW;
  const yElev = (elevation: number) => 16 + plotH - (elevation / maxElev) * plotH;
  const ySoc = (soc: number) => 16 + plotH - (soc / 100) * plotH;
  const elevSamples = ELEVATION_PROFILE.filter((_, index) => index % 2 === 0);
  const socSamples = socData.filter((_, index) => index % 2 === 0);

  const seekFromMap = (localX: number, localY: number) => {
    if (!mapFrame) return;
    let nearestStation: string | null = null;
    let nearestStationDist = 18;
    for (const station of CHARGING_STATIONS) {
      const point = mapFrame.toLocal(station.lat, station.lon);
      const dist = Math.hypot(point.x - localX, point.y - localY);
      if (dist < nearestStationDist) {
        nearestStationDist = dist;
        nearestStation = station.id;
      }
    }
    if (nearestStation) {
      setStationId(nearestStation);
      return;
    }
    let best = { dist: Infinity, lat: 0, lon: 0 };
    for (const [lat, lon] of ROUTE_GEOMETRY) {
      const point = mapFrame.toLocal(lat, lon);
      const dist = Math.hypot(point.x - localX, point.y - localY);
      if (dist < best.dist) best = { dist, lat, lon };
    }
    if (best.dist < 28) setProgress(routeFractionAt(best.lat, best.lon));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <Text style={styles.title}>Route & charging</Text>
          <Text style={styles.subtitle}>
            Manila → Baguio example route via Marcos Highway, elevation profile and sample charging stops.
          </Text>
        </View>
      </View>

      <Text style={styles.pickerLabel}>Vehicle</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.vehicleScroll}>
        {vehicles.map((vehicle) => {
          const selected = vehicle.id === current.id;
          return (
            <TouchableOpacity
              key={vehicle.id}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => onSelectVehicle(vehicle)}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
                {vehicle.id} · {vehicle.model || vehicle.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.panel}>
        <Text style={styles.previewTitle}>Example route animation</Text>
        <Text style={styles.dataNote}>For illustration only. Run a real check in Trip planner.</Text>
        <View style={styles.controls}>
          <TouchableOpacity style={[styles.ctrlBtn, isRunning && styles.ctrlBtnActive]} onPress={() => setIsRunning((value) => !value)}>
            <Text style={styles.ctrlText}>{isRunning ? "Pause" : "Play"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.ctrlBtn} onPress={() => setProgress(0)}>
            <Text style={styles.ctrlText}>Restart</Text>
          </TouchableOpacity>
          <Text style={styles.ctrlLabel}>Speed</Text>
          {SPEEDS.map((value) => (
            <TouchableOpacity
              key={value}
              style={[styles.ctrlBtn, speed === value && styles.ctrlBtnActive]}
              onPress={() => setSpeed(value)}
            >
              <Text style={styles.ctrlText}>{value}×</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.positionRow}>
          <Text style={styles.ctrlLabel}>Position</Text>
          <View
            style={styles.sliderTrack}
            onLayout={(event) => { sliderWidth.current = Math.max(1, event.nativeEvent.layout.width); }}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={(event) => setProgress(Math.min(1, Math.max(0, event.nativeEvent.locationX / sliderWidth.current)))}
            onResponderMove={(event) => setProgress(Math.min(1, Math.max(0, event.nativeEvent.locationX / sliderWidth.current)))}
          >
            <View style={[styles.sliderFill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={styles.positionValue}>{distanceKm.toFixed(1)} km</Text>
        </View>
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>ROUTE MAP — MANILA → BAGUIO</Text>
          <Text style={[styles.badge, { color: colors.accentCyan }]}>{positionLabel}</Text>
        </View>
        <View
          style={styles.map}
          onLayout={(event) => setMapSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
          onStartShouldSetResponder={() => true}
          onResponderRelease={(event) => seekFromMap(event.nativeEvent.locationX, event.nativeEvent.locationY)}
        >
          {mapFrame && mapFrame.simplified.slice(1).map((point, index) => {
            const prev = mapFrame.simplified[index];
            return (
              <LineSegment
                key={`seg-${index}`}
                x1={prev.x}
                y1={prev.y}
                x2={point.x}
                y2={point.y}
                color="rgba(0, 194, 255, 0.9)"
                thickness={3}
              />
            );
          })}
          {mapFrame && ROUTE_WAYPOINTS.map((waypoint) => {
            const point = mapFrame.toLocal(waypoint.lat, waypoint.lon);
            return (
              <View key={waypoint.name} pointerEvents="none" style={[styles.waypoint, { left: point.x - 4, top: point.y - 4 }]}>
                {LABELLED.has(waypoint.name) ? (
                  <Text style={styles.waypointLabel}>{waypoint.name}</Text>
                ) : null}
              </View>
            );
          })}
          {mapFrame && CHARGING_STATIONS.map((station) => {
            const point = mapFrame.toLocal(station.lat, station.lon);
            const selected = station.id === stationId;
            return (
              <View
                key={station.id}
                pointerEvents="none"
                style={[
                  styles.stationDot,
                  selected && styles.stationDotSelected,
                  { left: point.x - (selected ? 7 : 5), top: point.y - (selected ? 7 : 5) },
                ]}
              />
            );
          })}
          {mapFrame && positioned.map(({ vehicle, lat, lon }) => {
            const point = mapFrame.toLocal(lat, lon);
            const selected = vehicle.id === current.id;
            const soc = vehicle.current_soc ?? 0;
            const fill = soc > 60 ? colors.accentGreen : soc > 30 ? colors.accentYellow : colors.accentRed;
            return (
              <View key={vehicle.id} pointerEvents="none" style={{ position: "absolute", left: point.x, top: point.y }}>
                {selected ? (
                  <Text style={styles.vehicleTip}>{vehicle.id} · {Math.round(soc)}% SOC</Text>
                ) : null}
                <View style={[styles.vehicleDot, { backgroundColor: fill, borderColor: selected ? colors.accentCyan : "#0b1320" }]} />
              </View>
            );
          })}
          {mapFrame ? (() => {
            const [lat, lon] = pointAlongRoute(progress);
            const point = mapFrame.toLocal(lat, lon);
            return <View pointerEvents="none" style={[styles.previewDot, { left: point.x - 6, top: point.y - 6 }]} />;
          })() : null}
        </View>
        <Text style={styles.attribution}>
          Street tiles are left off in the app. The line is the stored Manila → Baguio road (© OpenStreetMap contributors, via OSRM; elevation: SRTM).
        </Text>
        {unreported.length > 0 ? (
          <Text style={styles.dataNote}>No position reported: {unreported.map((vehicle) => vehicle.id).join(", ")}</Text>
        ) : null}
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>HILLS & BATTERY ALONG THE ROUTE (DEMO)</Text>
        </View>
        <View style={styles.readoutRow}>
          <Text style={[styles.badge, { color: colors.accentCyan }]}>HEIGHT: {Math.round(currentElevation)} m</Text>
          <Text style={[styles.badge, { color: currentSoc > 30 ? colors.accentGreen : colors.accentRed }]}>
            BATTERY: {currentSoc.toFixed(1)}%
          </Text>
        </View>
        <Text style={styles.dataNote}>Rough estimate for the Manila → Baguio demo route. Run your own trip in Trip planner.</Text>
        <View style={{ height: chartH }} onLayout={(event) => setChartWidth(event.nativeEvent.layout.width)}>
          {[0, 25, 50, 75, 100].map((tick) => (
            <Text key={tick} style={[styles.yLabel, { top: ySoc(tick) - 6, color: tick <= 25 ? colors.accentRed : tick <= 50 ? colors.accentYellow : colors.accentCyan }]}>
              {tick}%
            </Text>
          ))}
          {plotW > 0 && elevSamples.slice(1).map((point, index) => {
            const prev = elevSamples[index];
            return (
              <LineSegment
                key={`elev-${point.distance}`}
                x1={xAt(prev.distance)}
                y1={yElev(prev.elevation)}
                x2={xAt(point.distance)}
                y2={yElev(point.elevation)}
                color="rgba(148, 163, 184, 0.7)"
                thickness={1.5}
              />
            );
          })}
          {plotW > 0 && socSamples.slice(1).map((point, index) => {
            const prev = socSamples[index];
            return (
              <LineSegment
                key={`soc-${point.distance}`}
                x1={xAt(prev.distance)}
                y1={ySoc(prev.soc)}
                x2={xAt(point.distance)}
                y2={ySoc(point.soc)}
                color={colors.accentCyan}
                thickness={2.5}
              />
            );
          })}
          {plotW > 0 ? (
            <View pointerEvents="none" style={[styles.cursor, { left: xAt(distanceKm) }]} />
          ) : null}
          {plotW > 0 ? (
            <Text style={[styles.summit, { left: Math.min(plotW - 20, xAt(peak.distance) - 36), top: yElev(peak.elevation) - 14 }]}>
              SUMMIT {peak.elevation}m
            </Text>
          ) : null}
          <View style={styles.xLabels}>
            {[0, 70, 140, 210, 280].map((km) => (
              <Text key={km} style={styles.xLabel}>{km}km</Text>
            ))}
          </View>
        </View>
        <Text style={styles.legend}>Battery %    Hills (height)    Now: {distanceKm.toFixed(1)} km</Text>
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>SAMPLE CHARGING STOPS ON THE ROUTE</Text>
          <Text style={[styles.badge, { color: colors.accentGreen }]}>
            SAMPLE · {CHARGING_STATIONS.reduce((sum, station) => sum + station.available, 0)} PORTS OPEN
          </Text>
        </View>
        {CHARGING_STATIONS.map((station) => {
          const minutes = estimateChargeTime(current.current_soc ?? 0, current.battery_capacity_kwh, station.powerKw);
          const selected = station.id === stationId;
          const tone = availabilityColor(station.available, station.total);
          return (
            <TouchableOpacity
              key={station.id}
              style={[styles.stationCard, selected && styles.stationCardSelected]}
              onPress={() => setStationId(station.id)}
            >
              <View style={styles.stationTop}>
                <View style={styles.stationNameBlock}>
                  <Text style={styles.stationName}>{station.name}</Text>
                  {station.id === "CS-02" ? <Text style={styles.suggestion}>DEMO SUGGESTION</Text> : null}
                  <Text style={styles.stationMeta}>{station.type} · {station.fee}</Text>
                </View>
                <View>
                  <Text style={[styles.ports, { color: tone }]}>{station.available}/{station.total}</Text>
                  <Text style={styles.stationMeta}>AVAILABLE (SAMPLE)</Text>
                </View>
              </View>
              <Text style={styles.stationMeta}>{station.distanceKm} km from Manila · ~{Math.round(minutes)} min to 80%</Text>
              <View style={styles.availTrack}>
                <View style={[styles.availFill, { width: `${(station.available / station.total) * 100}%`, backgroundColor: tone }]} />
              </View>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity onPress={() => onNavigateTab?.("planner")}>
          <Text style={styles.plannerLink}>Run a real check in Trip planner</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { paddingHorizontal: 16, paddingBottom: 28 },
  pageHeader: { paddingTop: 12, paddingBottom: 8 },
  pageHeaderText: { gap: 2 },
  title: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  pickerLabel: { fontSize: 11, fontWeight: "600", color: colors.textMuted, marginBottom: 6 },
  vehicleScroll: { gap: 8, paddingBottom: 12 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.borderColor,
    maxWidth: 260,
  },
  chipSelected: { borderColor: colors.accentCyan, backgroundColor: "rgba(0, 194, 255, 0.12)" },
  chipText: { fontSize: 12, color: colors.textSecondary },
  chipTextSelected: { color: colors.accentCyan, fontWeight: "600" },
  panel: {
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderColor,
    padding: 12,
    marginBottom: 12,
  },
  previewTitle: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  dataNote: { fontSize: 11, color: colors.textMuted, lineHeight: 16, marginTop: 4, marginBottom: 8 },
  controls: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  ctrlBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.borderColor,
    backgroundColor: colors.bgInput,
  },
  ctrlBtnActive: { borderColor: colors.accentCyan, backgroundColor: "rgba(0, 194, 255, 0.12)" },
  ctrlText: { color: colors.textPrimary, fontSize: 11, fontWeight: "600" },
  ctrlLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "600" },
  positionRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  sliderTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.bgInput,
    justifyContent: "center",
  },
  sliderFill: { height: 6, borderRadius: 3, backgroundColor: colors.accentCyan },
  positionValue: { width: 64, color: colors.textPrimary, fontSize: 11, fontFamily: "monospace" },
  panelHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 },
  panelTitle: { flex: 1, fontSize: 11, fontWeight: "700", color: colors.textPrimary, letterSpacing: 0.4 },
  badge: { fontSize: 10, fontWeight: "700" },
  map: {
    height: 240,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#0b1320",
  },
  waypoint: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#0b1320",
    borderWidth: 1.5,
    borderColor: "#7a8ba6",
  },
  waypointLabel: { position: "absolute", top: -14, left: -8, width: 54, color: "#dbe4f0", fontSize: 9, fontWeight: "700" },
  stationDot: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#065f46",
    borderWidth: 2,
    borderColor: colors.accentGreen,
  },
  stationDotSelected: { width: 14, height: 14, borderRadius: 7, borderColor: colors.accentCyan },
  vehicleDot: { position: "absolute", width: 12, height: 12, borderRadius: 6, borderWidth: 2, left: -6, top: -6 },
  vehicleTip: {
    position: "absolute",
    bottom: 10,
    left: -28,
    width: 86,
    textAlign: "center",
    color: colors.textPrimary,
    backgroundColor: "rgba(11, 19, 32, 0.92)",
    borderWidth: 1,
    borderColor: colors.accentCyan,
    fontSize: 9,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  previewDot: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#ffffff",
    borderWidth: 3,
    borderColor: colors.accentCyan,
  },
  attribution: { fontSize: 9, color: colors.textMuted, marginTop: 6 },
  readoutRow: { flexDirection: "row", gap: 12, marginBottom: 4 },
  yLabel: { position: "absolute", left: 0, width: 26, fontSize: 8, textAlign: "right" },
  cursor: { position: "absolute", top: 16, bottom: 18, width: 1, backgroundColor: colors.accentCyan },
  summit: { position: "absolute", color: "rgba(244, 114, 182, 0.9)", fontSize: 8, fontWeight: "700" },
  xLabels: { position: "absolute", left: 28, right: 8, bottom: 0, flexDirection: "row", justifyContent: "space-between" },
  xLabel: { fontSize: 8, color: "#7a8ba6" },
  legend: { fontSize: 10, color: colors.textSecondary, marginTop: 4 },
  stationCard: {
    borderWidth: 1,
    borderColor: colors.borderColor,
    borderRadius: 8,
    backgroundColor: colors.bgInput,
    padding: 10,
    marginBottom: 8,
  },
  stationCardSelected: { borderLeftWidth: 3, borderLeftColor: colors.accentCyan },
  stationTop: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  stationNameBlock: { flex: 1, gap: 2 },
  stationName: { color: colors.textPrimary, fontSize: 13, fontWeight: "700" },
  suggestion: {
    alignSelf: "flex-start",
    color: colors.accentCyan,
    backgroundColor: "rgba(0, 194, 255, 0.15)",
    fontSize: 8,
    fontWeight: "700",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
  },
  stationMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  ports: { fontSize: 14, fontWeight: "700", textAlign: "right", fontFamily: "monospace" },
  availTrack: { height: 4, borderRadius: 2, backgroundColor: colors.bgBase, marginTop: 8, overflow: "hidden" },
  availFill: { height: 4 },
  plannerLink: { color: colors.accentCyan, fontSize: 12, fontWeight: "600", marginTop: 4 },
  emptyContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: colors.textPrimary, marginBottom: 8 },
  emptySubtitle: { fontSize: 13, color: colors.textSecondary, textAlign: "center", lineHeight: 18, marginBottom: 20 },
  emptyButton: { backgroundColor: colors.accentCyan, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  emptyButtonText: { color: "#0a0e17", fontWeight: "700", fontSize: 13 },
});
