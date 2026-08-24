const express = require('express');
const CategoryController = require('../controllers/category_controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth_middleware');
const router = express.Router();

router.use(authenticateToken);

router.get('/', CategoryController.getAll);
router.get('/:id', CategoryController.getById);

// Admin and Manager can create, update, and reorder sequence
router.post('/', authorizeRoles('admin', 'manager'), CategoryController.create);
router.put('/:id', authorizeRoles('admin', 'manager'), CategoryController.update);
router.post('/reorder', authorizeRoles('admin', 'manager'), CategoryController.reorder);
router.put('/reorder', authorizeRoles('admin', 'manager'), CategoryController.reorder);
router.post('/sequence', authorizeRoles('admin', 'manager'), CategoryController.reorder);
router.put('/sequence', authorizeRoles('admin', 'manager'), CategoryController.reorder);

// Only Admin can delete categories
router.delete('/:id', authorizeRoles('admin'), CategoryController.delete);

module.exports = router;
