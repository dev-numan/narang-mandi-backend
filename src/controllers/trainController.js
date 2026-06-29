import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { serializeTrain } from '../lib/serialize.js';

export const trainSchema = z.object({
  name: z.string().min(1),
  nameEn: z.string().optional().default(''),
  trainType: z.string().optional().default(''),
  upRoute: z.string().optional().default(''),
  upNumber: z.string().optional().default(''),
  upArrival: z.string().optional().default(''),
  upDeparture: z.string().optional().default(''),
  downRoute: z.string().optional().default(''),
  downNumber: z.string().optional().default(''),
  downArrival: z.string().optional().default(''),
  downDeparture: z.string().optional().default(''),
  classes: z.string().optional().default(''),
  order: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

// GET /api/trains — public, active trains in display order.
export const listTrains = asyncHandler(async (req, res) => {
  const where = req.query.all === 'true' ? {} : { isActive: true };
  const trains = await prisma.train.findMany({
    where,
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  });
  res.json({ success: true, data: trains.map(serializeTrain) });
});

export const createTrain = asyncHandler(async (req, res) => {
  const train = await prisma.train.create({ data: req.body });
  res.status(201).json({ success: true, data: serializeTrain(train), message: 'Train created' });
});

export const updateTrain = asyncHandler(async (req, res) => {
  const train = await prisma.train.findUnique({ where: { id: req.params.id } });
  if (!train) throw new ApiError(404, 'Train not found');
  const updated = await prisma.train.update({ where: { id: train.id }, data: req.body });
  res.json({ success: true, data: serializeTrain(updated), message: 'Train updated' });
});

export const deleteTrain = asyncHandler(async (req, res) => {
  const train = await prisma.train.findUnique({ where: { id: req.params.id } });
  if (!train) throw new ApiError(404, 'Train not found');
  await prisma.train.delete({ where: { id: train.id } });
  res.json({ success: true, message: 'Train deleted' });
});
