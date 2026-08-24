module.exports = {
  name: '020_add_bluetooth_address_to_printers',
  async up(connection) {
    // Add bluetooth_address column for direct Bluetooth SPP printer pairing
    try {
      await connection.query(
        "ALTER TABLE printers ADD COLUMN bluetooth_address VARCHAR(17) DEFAULT NULL AFTER ip_address"
      );
      console.log('[Migration] Added column bluetooth_address to printers.');
    } catch (err) {
      if (!err.message.includes('Duplicate column')) {
        console.warn('[Migration] bluetooth_address:', err.message);
      }
    }

    // Make ip_address nullable — Bluetooth printers have no IP
    try {
      await connection.query(
        "ALTER TABLE printers MODIFY COLUMN ip_address VARCHAR(50) DEFAULT NULL"
      );
      console.log('[Migration] Modified printers.ip_address to be nullable.');
    } catch (err) {
      console.warn('[Migration] ip_address nullable modify:', err.message);
    }
  }
};
