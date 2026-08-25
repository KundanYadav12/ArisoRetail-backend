require('dotenv').config();
const InventoryRepository = require('../repositories/inventory_repository');

async function testReport() {
  try {
    console.log('Testing getStockReport for Restaurant ID 1...');
    const result = await InventoryRepository.getStockReport(1, {});
    console.log('Success! Result summary:', result.summary);
  } catch (error) {
    console.error('Error caught during getStockReport:', error);
  } finally {
    process.exit(0);
  }
}

testReport();
