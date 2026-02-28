const { applySafetyGate } = require('./src/controllers/route.controller'); // Wait, applySafetyGate isn't exported... Let's copy it here

const routeSafetyService = require('./src/services/route.safety.service');
const config = require('./src/config/config');

config.ROUTE_SAFETY_GATE = true;
config.ROUTE_SIMPLIFY_METERS = 5;
config.ROUTE_RESAMPLE_METERS = 20;

function applySafetyGate(points) {
    if (!config.ROUTE_SAFETY_GATE) return points;
    let safePoints = routeSafetyService.sanitizePoints(points);
    console.log("After sanitize:", safePoints.length);
    routeSafetyService.validatePoints(safePoints, config);
    safePoints = routeSafetyService.simplifyPoints(safePoints, config.ROUTE_SIMPLIFY_METERS);
    console.log("After simplify:", safePoints.length);
    safePoints = routeSafetyService.resampleByDistance(safePoints, config.ROUTE_RESAMPLE_METERS);
    console.log("After resample:", safePoints.length);
    routeSafetyService.detectSpikes(safePoints);
    return safePoints;
}

const points = [
    { lat: 40.4168, lng: -3.7038, dwellSeconds: 0 },
    { lat: 40.4170, lng: -3.7040, dwellSeconds: 0 },
    { lat: 40.4175, lng: -3.7045, dwellSeconds: 0 },
    { lat: 40.4180, lng: -3.7050, dwellSeconds: 0 }
];

const final = applySafetyGate(points);
console.log("Final count:", final.length);
