/**
 * Device Service
 * In-memory storage for devices
 * Ready for future DB integration
 */

const { v4: uuidv4 } = require('uuid');

// In-memory storage for devices
// Map<deviceId, DeviceInfo>
const devices = new Map();

// Map to associate deviceId with WebSocket connection
// Map<deviceId, WebSocket>
const deviceConnections = new Map();

/**
 * Register a new device
 * @param {Object} deviceData - Device registration data
 * @returns {Object} Registered device
 */
function registerDevice(deviceData) {
    const { deviceId, platform, appVersion } = deviceData;

    const device = {
        deviceId: deviceId || uuidv4(),
        platform: platform || 'android',
        appVersion: appVersion || '1.0.0',
        registeredAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        isConnected: false
    };

    devices.set(device.deviceId, device);

    return device;
}

/**
 * Get device by ID
 * @param {string} deviceId 
 * @returns {Object|null} Device or null
 */
function getDevice(deviceId) {
    return devices.get(deviceId) || null;
}

/**
 * Get all devices
 * @returns {Array} List of devices
 */
function getAllDevices() {
    return Array.from(devices.values());
}

/**
 * Update device info
 * @param {string} deviceId 
 * @param {Object} updateData 
 * @returns {Object|null} Updated device or null
 */
function updateDevice(deviceId, updateData) {
    const device = devices.get(deviceId);
    if (!device) return null;

    const updated = {
        ...device,
        ...updateData,
        lastSeenAt: new Date().toISOString()
    };

    devices.set(deviceId, updated);
    return updated;
}

/**
 * Delete device
 * @param {string} deviceId 
 * @returns {boolean} Success
 */
function deleteDevice(deviceId) {
    // Also remove WebSocket connection
    deviceConnections.delete(deviceId);
    return devices.delete(deviceId);
}

/**
 * Associate a WebSocket connection with a device
 * @param {string} deviceId 
 * @param {WebSocket} ws 
 */
function setDeviceConnection(deviceId, ws) {
    deviceConnections.set(deviceId, ws);
    updateDevice(deviceId, { isConnected: true });
}

/**
 * Get WebSocket connection for a device
 * @param {string} deviceId 
 * @returns {WebSocket|null}
 */
function getDeviceConnection(deviceId) {
    return deviceConnections.get(deviceId) || null;
}

/**
 * Remove WebSocket connection for a device
 * @param {string} deviceId 
 */
function removeDeviceConnection(deviceId) {
    deviceConnections.delete(deviceId);
    updateDevice(deviceId, { isConnected: false });
}

/**
 * Check if device exists
 * @param {string} deviceId 
 * @returns {boolean}
 */
function deviceExists(deviceId) {
    return devices.has(deviceId);
}

module.exports = {
    registerDevice,
    getDevice,
    getAllDevices,
    updateDevice,
    deleteDevice,
    setDeviceConnection,
    getDeviceConnection,
    removeDeviceConnection,
    deviceExists
};
