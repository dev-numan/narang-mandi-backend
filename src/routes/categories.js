import { Router } from 'express';
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  categorySchema,
} from '../controllers/categoryController.js';
import { requireAuth, requireCategoryManage } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.get('/', listCategories);
router.post('/', requireAuth, requireCategoryManage, validate(categorySchema), createCategory);
router.put('/:id', requireAuth, requireCategoryManage, validate(categorySchema.partial()), updateCategory);
router.delete('/:id', requireAuth, requireCategoryManage, deleteCategory);

export default router;
