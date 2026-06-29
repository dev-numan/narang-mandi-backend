import { Router } from 'express';
import {
  listPlaces,
  submitPlace,
  listPlaceCategories,
  placeSubmitSchema,
} from '../controllers/placeController.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// Public
router.get('/', listPlaces);
router.get('/categories', listPlaceCategories);
router.post('/', validate(placeSubmitSchema), submitPlace);

export default router;
