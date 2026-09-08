const fs = require('fs');

async function testPut() {
  console.log('--- Logging in ---');
  try {
    const loginRes = await fetch('http://localhost:5005/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'mcd_admin', password: 'admin123', starting_cash: 1000, device: 'Node Test Script' })
    });

    const loginData = await loginRes.json();
    if (!loginData.accessToken) {
      console.error('Login failed:', loginData);
      return;
    }

    const token = loginData.accessToken;
    console.log('Login successful. Access Token retrieved.');

    // We will do a PUT to /api/menu/1 (which is seeded McVeggie Burger)
    console.log('\n--- Sending PUT to /api/menu/1 ---');
    const formData = new FormData();
    formData.append('name', 'McVeggie Burger Updated');
    formData.append('price', '135');
    formData.append('category_id', '1');
    formData.append('gst_rate', '5');
    formData.append('is_veg', '1');
    formData.append('is_available', '1');
    formData.append('description', 'Fresh crispy veg patty burger');
    formData.append('unit', 'pcs');
    formData.append('current_stock', '120');

    // Create a dummy image file blob
    const dummyImageContent = Buffer.from('dummy image content');
    const blob = new Blob([dummyImageContent], { type: 'image/jpeg' });
    formData.append('image', blob, 'test_dish.jpg');

    const response = await fetch('http://localhost:5005/api/menu/1', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    console.log('Response Status:', response.status);
    const text = await response.text();
    console.log('Response Body:', text);
  } catch (err) {
    console.error('Error in test:', err);
  }
}

testPut();
