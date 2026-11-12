// Run with: node packages/api-client/check-simulation-compare.mjs
import assert from "node:assert/strict";
import { FleetApiClient, FleetApiError } from "./src/client.ts";

const client = new FleetApiClient({ baseUrl: "http://fleet.test/" });
const request = {
  vehicle_id: "EV-001",
  route_distance_km: 120,
  reserve_soc_target_pct: 15,
  configs: [
    { label: "As submitted", driving_style: "NORMAL", hvac_mode: "HIGH", regen_level: "MEDIUM" },
    { label: "Efficient", driving_style: "ECO", hvac_mode: "OFF", regen_level: "HIGH" },
  ],
};
const response = {
  vehicle_id: "EV-001",
  results: request.configs.map((config, index) => ({
    label: config.label,
    response: { vehicle_id: "EV-001", risk_level: "SAFE", projected_arrival_soc_pct: 40 + index },
  })),
};
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "http://fleet.test/api/simulation/compare");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(options.body), request);
    return Response.json(response);
  };
  assert.deepEqual(await client.compareSimulations(request), response);

  globalThis.fetch = async () => Response.json({ detail: "Vehicle 'EV-404' not found" }, { status: 404 });
  await assert.rejects(client.compareSimulations({ ...request, vehicle_id: "EV-404" }), error =>
    error instanceof FleetApiError && error.status === 404 && error.message === "Vehicle 'EV-404' not found");
} finally {
  globalThis.fetch = originalFetch;
}
console.log("Simulation compare checks passed");
