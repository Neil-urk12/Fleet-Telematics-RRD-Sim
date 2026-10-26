// Run with: node packages/api-client/check-reading-age.mjs
import assert from "node:assert/strict";
import { formatBatteryState, formatReadingAge } from "./src/types.ts";

const now = Date.parse("2026-10-10T12:00:00Z");
for (const timestamp of [null, undefined, "", "invalid"]) {
  assert.equal(formatReadingAge(timestamp, now), "Reading age unavailable");
}
for (const [offset, expected] of [
  [0, "Reading age: <1 min"],
  [59_999, "Reading age: <1 min"],
  [60_000, "Reading age: 1 min"],
  [3_600_000, "Reading age: 1 h"],
  [86_400_000, "Reading age: 1 d"],
  [-120_000, "Timestamp 2 min ahead of device clock"],
]) {
  assert.equal(formatReadingAge(new Date(now - offset).toISOString(), now), expected);
}
assert.equal(formatReadingAge("2026-10-10T13:00:00+02:00", now), "Reading age: 1 h");
assert.equal(formatBatteryState({ state_source: "vehicle_defaults", state_timestamp: null }, now),
  "Vehicle defaults · Reading age unavailable");
assert.match(formatBatteryState({ state_source: "manual", state_timestamp: "invalid" }, now),
  /^Manual update · Reading age unavailable$/);
const state = { state_source: "telemetry", state_timestamp: "2026-10-10T11:00:00Z" };
assert.match(formatBatteryState(state, now), /^Telemetry · .*Reading age: 1 h$/);
assert.match(formatBatteryState(state, now + 3_600_000), /Reading age: 2 h$/);
console.log("Reading age checks passed");
