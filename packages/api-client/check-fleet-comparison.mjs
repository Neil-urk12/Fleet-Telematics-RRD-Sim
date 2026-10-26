// Run with: node packages/api-client/check-fleet-comparison.mjs
import assert from "node:assert/strict";
import { FleetApiClient, FleetApiError } from "./src/client.ts";

const client = new FleetApiClient({ baseUrl: "http://fleet.test/" });
const request = {
  vehicle_ids: ["EV-002", "EV-006"],
  route_distance_km: 180,
  elevation_gain_m: 500,
  elevation_loss_m: 300,
  road_type: "HIGHWAY",
  ambient_temp_c: -5,
  payload_kg: 450,
  hvac_mode: "HIGH",
  driving_style: "ECO",
  regen_level: "LOW",
  reserve_soc_target_pct: 20,
};
const result = { results: [
  { vehicle_id: "EV-002", response: { risk_level: "SAFE" }, error: null },
  { vehicle_id: "EV-006", response: null, error: "Vehicle has no usable battery capacity" },
] };
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "http://fleet.test/api/simulation/batch");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(options.body), request);
    return Response.json(result);
  };
  assert.deepEqual(await client.runBatchSimulation(request), result);

  // An explicitly empty selection must stay empty, rather than evaluating the whole fleet.
  globalThis.fetch = async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body).vehicle_ids, []);
    return Response.json({ results: [] });
  };
  assert.deepEqual(await client.runBatchSimulation({ ...request, vehicle_ids: [] }), { results: [] });

  globalThis.fetch = async () => Response.json({ detail: "Invalid route" }, { status: 422 });
  await assert.rejects(client.runBatchSimulation(request), error =>
    error instanceof FleetApiError && error.status === 422 && error.message === "Invalid route");
  globalThis.fetch = async () => { throw new TypeError("Connection lost"); };
  await assert.rejects(client.runBatchSimulation(request), /Connection lost/);
} finally {
  globalThis.fetch = originalFetch;
}
console.log("Fleet comparison checks passed");
