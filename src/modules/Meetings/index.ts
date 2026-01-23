import { Router } from 'express';
import { prisma } from '../../lib/prisma';

const router = Router();

router.get('/meetings', async (req, res) => {
    const meetings = await prisma.meeting.findMany({ orderBy: { date: 'desc' } });
    res.json(meetings);
});

router.post('/meetings', async (req, res) => {
    try {
        const { title, date, type, notes, createdBy } = req.body;
        const meeting = await prisma.meeting.create({
            data: { title, date: new Date(date), type, notes, createdBy }
        });
        res.json({ success: true, meeting });
    } catch (e) { res.status(500).json({ error: "Erro meetings" }); }
});

router.delete('/meetings/:id', async (req, res) => {
    try {
        await prisma.meeting.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erro delete" }); }
});

export default router;