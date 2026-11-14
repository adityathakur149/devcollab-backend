const http = require('http');

/**
 * Quick helper script to test API endpoints
 */
const postJSON = (path, data, token = null) => {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(body) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, rawBody: body });
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
};

const getJSON = (path, token = null) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: 'GET',
      headers: {},
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(body) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, rawBody: body });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
};

async function testAuth() {
  console.log('--- Testing Auth API Endpoints ---');

  // Test Health
  const health = await getJSON('/health');
  console.log('[GET /health]', health.statusCode, health.body);

  // Test Register
  const testUser = {
    username: `aditya_${Date.now()}`,
    email: `aditya_${Date.now()}@example.com`,
    password: 'password123',
  };

  const regRes = await postJSON('/api/auth/register', testUser);
  console.log('[POST /api/auth/register]', regRes.statusCode, regRes.body);

  if (regRes.body.token) {
    // Test Protected Profile route
    const profileRes = await getJSON('/api/auth/me', regRes.body.token);
    console.log('[GET /api/auth/me]', profileRes.statusCode, profileRes.body);
  }
}

testAuth();
