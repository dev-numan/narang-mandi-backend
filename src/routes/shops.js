import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  listShops,
  getShop,
  listShopProducts,
  getShopProduct,
} from '../controllers/shopController.js';
import {
  placeOrder,
  lookupOrder,
  placeOrderSchema,
  lookupOrderSchema,
} from '../controllers/orderController.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// Light anti-spam on public writes.
const orderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'بہت زیادہ درخواستیں، براہِ کرم تھوڑی دیر بعد کوشش کریں' },
});

// Static segments before /:slug (route-ordering caveat).
router.get('/', listShops);
router.post('/orders/lookup', orderLimiter, validate(lookupOrderSchema), lookupOrder);
router.get('/:slug', getShop);
router.get('/:slug/products', listShopProducts);
router.get('/:slug/products/:productSlug', getShopProduct);
router.post('/:slug/orders', orderLimiter, validate(placeOrderSchema), placeOrder);

export default router;
