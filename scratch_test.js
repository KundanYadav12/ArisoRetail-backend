require('dotenv').config();
const pool = require('./config/db');

async function main() {
  try {
    console.log('=== RESTAURANTS ===');
    const [restaurants] = await pool.query('SELECT * FROM restaurants');
    console.log(JSON.stringify(restaurants, null, 2));

    console.log('\n=== USERS ===');
    const [users] = await pool.query('SELECT id, restaurant_id, name, username, role, is_active FROM users');
    console.log(JSON.stringify(users, null, 2));

    console.log('\n=== CATEGORIES ===');
    const [categories] = await pool.query('SELECT id, restaurant_id, name, seq FROM categories');
    console.log(JSON.stringify(categories, null, 2));

    console.log('\n=== MENU ITEMS ===');
    const [menuItems] = await pool.query('SELECT id, restaurant_id, category_id, name, price, is_available FROM menu_items');
    console.log(JSON.stringify(menuItems, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}

main();
