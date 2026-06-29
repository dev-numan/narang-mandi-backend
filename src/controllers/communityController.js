import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { uniqueSlug } from '../utils/slugify.js';
import { serializeThread, serializeMessage } from '../lib/serialize.js';
import { emitMessage, emitReaction } from '../lib/socket.js';

const NAME = z.string().trim().max(40).optional();

export const threadSchema = z.object({
  title: z.string().trim().min(2).max(140),
  description: z.string().trim().max(1000).optional().default(''),
  authorName: NAME,
  clientId: z.string().max(64).optional().default(''),
});

export const messageSchema = z.object({
  content: z.string().trim().min(1).max(2000),
  authorName: NAME,
  clientId: z.string().max(64).optional().default(''),
  replyToId: z.string().nullable().optional(),
});

export const reactionSchema = z.object({
  emoji: z.string().min(1).max(8),
  clientId: z.string().min(1).max(64),
});

const cleanName = (name) => {
  const n = (name || '').trim();
  return n || 'گمنام';
};

const REPLY_BRIEF = {
  select: { id: true, authorName: true, content: true },
};

// GET /api/community/threads — newest activity first.
export const listThreads = asyncHandler(async (req, res) => {
  const threads = await prisma.thread.findMany({
    orderBy: [{ lastActivityAt: 'desc' }],
    include: { _count: { select: { messages: true } } },
  });
  res.json({ success: true, data: threads.map(serializeThread) });
});

// POST /api/community/threads — anyone can open a thread.
export const createThread = asyncHandler(async (req, res) => {
  const slug = await uniqueSlug(prisma.thread, req.body.title);
  const thread = await prisma.thread.create({
    data: {
      title: req.body.title,
      description: req.body.description || '',
      authorName: cleanName(req.body.authorName),
      clientId: req.body.clientId || '',
      slug,
    },
    include: { _count: { select: { messages: true } } },
  });
  res.status(201).json({ success: true, data: serializeThread(thread), message: 'تھریڈ بن گیا' });
});

// GET /api/community/threads/:slug — thread + all messages (with reactions & replies).
export const getThread = asyncHandler(async (req, res) => {
  const clientId = req.query.clientId || '';
  const thread = await prisma.thread.findUnique({
    where: { slug: req.params.slug },
    include: { _count: { select: { messages: true } } },
  });
  if (!thread) throw new ApiError(404, 'Thread not found');

  const messages = await prisma.message.findMany({
    where: { threadId: thread.id },
    orderBy: [{ createdAt: 'asc' }],
    include: { replyTo: REPLY_BRIEF, reactions: true },
  });

  res.json({
    success: true,
    data: {
      thread: serializeThread(thread),
      messages: messages.map((m) => serializeMessage(m, clientId)),
    },
  });
});

// POST /api/community/threads/:slug/messages — post a message (optionally a reply).
export const postMessage = asyncHandler(async (req, res) => {
  const thread = await prisma.thread.findUnique({ where: { slug: req.params.slug } });
  if (!thread) throw new ApiError(404, 'Thread not found');
  if (thread.isLocked) throw new ApiError(403, 'یہ تھریڈ بند ہے');

  // Validate replyToId belongs to this thread (ignore if stale).
  let replyToId = null;
  if (req.body.replyToId) {
    const parent = await prisma.message.findFirst({
      where: { id: req.body.replyToId, threadId: thread.id },
      select: { id: true },
    });
    replyToId = parent?.id || null;
  }

  const message = await prisma.message.create({
    data: {
      threadId: thread.id,
      content: req.body.content,
      authorName: cleanName(req.body.authorName),
      clientId: req.body.clientId || '',
      replyToId,
    },
    include: { replyTo: REPLY_BRIEF, reactions: true },
  });

  await prisma.thread.update({
    where: { id: thread.id },
    data: { lastActivityAt: new Date() },
  });

  // Broadcast to everyone in the room (neutral serialization — `mine` is false;
  // a brand-new message has no reactions yet anyway).
  emitMessage(req.app.get('io'), thread.slug, serializeMessage(message, ''));

  res.status(201).json({ success: true, data: serializeMessage(message, req.body.clientId || '') });
});

// POST /api/community/messages/:id/reactions — toggle one emoji for this browser.
export const toggleReaction = asyncHandler(async (req, res) => {
  const { emoji, clientId } = req.body;
  const message = await prisma.message.findUnique({ where: { id: req.params.id } });
  if (!message) throw new ApiError(404, 'Message not found');

  const existing = await prisma.reaction.findUnique({
    where: { messageId_emoji_clientId: { messageId: message.id, emoji, clientId } },
  });
  if (existing) {
    await prisma.reaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.reaction.create({ data: { messageId: message.id, emoji, clientId } });
  }

  const reactions = await prisma.reaction.findMany({ where: { messageId: message.id } });
  // Neutral counts (no `mine`) for the broadcast; each client keeps its own flags.
  const neutral = serializeMessage({ ...message, reactions }, '');
  const thread = await prisma.thread.findUnique({
    where: { id: message.threadId },
    select: { slug: true },
  });
  emitReaction(req.app.get('io'), thread?.slug, {
    messageId: message.id,
    reactions: neutral.reactions,
  });

  const fresh = serializeMessage({ ...message, reactions }, clientId);
  res.json({ success: true, data: { _id: message.id, reactions: fresh.reactions } });
});

// ---------- Admin moderation ----------

export const adminDeleteThread = asyncHandler(async (req, res) => {
  const thread = await prisma.thread.findUnique({ where: { id: req.params.id } });
  if (!thread) throw new ApiError(404, 'Thread not found');
  await prisma.thread.delete({ where: { id: thread.id } }); // cascades messages/reactions
  res.json({ success: true, message: 'Thread deleted' });
});

export const adminDeleteMessage = asyncHandler(async (req, res) => {
  const message = await prisma.message.findUnique({ where: { id: req.params.id } });
  if (!message) throw new ApiError(404, 'Message not found');
  await prisma.message.delete({ where: { id: message.id } });
  res.json({ success: true, message: 'Message deleted' });
});

export const adminLockThread = asyncHandler(async (req, res) => {
  const thread = await prisma.thread.findUnique({ where: { id: req.params.id } });
  if (!thread) throw new ApiError(404, 'Thread not found');
  const updated = await prisma.thread.update({
    where: { id: thread.id },
    data: { isLocked: !thread.isLocked },
    include: { _count: { select: { messages: true } } },
  });
  res.json({ success: true, data: serializeThread(updated) });
});
