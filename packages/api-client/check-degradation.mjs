// Run with: node packages/api-client/check-degradation.mjs
import assert from "node:assert/strict";
import { FleetApiClient, FleetApiError } from "./src/client.ts";

const client = new FleetApiClient({ baseUrl: "http://fleet.test/" });
const request = { vehicle_id: "EV-001", route_distance_km: 120, reserve_soc_target_pct: 15 };
const response = {
  vehicle_id: "EV-001",
  basis: "ASSUMED",
  soh_loss_pct_per_year: 2,
  readings_used: 1,
  span_days: 0,
  points: [
    { years_ahead: 0, projected_soh_pct: 95, projected_arrival_soc_pct: 40, predicted_range_km: 300, risk_level: "SAFE" },
    { years_ahead: 5, projected_soh_pct: 85, projected_arrival_soc_pct: 12, predicted_range_km: 270, risk_level: "CAUTION" },
  ],
};
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "http://fleet.test/api/simulation/degradation");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(options.body), request);
    return Response.json(response);
  };
  assert.deepEqual(await client.projectDegradation(request), response);

  globalThis.fetch = async () => Response.json({ detail: "Vehicle 'EV-404' not found" }, { status: 404 });
  await assert.rejects(client.projectDegradation({ ...request, vehicle_id: "EV-404" }), error =>
    error instanceof FleetApiError && error.status === 404 && error.message === "Vehicle 'EV-404' not found");
} finally {
  globalThis.fetch = originalFetch;
}
console.log("Degradation projection checks passed");
