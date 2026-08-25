require('dotenv').config();
const OrderRepository = require('../repositories/order_repository');

async function testCheckout() {
  try {
    console.log('Testing transactional checkout (OrderRepository.create)...');
    
    const restaurantId = 1;
    const orderData = {
      cashier_id: 2,
      cashier_name: 'Ariso Retail Admin',
      subtotal: 90.00,
      tax_amount: 4.50,
      discount_amount: 0.00,
      total_amount: 94.50,
      payment_mode: 'cash',
      payment_details: {},
      cashier_shift_id: 1,
      table_number_or_takeaway: 'Takeaway',
      notes: 'Test check order',
      status: 'completed',
      discount_type: 'amount',
      discount_value: 0,
      customer_name: 'Walk-in Customer',
      customer_phone: '9999999999',
      idempotency_key: 'test-idemp-' + Date.now(),
      tax_type: 'intra'
    };

    const items = [
      {
        product_id: 101, // Basmati Rice (Premium)
        name: 'Basmati Rice (Premium)',
        price: 90.00,
        quantity: 1,
        gst_rate: 5.00,
        tax_amount: 4.50,
        discount_amount: 0.00,
        total_price: 94.50
      }
    ];

    const result = await OrderRepository.create(restaurantId, orderData, items);
    console.log('Success! Created order ID:', result.orderId);
    console.log('Created order details:', result.order);
  } catch (error) {
    console.error('Error during checkout test:', error);
  } finally {
    process.exit(0);
  }
}

testCheckout();
