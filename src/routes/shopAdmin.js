import { Router } from 'express';
import {
  getMyShop,
  updateMyShop,
  updateShopSchema,
  listMyCategories,
  createMyCategory,
  updateMyCategory,
  deleteMyCategory,
  shopCategorySchema,
  listMyProducts,
  createMyProduct,
  updateMyProduct,
  deleteMyProduct,
  productSchema,
} from '../controllers/shopController.js';
import {
  listMyOrders,
  getMyOrder,
  setOrderStatus,
  shopStats,
} from '../controllers/orderController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// Shopkeeper panel — shopkeepers (and admins, though they manage via /admin) only.
router.use(requireAuth, requireRole('admin', 'shopkeeper'));

// Shop profile
router.get('/shop', getMyShop);
router.put('/shop', validate(updateShopSchema), updateMyShop);

// Stats
router.get('/stats', shopStats);

// Categories
router.get('/categories', listMyCategories);
router.post('/categories', validate(shopCategorySchema), createMyCategory);
router.put('/categories/:id', validate(shopCategorySchema.partial()), updateMyCategory);
router.delete('/categories/:id', deleteMyCategory);

// Products
router.get('/products', listMyProducts);
router.post('/products', validate(productSchema), createMyProduct);
router.put('/products/:id', validate(productSchema.partial()), updateMyProduct);
router.delete('/products/:id', deleteMyProduct);

// Orders
router.get('/orders', listMyOrders);
router.get('/orders/:id', getMyOrder);
router.patch('/orders/:id/status', setOrderStatus);

export default router;
