import { Router } from 'express';
import { prisma } from '../../lib/prisma';

const router = Router();

router.get('/meeting-count', async (req, res) => {
    const config = await prisma.globalConfig.findUnique({ where: { key: 'MEETING_COUNT' } });
    res.json({ count: config ? Number(config.value) : 0 });
});

router.post('/meeting-count/increment', async (req, res) => {
    const current = await prisma.globalConfig.findUnique({ where: { key: 'MEETING_COUNT' } });
    const newValue = current ? Number(current.value) + 1 : 1;
    await prisma.globalConfig.upsert({
        where: { key: 'MEETING_COUNT' },
        update: { value: String(newValue) },
        create: { key: 'MEETING_COUNT', value: "1" }
    });
    res.json({ count: newValue });
});

router.post('/consolidation/save', async (req, res) => {
    try {
        const { name, phone, decision, observer } = req.body;
        const person = await prisma.person.create({
            data: { name, phone, type: 'VISITOR', role: 'PARTICIPANT', marketingSource: `Decisão: ${decision}`, church: 'Consolidação', department: observer }
        });
        res.json({ success: true, person });
    } catch (e) { res.status(500).json({ error: "Erro ficha" }); }
});
router.get('/dashboard', async (req, res) => {
    const start = new Date('2026-01-01');
    const end = new Date('2026-12-31');

    // Buscas Paralelas
    const [manual, scanner, sales, meetings, consolidation] = await Promise.all([
        // 1. Contagens Manuais
        prisma.manualEntry.findMany({ where: { timestamp: { gte: start, lte: end } }, include: { checkpoint: true } }),
        // 2. Movimento Scanner
        prisma.movement.findMany({ where: { timestamp: { gte: start, lte: end } }, include: { checkpoint: true, person: true } }),
        // 3. Vendas
        prisma.sale.findMany({ where: { timestamp: { gte: start, lte: end } }, include: { items: { include: { product: true } }, checkpoint: true } }),
        // 4. Reuniões (NOVO)
        prisma.meeting.groupBy({ by: ['type'], _count: { id: true } }),
        // 5. Consolidação (NOVO)
        prisma.person.count({ where: { marketingSource: { startsWith: 'Decisão' } } })
    ]);

    // Processamento de Vendas
    const salesStats: any = { totalRevenue: 0, byCategory: { CANTINA: 0, LOJA: 0 }, demographics: { MEMBER: 0, VISITOR: 0, M: 0, F: 0 } };
    sales.forEach(s => {
        salesStats.totalRevenue += Number(s.total);
        const cat = s.checkpoint?.category === 'STORE' ? 'LOJA' : 'CANTINA';
        salesStats.byCategory[cat] = (salesStats.byCategory[cat] || 0) + Number(s.total);
        if (s.buyerType) salesStats.demographics[s.buyerType]++;
        if (s.buyerGender) salesStats.demographics[s.buyerGender]++;
    });

    // Processamento de Reuniões
    const meetingStats = {
        agendadas: meetings.find(m => m.type === 'AGENDADA')?._count.id || 0,
        realizadas: meetings.find(m => m.type === 'REALIZADA')?._count.id || 0
    };

    res.json({
        salesStats,
        meetingStats,
        consolidationCount: consolidation,
        manualCount: manual.length,
        scannerCount: scanner.length
    });
});

export default router;