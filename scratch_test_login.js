require('dotenv').config();
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./config/jwt_config');

async function testUser(username, password) {
  console.log(`\n================ Testing Login for username: "${username}" ================`);
  try {
    const res = await fetch('http://localhost:5004/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, starting_cash: 1000, device: 'Node Test Script' })
    });

    const data = await res.json();
    console.log('HTTP Status:', res.status);
    console.log('Login Response Body:', JSON.stringify(data, null, 2));

    if (data.accessToken) {
      const decoded = jwt.decode(data.accessToken);
      console.log('Decoded JWT Token Payload:', decoded);

      console.log('\n--- Fetching /api/categories ---');
      const catRes = await fetch('http://localhost:5004/api/categories', {
        headers: { 'Authorization': `Bearer ${data.accessToken}` }
      });
      const catData = await catRes.json();
      console.log('Categories Status:', catRes.status, 'Count:', Array.isArray(catData) ? catData.length : catData);
      console.log('Categories:', catData);

      console.log('\n--- Fetching /api/menu ---');
      const menuRes = await fetch('http://localhost:5004/api/menu', {
        headers: { 'Authorization': `Bearer ${data.accessToken}` }
      });
      const menuData = await menuRes.json();
      console.log('Menu Status:', menuRes.status, 'Count:', Array.isArray(menuData) ? menuData.length : menuData);
      console.log('Menu Items:', menuData);
    }
  } catch (err) {
    console.error('Error during test:', err);
  }
}

async function main() {
  await testUser('mcd_admin', 'admin123'); // Or whatever password
  await testUser('mcd_cashier_a', 'cashier123');
  await testUser('dealup24', 'admin123');
  await testUser('kundan', 'admin123');
}

main();
