const CustomerRepository = require('../repositories/customer_repository');
const CustomerLedgerRepository = require('../repositories/customer_ledger_repository');

class CustomerController {
  static async getAll(req, res) {
    try {
      const restaurantId = req.user.restaurant_id || req.user.restaurantId;
      const { search, limit } = req.query;
      const customers = await CustomerRepository.getAll(restaurantId, search, limit);
      return res.json(customers);
    } catch (err) {
      console.error('[CustomerController.getAll error]:', err);
      return res.status(500).json({ error: 'Failed to retrieve customers.' });
    }
  }

  static async getById(req, res) {
    try {
      const restaurantId = req.user.restaurant_id || req.user.restaurantId;
      const customer = await CustomerRepository.getById(req.params.id, restaurantId);
      if (!customer) {
        return res.status(404).json({ error: 'Customer not found.' });
      }
      return res.json(customer);
    } catch (err) {
      console.error('[CustomerController.getById error]:', err);
      return res.status(500).json({ error: 'Failed to retrieve customer details.' });
    }
  }

  static async create(req, res) {
    try {
      const restaurantId = req.user.restaurant_id || req.user.restaurantId;
      const {
        name, phone, email, address, store_name, gst_number, notes,
        contact_person, shipping_address, place_of_supply, pan_number, credit_limit
      } = req.body;

      if (!name && !store_name && !phone) {
        return res.status(400).json({ error: 'Party/Customer Name, Store Name, or Phone Number is required.' });
      }

      const newCustomer = await CustomerRepository.create(restaurantId, {
        name,
        phone,
        email,
        address,
        store_name,
        gst_number,
        notes,
        contact_person,
        shipping_address,
        place_of_supply,
        pan_number,
        credit_limit
      });

      return res.status(201).json({
        message: 'Party created successfully.',
        customer: newCustomer,
        ...newCustomer
      });
    } catch (err) {
      console.error('[CustomerController.create error]:', err);
      return res.status(500).json({ error: 'Failed to create party.' });
    }
  }

  static async update(req, res) {
    try {
      const restaurantId = req.user.restaurant_id || req.user.restaurantId;
      const success = await CustomerRepository.update(req.params.id, restaurantId, req.body);
      if (!success) {
        return res.status(404).json({ error: 'Party not found or no changes made.' });
      }
      return res.json({ message: 'Party updated successfully.' });
    } catch (err) {
      console.error('[CustomerController.update error]:', err);
      return res.status(500).json({ error: 'Failed to update party.' });
    }
  }

  static async getOrderHistory(req, res) {
    try {
      const restaurantId = req.user.restaurant_id || req.user.restaurantId;
      const orders = await CustomerRepository.getOrderHistory(req.params.id, restaurantId);
      return res.json(orders);
    } catch (err) {
      console.error('[CustomerController.getOrderHistory error]:', err);
      return res.status(500).json({ error: 'Failed to retrieve order history.' });
    }
  }

  static async getChargePresets(req, res) {
    try {
      const restaurantId = req.user.restaurant_id || req.user.restaurantId;
      const presets = await CustomerRepository.getChargePresets(restaurantId);
      return res.json(presets);
    } catch (err) {
      console.error('[CustomerController.getChargePresets error]:', err);
      return res.status(500).json({ error: 'Failed to retrieve charge presets.' });
    }
  }

  static async addChargePreset(req, res) {
    try {
      const restaurantId = req.user.restaurant_id || req.user.restaurantId;
      const { name, default_amount } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Charge name is required.' });
      }
      const preset = await CustomerRepository.addChargePreset(restaurantId, name, default_amount);
      return res.status(201).json({ message: 'Charge preset added.', preset });
    } catch (err) {
      console.error('[CustomerController.addChargePreset error]:', err);
      return res.status(500).json({ error: 'Failed to add charge preset.' });
    }
  }

  static async findOrCreate(req, res) {
    try {
      const restaurantId = req.user.restaurant_id || req.user.restaurantId;
      const customer = await CustomerRepository.findOrCreate(restaurantId, req.body);
      return res.json({ customer });
    } catch (err) {
      console.error('[CustomerController.findOrCreate error]:', err);
      return res.status(500).json({ error: 'Failed to resolve customer.' });
    }
  }

  static async getLedger(req, res) {
    try {
      const restaurantId = req.user.restaurant_id || req.user.restaurantId;
      const { limit, offset } = req.query;
      const ledgerData = await CustomerLedgerRepository.getLedger(req.params.id, restaurantId, limit, offset);
      return res.json(ledgerData);
    } catch (err) {
      console.error('[CustomerController.getLedger error]:', err);
      return res.status(500).json({ error: 'Failed to retrieve customer ledger.' });
    }
  }

  static async recordPayment(req, res) {
    try {
      const restaurantId = req.user.restaurant_id || req.user.restaurantId;
      const customerId = req.params.id;
      const { amount, payment_mode, reference_number, notes } = req.body;

      if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        return res.status(400).json({ error: 'Valid payment amount > 0 is required.' });
      }

      const result = await CustomerLedgerRepository.recordPayment(restaurantId, {
        customerId,
        amount: parseFloat(amount),
        paymentMode: payment_mode || 'cash',
        referenceNumber: reference_number || null,
        notes: notes || null,
        userId: req.user.id,
        userName: req.user.name
      });

      return res.status(201).json({
        message: 'Payment recorded successfully.',
        ...result
      });
    } catch (err) {
      console.error('[CustomerController.recordPayment error]:', err);
      return res.status(500).json({ error: err.message || 'Failed to record customer payment.' });
    }
  }
}

module.exports = CustomerController;
