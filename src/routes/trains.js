import { Router } from 'express';
import { listTrains } from '../controllers/trainController.js';

const router = Router();

// Public
router.get('/', listTrains);

export default router;
