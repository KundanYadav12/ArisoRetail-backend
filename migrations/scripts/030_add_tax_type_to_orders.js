module.exports = {
  name: '030_add_tax_type_to_orders',
  async up(connection) {
    console.log('[Migration 030] Adding tax_type column to orders table...');
    try {
      await connection.query(`
        ALTER TABLE orders 
        ADD COLUMN tax_type VARCHAR(10) DEFAULT 'intra'
      `);
      console.log('[Migration 030] Successfully added tax_type column to orders.');
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        console.log('[Migration 030] Column tax_type already exists on orders.');
      } else {
        throw err;
      }
    }
  }
};
