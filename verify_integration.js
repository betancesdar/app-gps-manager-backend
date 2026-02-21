const axios = require('axios');
const WebSocket = require('ws');

const BASE_URL = 'http://localhost:4000';
const WS_URL = 'ws://localhost:4000';

async function main() {
    console.log('--- STARTING VERIFICATION ---');

    // 1. ADMIN LOGIN
    let adminToken;
    try {
        const res = await axios.post(BASE_URL + '/api/auth/login', { username: 'admin', password: 'admin123' });
        adminToken = res.data.data.token;
        console.log('[PASS] Admin Login');
    } catch (err) {
        console.error('[FAIL] Admin Login', err.message);
        process.exit(1);
    }

    // 2. GENERATE CODE
    let code;
    try {
        const res = await axios.post(BASE_URL + '/api/devices/enroll',
            { label: 'VerifyScript' },
            { headers: { Authorization: 'Bearer ' + adminToken } }
        );
        code = res.data.data.enrollmentCode;
        console.log('[PASS] Generated Code:', code);
    } catch (err) {
        console.error('[FAIL] Generate Code', err.message);
        process.exit(1);
    }

    // 3. CLAIM CODE
    let deviceToken;
    let deviceId;
    try {
        const res = await axios.post(BASE_URL + '/api/enrollment/claim', {
            enrollmentCode: code,
            deviceInfo: { androidId: 'verify-' + Date.now() }
        });
        deviceToken = res.data.data.token;
        deviceId = res.data.data.deviceId;
        console.log('[PASS] Claim Code. DeviceID:', deviceId);
    } catch (err) {
        console.error('[FAIL] Claim Code', err.message);
        if (err.response) console.error(err.response.data);
        process.exit(1);
    }

    // 4. WEBSOCKET
    const ws = new WebSocket(WS_URL, {
        headers: { 'Authorization': 'Bearer ' + deviceToken, 'X-Device-Id': deviceId }
    });

    ws.on('open', () => {
        console.log('[PASS] WS Connected. Sending PING...');
        ws.send(JSON.stringify({ type: 'PING' }));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        console.log('[WS MSG]', msg.type);
        if (msg.type === 'PONG') {
            console.log('[PASS] PONG received. SYSTEM HEALTHY.');
            process.exit(0);
        }
    });

    ws.on('error', (err) => {
        console.error('[FAIL] WS Error', err.message);
        process.exit(1);
    });
}

main();
