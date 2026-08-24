module.exports = {
  name: '009_add_agent_print_queue_and_heartbeat',
  async up(connection) {
    try {
      await connection.query("ALTER TABLE print_queue ADD COLUMN payload_base64 LONGTEXT AFTER printer_id");
      console.log("[Migration] Added column payload_base64 to print_queue.");
    } catch (err) {
      // Ignored if column already exists
    }

    try {
      await connection.query("ALTER TABLE printers ADD COLUMN last_heartbeat_at DATETIME AFTER status");
      console.log("[Migration] Added column last_heartbeat_at to printers.");
    } catch (err) {
      // Ignored if column already exists
    }
  }
};
