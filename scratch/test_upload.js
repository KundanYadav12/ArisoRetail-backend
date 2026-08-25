require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function testUpload() {
  try {
    console.log('Logging in as retail_admin...');
    const loginRes = await fetch('http://localhost:5005/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'retail_admin', password: 'admin123' })
    });

    const loginData = await loginRes.json();
    if (!loginData.accessToken) {
      throw new Error('Login failed: ' + JSON.stringify(loginData));
    }
    const token = loginData.accessToken;
    console.log('Logged in successfully! Token obtained.');

    // Create a small mock image file
    const imagePath = path.join(__dirname, 'test_image.png');
    fs.writeFileSync(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
    console.log('Created temporary mock image:', imagePath);

    // Prepare FormData
    const formData = new FormData();
    const fileStream = fs.readFileSync(imagePath);
    const blob = new Blob([fileStream], { type: 'image/png' });
    formData.append('image', blob, 'test_image.png');
    formData.append('name', 'Basmati Rice (Premium)');
    formData.append('price', '90.00');

    console.log('Sending PUT /api/menu/101 request with image...');
    const response = await fetch('http://localhost:5005/api/menu/101', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    console.log('HTTP Status:', response.status);
    const responseText = await response.text();
    console.log('Response Body:', responseText);

    // Clean up temporary image
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
  } catch (error) {
    console.error('Error during upload test:', error);
  } finally {
    process.exit(0);
  }
}

testUpload();
