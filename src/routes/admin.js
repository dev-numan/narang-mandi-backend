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
import {
  adminListPlaces,
  createPlace,
  updatePlace,
  setPlaceStatus,
  deletePlace,
  createPlaceCategory,
  updatePlaceCategory,
  deletePlaceCategory,
  placeAdminSchema,
  placeCategorySchema,
} from '../controllers/placeController.js';
import {
  listThreads as adminListThreads,
  adminDeleteThread,
  adminDeleteMessage,
  adminLockThread,
} from '../controllers/communityController.js';
import {
  createTrain,
  updateTrain,
  deleteTrain,
  trainSchema,
} from '../controllers/trainController.js';
import {
  adminListClassifieds,
  createClassified,
  updateClassified,
  setClassifiedStatus,
  deleteClassified,
  createClassifiedCategory,
  updateClassifiedCategory,
  deleteClassifiedCategory,
  classifiedAdminSchema,
  classifiedCategorySchema,
} from '../controllers/classifiedController.js';
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

// Places — any authenticated admin/editor can manage & moderate
router.get('/places', adminListPlaces);
router.post('/places', validate(placeAdminSchema), createPlace);
router.put('/places/:id', validate(placeAdminSchema.partial()), updatePlace);
router.patch('/places/:id/status', setPlaceStatus);
router.delete('/places/:id', deletePlace);

// Place categories
router.post('/place-categories', validate(placeCategorySchema), createPlaceCategory);
router.put('/place-categories/:id', validate(placeCategorySchema.partial()), updatePlaceCategory);
router.delete('/place-categories/:id', deletePlaceCategory);

// Community moderation
router.get('/community/threads', adminListThreads);
router.patch('/community/threads/:id/lock', adminLockThread);
router.delete('/community/threads/:id', adminDeleteThread);
router.delete('/community/messages/:id', adminDeleteMessage);

// Trains
router.post('/trains', validate(trainSchema), createTrain);
router.put('/trains/:id', validate(trainSchema.partial()), updateTrain);
router.delete('/trains/:id', deleteTrain);

// Classifieds
router.get('/classifieds', adminListClassifieds);
router.post('/classifieds', validate(classifiedAdminSchema), createClassified);
router.put('/classifieds/:id', validate(classifiedAdminSchema.partial()), updateClassified);
router.patch('/classifieds/:id/status', setClassifiedStatus);
router.delete('/classifieds/:id', deleteClassified);
router.post('/classified-categories', validate(classifiedCategorySchema), createClassifiedCategory);
router.put('/classified-categories/:id', validate(classifiedCategorySchema.partial()), updateClassifiedCategory);
router.delete('/classified-categories/:id', deleteClassifiedCategory);

export default router;
