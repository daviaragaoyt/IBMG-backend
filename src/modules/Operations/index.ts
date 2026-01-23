import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';
import { PersonType, CheckpointCategory } from '@prisma/client';
import { startOfDay, endOfDay } from 'date-fns';

const router = Router();
const SERVICE_CATEGORIES = ['PROPHETIC', 'PRAYER', 'EVANGELISM', 'CONSOLIDATION', 'STORE'];

const CountSchema = z.object({
    checkpointId: z.string().min(1),
    type: z.enum(['MEMBER', 'VISITOR']),
    church: z.string().optional(),
    quantity: z.number().min(1).default(1),
    ageGroup: z.string().optional(),
    gender: z.string().optional(),
    marketingSource: z.string().nullable().optional()
});

router.get('/checkpoints', async (req, res) => {
    const list = await prisma.checkpoint.findMany({ orderBy: { name: 'asc' } });
    res.json(list);
});

router.post('/count', async (req, res) => {
    try {
        const data = CountSchema.parse(req.body);
        // Debounce simples
        const lastEntry = await prisma.manualEntry.findFirst({
            where: { checkpointId: data.checkpointId, type: data.type as PersonType },
            orderBy: { timestamp: 'desc' }
        });
        if (lastEntry && (new Date().getTime() - new Date(lastEntry.timestamp).getTime() < 500)) {
            return res.json({ success: true, ignored: true });
        }

        const entry = await prisma.manualEntry.create({
            data: {
                checkpointId: data.checkpointId,
                type: data.type as PersonType,
                church: data.church || 'Ibmg Sede',
                ageGroup: data.ageGroup || 'ADULTO',
                gender: data.gender || 'M',
                quantity: data.quantity,
                marketingSource: data.marketingSource
            }
        });
        res.json({ success: true, entry });
    } catch (error) { res.status(400).json({ error: "Erro count" }); }
});

router.post('/track', async (req, res) => {
    const { personId, checkpointId } = req.body;
    try {
        const checkpoint = await prisma.checkpoint.findUnique({ where: { id: checkpointId } });
        if (!checkpoint) return res.status(404).json({ error: "Local não encontrado" });

        const allowReentry = SERVICE_CATEGORIES.includes(String(checkpoint.category));
        const todayStart = startOfDay(new Date());

        const existing = await prisma.movement.findFirst({
            where: { personId, checkpointId, timestamp: { gte: todayStart } },
            include: { person: true }
        });

        if (existing) {
            if ((new Date().getTime() - new Date(existing.timestamp).getTime()) / 1000 < 60) return res.json({ success: true, status: 'IGNORED', message: "⏳ Aguarde..." });
            if (!allowReentry) return res.json({ success: true, status: 'REENTRY', message: `⚠️ Já entrou hoje.` });
        }

        const newMove = await prisma.movement.create({
            data: { personId, checkpointId },
            include: { person: true }
        });
        res.json({ success: true, status: 'SUCCESS', person: newMove.person });
    } catch (error) { res.status(500).json({ error: "Erro track" }); }
});

export default router;