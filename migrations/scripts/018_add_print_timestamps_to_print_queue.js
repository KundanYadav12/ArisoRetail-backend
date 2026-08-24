module.exports = {
  name: '018_add_print_timestamps_to_print_queue',
  up: async (connection) => {
    const columnsToAdd = [
      'ADD COLUMN backend_received_at DATETIME DEFAULT NULL',
      'ADD COLUMN gateway_polled_at DATETIME DEFAULT NULL',
      'ADD COLUMN connection_started_at DATETIME DEFAULT NULL',
      'ADD COLUMN connected_at DATETIME DEFAULT NULL',
      'ADD COLUMN data_sent_at DATETIME DEFAULT NULL',
      'ADD COLUMN completed_at DATETIME DEFAULT NULL',
      'ADD COLUMN total_duration_ms INT DEFAULT NULL'
    ];

    for (const col of columnsToAdd) {
      try {
        await connection.query(`ALTER TABLE print_queue ${col}`);
      } catch (err) {
        if (!err.message?.includes('Duplicate column name')) {
          console.warn(`[Migration 018 Notice] ${err.message}`);
        }
      }
    }
    console.log('[Migration 018] Added timing performance columns to print_queue table.');
  }
};
