const pool = require('../config/db');

class ReceiptRepository {
  static async getSettings(restaurantId) {
    return this.getByRestaurantId(restaurantId);
  }

  static async getByRestaurantId(restaurantId) {
    const [rows] = await pool.query(
      'SELECT * FROM receipt_settings WHERE restaurant_id = ?',
      [restaurantId]
    );

    if (rows.length > 0) {
      return rows[0];
    }

    // Fetch restaurant fallback details
    const [restRows] = await pool.query(
      'SELECT name, address, phone, email, gst_number FROM restaurants WHERE id = ?',
      [restaurantId]
    );

    const rest = restRows[0] || {};

    // Create default receipt settings entry
    const defaultSettings = {
      restaurant_id: restaurantId,
      restaurant_name: rest.name || 'Restaurant POS',
      branch_name: null,
      address: rest.address || '',
      phone: rest.phone || '',
      whatsapp: rest.phone || '',
      email: rest.email || '',
      website: '',
      gst_number: rest.gst_number || '',
      fssai_number: '',
      logo_url: '',
      header_message: 'Welcome to Our Store!',
      footer_message: 'Visit us again soon.',
      thank_you_message: 'Thank You! Visit Again.',
      terms_conditions: 'Goods once sold cannot be returned.',
      paper_size: '80mm',
      font_size: 'normal',
      header_alignment: 'center',
      show_logo: 1,
      show_qr_code: 1,
      show_customer_details: 1,
      show_cashier_name: 1,
      show_tax_details: 1,
      show_payment_details: 1,
      show_footer_notes: 1,
      kot_header: 'KITCHEN ORDER TICKET',
      kitchen_name: 'Main Kitchen',
      kot_footer_note: 'Prepare with priority',
      show_kot_order_notes: 1,
      show_kot_time: 1,
      gst_mode: 'excluded',
      default_gst_rate: 5.00,
      print_stage1_mode: 'print_kot_receipt',
      print_stage2_mode: 'print_receipt_only',
      allow_cashier_view_all_reports: 0,
      enable_whatsapp_receipt: 0,
      whatsapp_business_phone: '',
      enable_stage2_popup: 1,
      gst_enabled: 1,
      // Stage 1 popup button toggles
      stage1_popup_save_only: 1,
      stage1_popup_receipt_only: 1,
      stage1_popup_kot_only: 1,
      stage1_popup_kot_receipt: 1,
      // Stage 2 popup button toggles
      stage2_popup_save_only: 1,
      stage2_popup_receipt_only: 1,
      stage2_popup_kot_only: 1,
      stage2_popup_kot_receipt: 1
    };

    await pool.query(
      `INSERT INTO receipt_settings (
        restaurant_id, restaurant_name, branch_name, address, phone, whatsapp, email, website,
        gst_number, fssai_number, logo_url, header_message, footer_message, thank_you_message,
        terms_conditions, paper_size, font_size, header_alignment, show_logo, show_qr_code,
        show_customer_details, show_cashier_name, show_tax_details, show_payment_details,
        show_footer_notes, kot_header, kitchen_name, kot_footer_note, show_kot_order_notes, show_kot_time,
        gst_mode, default_gst_rate, print_stage1_mode, print_stage2_mode, allow_cashier_view_all_reports,
        enable_whatsapp_receipt, whatsapp_business_phone, enable_stage2_popup, gst_enabled,
        stage1_popup_save_only, stage1_popup_receipt_only, stage1_popup_kot_only, stage1_popup_kot_receipt,
        stage2_popup_save_only, stage2_popup_receipt_only, stage2_popup_kot_only, stage2_popup_kot_receipt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        restaurantId, defaultSettings.restaurant_name, defaultSettings.branch_name, defaultSettings.address,
        defaultSettings.phone, defaultSettings.whatsapp, defaultSettings.email, defaultSettings.website,
        defaultSettings.gst_number, defaultSettings.fssai_number, defaultSettings.logo_url, defaultSettings.header_message,
        defaultSettings.footer_message, defaultSettings.thank_you_message, defaultSettings.terms_conditions,
        defaultSettings.paper_size, defaultSettings.font_size, defaultSettings.header_alignment,
        defaultSettings.show_logo, defaultSettings.show_qr_code, defaultSettings.show_customer_details,
        defaultSettings.show_cashier_name, defaultSettings.show_tax_details, defaultSettings.show_payment_details,
        defaultSettings.show_footer_notes, defaultSettings.kot_header, defaultSettings.kitchen_name,
        defaultSettings.kot_footer_note, defaultSettings.show_kot_order_notes, defaultSettings.show_kot_time,
        defaultSettings.gst_mode, defaultSettings.default_gst_rate, defaultSettings.print_stage1_mode,
        defaultSettings.print_stage2_mode, defaultSettings.allow_cashier_view_all_reports,
        defaultSettings.enable_whatsapp_receipt, defaultSettings.whatsapp_business_phone, defaultSettings.enable_stage2_popup,
        defaultSettings.gst_enabled,
        defaultSettings.stage1_popup_save_only, defaultSettings.stage1_popup_receipt_only,
        defaultSettings.stage1_popup_kot_only, defaultSettings.stage1_popup_kot_receipt,
        defaultSettings.stage2_popup_save_only, defaultSettings.stage2_popup_receipt_only,
        defaultSettings.stage2_popup_kot_only, defaultSettings.stage2_popup_kot_receipt
      ]
    );

    const [newRows] = await pool.query(
      'SELECT * FROM receipt_settings WHERE restaurant_id = ?',
      [restaurantId]
    );

    return newRows[0];
  }

  /**
   * Save or update receipt settings for a restaurant.
   */
  static async update(restaurantId, data) {
    // Ensure settings exist first
    await this.getByRestaurantId(restaurantId);

    if (data.gst_enabled !== undefined) {
      const gstVal = data.gst_enabled ? 1 : 0;
      try {
        await pool.query('UPDATE restaurants SET gst_enabled = ? WHERE id = ?', [gstVal, restaurantId]);
      } catch (err) {
        console.warn('[Update Restaurants GST Alert]', err.message);
      }
    }

    const fields = [
      'restaurant_name', 'branch_name', 'address', 'phone', 'whatsapp', 'email', 'website',
      'gst_number', 'fssai_number', 'logo_url', 'header_message', 'footer_message',
      'thank_you_message', 'terms_conditions', 'paper_size', 'font_size', 'header_alignment',
      'show_logo', 'show_qr_code', 'show_customer_details', 'show_cashier_name',
      'show_tax_details', 'show_payment_details', 'show_footer_notes',
      'kot_header', 'kitchen_name', 'kot_footer_note', 'show_kot_order_notes', 'show_kot_time',
      'gst_mode', 'default_gst_rate', 'print_stage1_mode', 'print_stage2_mode', 'allow_cashier_view_all_reports',
      'enable_whatsapp_receipt', 'whatsapp_business_phone', 'enable_stage2_popup', 'gst_enabled',
      'stage1_popup_save_only', 'stage1_popup_receipt_only', 'stage1_popup_kot_only', 'stage1_popup_kot_receipt',
      'stage2_popup_save_only', 'stage2_popup_receipt_only', 'stage2_popup_kot_only', 'stage2_popup_kot_receipt'
    ];

    const updates = [];
    const values = [];

    fields.forEach(f => {
      if (data[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(data[f]);
      }
    });

    if (updates.length === 0) return await this.getByRestaurantId(restaurantId);

    values.push(restaurantId);

    await pool.query(
      `UPDATE receipt_settings SET ${updates.join(', ')} WHERE restaurant_id = ?`,
      values
    );

    return await this.getByRestaurantId(restaurantId);
  }
}

module.exports = ReceiptRepository;
