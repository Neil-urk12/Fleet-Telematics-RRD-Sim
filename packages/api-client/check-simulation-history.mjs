// Run with: node packages/api-client/check-simulation-history.mjs
import assert from "node:assert/strict";
import { FleetApiClient, FleetApiError } from "./src/client.ts";

const client = new FleetApiClient({ baseUrl: "http://fleet.test/" });
const records = [{
  id: "rec-1",
  timestamp: "2026-11-07T10:15:00Z",
  request: { vehicle_id: "EV 7/A", route_distance_km: 260.2 },
  response: { vehicle_id: "EV 7/A", risk_level: "CAUTION", confidence_score_pct: 61, uncertainty_pct: null },
}];
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "http://fleet.test/api/simulation/history?vehicle_id=EV%207%2FA");
    assert.equal(options.method, undefined);
    return Response.json(records);
  };
  assert.deepEqual(await client.getSimulationHistory("EV 7/A"), records);

  globalThis.fetch = async url => {
    assert.equal(url, "http://fleet.test/api/simulation/history");
    return Response.json([]);
  };
  assert.deepEqual(await client.getSimulationHistory(), []);

  globalThis.fetch = async () => Response.json({ detail: "Not Found" }, { status: 404 });
  await assert.rejects(client.getSimulationHistory("EV-001"), error =>
    error instanceof FleetApiError && error.status === 404 && error.message === "Not Found");
} finally {
  globalThis.fetch = originalFetch;
}
console.log("Simulation history checks passed");
