// One-off generator for src/routeData.ts. Fetches the Manila -> Baguio road (OSRM) and its
// elevation (OpenTopoData SRTM90), then writes a static module the app imports.
// Usage: node apps/web/scripts/build-route-data.mjs          (fetch and write)
//        node apps/web/scripts/build-route-data.mjs --check [file]  (validate the committed file)
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const OUTPUT = new URL('../src/routeData.ts', import.meta.url);
const SAMPLE_KM = 2;

// [name, lat, lon]; Agoo and Tubao force Marcos Highway (Aspiras–Palispis Highway, Agoo -> Tubao
// -> Pugo -> Tuba -> Baguio) instead of the Rosario–Pugo shortcut or Kennon Road.
const WAYPOINTS = [
    ['Manila', 14.5826, 120.9787],
    ['San Fernando', 15.0283, 120.6938],
    ['Urdaneta', 15.976, 120.5669],
    ['Rosario', 16.2299, 120.4877],
    ['Agoo', 16.3224, 120.367],
    ['Tubao', 16.347, 120.4126],
    ['Pugo', 16.3203, 120.4674],
    ['Tuba', 16.3924, 120.5601],
    ['Baguio', 16.408, 120.596],
];
const VIA = ['Manila', 'Agoo', 'Tubao', 'Baguio'];

// Generic placeholders, not real operators; availability and peso fees are illustrative.
const STATIONS = [
    { id: 'CS-01', name: 'Sample charger A', near: 'San Fernando', powerKw: 150, type: 'DC Fast (150kW)', fee: '₱28/kWh', available: 3, total: 4 },
    { id: 'CS-02', name: 'Sample charger B', near: 'Rosario', powerKw: 350, type: 'Ultra-Fast (350kW)', fee: '₱34/kWh', available: 1, total: 2 },
    { id: 'CS-03', name: 'Sample charger C', near: 'Pugo', powerKw: 50, type: 'Level 2 (50kW)', fee: '₱22/kWh', available: 5, total: 6 },
];

function haversineKm([lat1, lon1], [lat2, lon2]) {
    const rad = Math.PI / 180;
    const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
        + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function cumulativeKm(points, totalKm) {
    const raw = [0];
    for (let i = 1; i < points.length; i++) raw.push(raw[i - 1] + haversineKm(points[i - 1], points[i]));
    const scale = totalKm / raw[raw.length - 1]; // match OSRM's road distance
    return raw.map((d) => d * scale);
}

function pointAtKm(points, cum, km) {
    km = Math.min(km, cum.at(-1)); // float drift past the end would otherwise extrapolate segment 1
    const i = Math.max(1, cum.findIndex((d) => d >= km));
    const f = cum[i] > cum[i - 1] ? (km - cum[i - 1]) / (cum[i] - cum[i - 1]) : 0;
    return [0, 1].map((k) => points[i - 1][k] + (points[i][k] - points[i - 1][k]) * f);
}

function perpendicularDistance([y, x], [y1, x1], [y2, x2]) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    return len === 0 ? Math.hypot(x - x1, y - y1) : Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / len;
}

function simplify(points, epsilon) {
    let maxDist = 0;
    let index = 0;
    for (let i = 1; i < points.length - 1; i++) {
        const d = perpendicularDistance(points[i], points[0], points[points.length - 1]);
        if (d > maxDist) [maxDist, index] = [d, i];
    }
    if (maxDist <= epsilon) return [points[0], points[points.length - 1]];
    return [...simplify(points.slice(0, index + 1), epsilon).slice(0, -1), ...simplify(points.slice(index), epsilon)];
}

async function getJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
    return response.json();
}

async function fetchRoute() {
    const coords = VIA.map((name) => WAYPOINTS.find(([n]) => n === name)).map(([, lat, lon]) => `${lon},${lat}`).join(';');
    const data = await getJson(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
    assert.equal(data.code, 'Ok', `OSRM returned ${data.code}`);
    const route = data.routes[0];
    return { points: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]), distanceKm: route.distance / 1000 };
}

async function fetchElevations(points) {
    const elevations = [];
    for (let i = 0; i < points.length; i += 100) {
        if (i > 0) await sleep(1100); // public API allows 1 request per second
        const locations = points.slice(i, i + 100).map(([lat, lon]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join('|');
        const data = await getJson(`https://api.opentopodata.org/v1/srtm90m?locations=${locations}`);
        assert.equal(data.status, 'OK', `OpenTopoData returned ${data.status}`);
        elevations.push(...data.results.map((r) => r.elevation));
    }
    return elevations;
}

export function checkRouteData({ ROUTE_GEOMETRY, ROUTE_DISTANCE_KM, ELEVATION_PROFILE, ROUTE_ELEVATION, ROUTE_WAYPOINTS, CHARGING_STATIONS }) {
    assert.ok(ROUTE_GEOMETRY.length >= 150 && ROUTE_GEOMETRY.length <= 300, `geometry has ${ROUTE_GEOMETRY.length} points`);
    assert.ok(ROUTE_DISTANCE_KM > 0, 'route distance must be positive');
    assert.equal(ELEVATION_PROFILE[0].distance, 0, 'profile must start at 0 km');
    ELEVATION_PROFILE.slice(1).forEach((p, i) => assert.ok(p.distance > ELEVATION_PROFILE[i].distance, `profile distance not increasing at ${p.distance} km`));
    assert.equal(ELEVATION_PROFILE.at(-1).distance, ROUTE_DISTANCE_KM, 'profile must end at the route distance');
    assert.ok(ROUTE_ELEVATION.gain >= 0 && ROUTE_ELEVATION.loss >= 0, 'gain and loss must be nonnegative');
    for (const item of [...ROUTE_WAYPOINTS, ...CHARGING_STATIONS]) {
        assert.ok(item.distanceKm >= 0 && item.distanceKm <= ROUTE_DISTANCE_KM, `${item.name} is off the route`);
    }
}

async function build() {
    const { points, distanceKm: rawDistanceKm } = await fetchRoute();
    const distanceKm = Math.round(rawDistanceKm * 10) / 10;
    const cum = cumulativeKm(points, distanceKm);

    const sampleKms = [];
    for (let km = 0; km < distanceKm; km += SAMPLE_KM) sampleKms.push(km);
    sampleKms.push(distanceKm);
    const elevations = await fetchElevations(sampleKms.map((km) => pointAtKm(points, cum, km)));
    const profile = sampleKms.map((km, i) => ({ distance: Math.round(km * 10) / 10, elevation: Math.round(elevations[i]) }));

    const totals = profile.reduce((t, p, i) => {
        if (i > 0) {
            const change = p.elevation - profile[i - 1].elevation;
            t.gain += Math.max(0, change);
            t.loss += Math.max(0, -change);
        }
        return t;
    }, { gain: 0, loss: 0 });

    // Snap each named place to its nearest point on the road.
    const nearestKm = (lat, lon) => cum[points.reduce((best, p, i) => (haversineKm(p, [lat, lon]) < haversineKm(points[best], [lat, lon]) ? i : best), 0)];
    const elevationAt = (km) => profile.reduce((best, p) => (Math.abs(p.distance - km) < Math.abs(best.distance - km) ? p : best)).elevation;
    const waypoints = WAYPOINTS.map(([name, lat, lon]) => {
        const km = Math.round(nearestKm(lat, lon) * 10) / 10;
        const [plat, plon] = pointAtKm(points, cum, km);
        const offRoadKm = haversineKm([plat, plon], [lat, lon]);
        if (offRoadKm > 3) console.warn(`${name} is ${offRoadKm.toFixed(1)} km from the road; check the route`);
        return { name, lat: +plat.toFixed(5), lon: +plon.toFixed(5), distanceKm: km, elevationM: elevationAt(km) };
    });
    const stations = STATIONS.map(({ near, ...station }) => {
        const wp = waypoints.find((w) => w.name === near);
        return { ...station, lat: wp.lat, lon: wp.lon, distanceKm: wp.distanceKm };
    });

    let epsilon = 0.00005;
    let geometry = simplify(points, epsilon);
    while (geometry.length > 300) geometry = simplify(points, (epsilon *= 1.25));
    geometry = geometry.map(([lat, lon]) => [+lat.toFixed(5), +lon.toFixed(5)]);

    const data = {
        ROUTE_GEOMETRY: geometry,
        ROUTE_DISTANCE_KM: distanceKm,
        ELEVATION_PROFILE: profile,
        ROUTE_ELEVATION: totals,
        ROUTE_WAYPOINTS: waypoints,
        CHARGING_STATIONS: stations,
    };
    checkRouteData(data);

    const json = (value) => JSON.stringify(value);
    const source = `// Generated by apps/web/scripts/build-route-data.mjs on ${new Date().toISOString().slice(0, 10)}. Do not edit by hand.
// Road: OSRM (router.project-osrm.org, OpenStreetMap data) via ${VIA.join(' -> ')}; ${points.length} points simplified to ${geometry.length}.
// Elevation: OpenTopoData SRTM 90 m, sampled every ${SAMPLE_KM} km; coarse cells and sampling smooth small climbs, so gain/loss are approximate.
// Charging stations are generic samples with illustrative availability, not real operators.

export interface RouteWaypoint { name: string; lat: number; lon: number; distanceKm: number; elevationM: number }
export interface ChargingStation {
    id: string; name: string; lat: number; lon: number; distanceKm: number;
    powerKw: number; type: string; fee: string; available: number; total: number;
}

export const ROUTE_DISTANCE_KM = ${distanceKm};
export const ROUTE_ELEVATION = ${json(totals)};
export const ROUTE_WAYPOINTS: RouteWaypoint[] = [
${waypoints.map((w) => `    ${json(w)},`).join('\n')}
];
export const CHARGING_STATIONS: ChargingStation[] = [
${stations.map((s) => `    ${json(s)},`).join('\n')}
];
export const ELEVATION_PROFILE: { distance: number; elevation: number }[] = ${json(profile)};
export const ROUTE_GEOMETRY: [number, number][] = ${json(geometry)};
`;
    await writeFile(OUTPUT, source);
    console.log(`Wrote ${OUTPUT.pathname}: ${distanceKm} km, ${geometry.length} points, ${profile.length} elevation samples, +${totals.gain}/-${totals.loss} m`);
}

const checkIndex = process.argv.indexOf('--check');
if (checkIndex !== -1) {
    const file = process.argv[checkIndex + 1] ? pathToFileURL(process.argv[checkIndex + 1]) : OUTPUT;
    checkRouteData(await import(file.href));
    console.log(`${file.pathname} passes checks`);
} else {
    await build();
}
