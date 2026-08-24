const CategoryRepository = require('../repositories/category_repository');
const SuperAdminRepository = require('../repositories/superadmin_repository');

class CategoryController {
  static async getAll(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const categories = await CategoryRepository.getAll(restaurantId);
      return res.json(categories);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to fetch categories.' });
    }
  }

  static async getById(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const category = await CategoryRepository.getById(req.params.id, restaurantId);
      if (!category) {
        return res.status(404).json({ error: 'Category not found.' });
      }
      return res.json(category);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to fetch category.' });
    }
  }

  static async create(req, res) {
    const { name, description, seq } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Category name is required.' });
    }

    try {
      const restaurantId = req.user.restaurant_id;
      const categoryId = await CategoryRepository.create(restaurantId, { name, description, seq });
      await SuperAdminRepository.addAuditLog(restaurantId, req.user.id, 'CATEGORY_CREATE', `Created category: ${name} (ID: ${categoryId})`, req.ip);
      
      return res.status(201).json({ message: 'Category created successfully.', id: categoryId });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to create category.' });
    }
  }

  static async update(req, res) {
    const { name, description, seq } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Category name is required.' });
    }

    try {
      const restaurantId = req.user.restaurant_id;
      const success = await CategoryRepository.update(req.params.id, restaurantId, { name, description, seq });
      if (!success) {
        return res.status(404).json({ error: 'Category not found or unauthorized.' });
      }
      await SuperAdminRepository.addAuditLog(restaurantId, req.user.id, 'CATEGORY_UPDATE', `Updated category: ${name} (ID: ${req.params.id})`, req.ip);
      
      return res.json({ message: 'Category updated successfully.' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to update category.' });
    }
  }

  static async delete(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const success = await CategoryRepository.delete(req.params.id, restaurantId);
      if (!success) {
        return res.status(404).json({ error: 'Category not found or unauthorized.' });
      }
      await SuperAdminRepository.addAuditLog(restaurantId, req.user.id, 'CATEGORY_DELETE', `Deleted category (ID: ${req.params.id})`, req.ip);
      
      return res.json({ message: 'Category deleted successfully.' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to delete category.' });
    }
  }

  static async reorder(req, res) {
    const { sequences } = req.body; // Expects array of { id, seq }
    if (!Array.isArray(sequences)) {
      return res.status(400).json({ error: 'Sequences array is required.' });
    }

    try {
      const restaurantId = req.user.restaurant_id;
      await CategoryRepository.updateSequence(restaurantId, sequences);
      await SuperAdminRepository.addAuditLog(restaurantId, req.user.id, 'CATEGORY_REORDER', `Reordered categories sequence`, req.ip);
      
      return res.json({ message: 'Categories sequence updated successfully.' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to reorder categories.' });
    }
  }
}

module.exports = CategoryController;
