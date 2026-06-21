import { Router } from 'express';
import {
  listArticles,
  carouselArticles,
  breakingArticles,
  trendingArticles,
  getArticleBySlug,
  recordView,
  createArticle,
  updateArticle,
  deleteArticle,
  articleSchema,
  updateArticleSchema,
} from '../controllers/articleController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// Public — order matters: static paths before :slug
router.get('/', listArticles);
router.get('/carousel', carouselArticles);
router.get('/breaking', breakingArticles);
router.get('/trending', trendingArticles);
router.get('/:slug', getArticleBySlug);
router.post('/:slug/view', recordView);

// Protected writes
router.post('/', requireAuth, validate(articleSchema), createArticle);
router.put('/:id', requireAuth, validate(updateArticleSchema), updateArticle);
router.delete('/:id', requireAuth, deleteArticle);

export default router;
