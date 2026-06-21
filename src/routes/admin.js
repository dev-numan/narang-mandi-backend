import { Router } from 'express';
import {
  adminListArticles,
  adminGetArticle,
  adminStats,
} from '../controllers/articleController.js';
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  createUserSchema,
  updateUserSchema,
} from '../controllers/userController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.use(requireAuth);

router.get('/stats', adminStats);
router.get('/articles', adminListArticles);
router.get('/articles/:id', adminGetArticle);

// User management — admin role only
router.get('/users', requireRole('admin'), listUsers);
router.post('/users', requireRole('admin'), validate(createUserSchema), createUser);
router.put('/users/:id', requireRole('admin'), validate(updateUserSchema), updateUser);
router.delete('/users/:id', requireRole('admin'), deleteUser);

export default router;
