import { Router } from 'express';
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  categorySchema,
} from '../controllers/categoryController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.get('/', listCategories);
router.post('/', requireAuth, validate(categorySchema), createCategory);
router.put('/:id', requireAuth, validate(categorySchema.partial()), updateCategory);
router.delete('/:id', requireAuth, deleteCategory);

export default router;
