module.exports = {
  name: '032_normalize_logo_urls',
  async up(connection) {
    console.log('[Migration 032] Normalizing logo URLs in restaurants and receipt_settings...');

    // 1. Normalize logo_url in restaurants table
    const [restaurants] = await connection.query('SELECT id, logo_url FROM restaurants WHERE logo_url LIKE "http%"');
    for (const r of restaurants) {
      const match = r.logo_url.match(/(\/uploads\/.*)/);
      if (match) {
        const relativeUrl = match[1];
        await connection.query('UPDATE restaurants SET logo_url = ? WHERE id = ?', [relativeUrl, r.id]);
        console.log(`[Migration 032] Normalized restaurant ID ${r.id} logo to: ${relativeUrl}`);
      }
    }

    // 2. Normalize logo_url in receipt_settings table
    const [settings] = await connection.query('SELECT id, logo_url FROM receipt_settings WHERE logo_url LIKE "http%"');
    for (const s of settings) {
      const match = s.logo_url.match(/(\/uploads\/.*)/);
      if (match) {
        const relativeUrl = match[1];
        await connection.query('UPDATE receipt_settings SET logo_url = ? WHERE id = ?', [relativeUrl, s.id]);
        console.log(`[Migration 032] Normalized receipt_settings ID ${s.id} logo to: ${relativeUrl}`);
      }
    }
  }
};
