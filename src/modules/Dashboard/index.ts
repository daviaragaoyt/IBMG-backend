import { Router } from 'express';
import { prisma } from '../../lib/prisma';

const router = Router();

router.get('/dashboard', async (req, res) => {
    try {
        // --- 1. CONFIGURAÇÃO DE INTERVALO ---
        const start = new Date('2026-01-01T00:00:00.000Z');
        const end = new Date('2026-02-18T23:59:59.000Z');

        // Estrutura Base
        const emptyStats = () => ({
            total: 0,
            type: { VISITOR: 0, MEMBER: 0 },
            gender: { M: 0, F: 0 },
            age: { CRIANCA: 0, JOVEM: 0, ADULTO: 0 },
            marketing: {} as Record<string, number>,
            church: {} as Record<string, number>,
            accepted: 0,
            reconciled: 0
        });

        const responseData: any = {
            salesStats: {
                totalRevenue: 0,
                byCategory: { LOJA: 0, CANTINA: 0 },
                demographics: { MEMBER: 0, VISITOR: 0 }
            },
            meetingStats: { realizadas: 0, agendadas: 0 },
            checkpointsData: {},
            timeline: {},
            manualCount: 0,
            scannerCount: 0,
            consolidationCount: 0,
            availableDays: []
        };

        // Inicializa dias
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dayKey = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            if (!responseData.checkpointsData[dayKey]) {
                responseData.checkpointsData[dayKey] = {
                    'Total': emptyStats(), 'Kids': emptyStats(),
                    'Recepcao': emptyStats(), 'Consolidacao': emptyStats()
                };
                responseData.timeline[dayKey] = {};
            }
        }

        // --- 2. PROCESSAR VENDAS (FINANCEIRO REAL) ---
        const sales = await prisma.sale.findMany({
            where: { status: 'PAID', timestamp: { gte: start, lte: end } },
            include: { items: { include: { product: true } } }
        });

        sales.forEach(s => {
            let saleTotal = 0;

            s.items.forEach(i => {
                const itemPrice = Number(i.price);
                const itemTotal = itemPrice * i.quantity;
                saleTotal += itemTotal;

                const category = i.product.category ? i.product.category.toUpperCase() : 'LOJA';

                if (!responseData.salesStats.byCategory[category]) {
                    responseData.salesStats.byCategory[category] = 0;
                }
                responseData.salesStats.byCategory[category] += itemTotal;
            });

            responseData.salesStats.totalRevenue += saleTotal;

            const type = s.buyerType === 'MEMBER' ? 'MEMBER' : 'VISITOR';
            responseData.salesStats.demographics[type]++;
        });

        // --- 3. PROCESSAR FLUXO (CHECKPOINTS) ---
        const entries = await prisma.manualEntry.findMany({
            where: { timestamp: { gte: start, lte: end } },
            include: { checkpoint: true }
        });

        entries.forEach((entry: any) => {
            const entryDate = new Date(entry.timestamp);
            const dayKey = entryDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            const hour = entryDate.getHours().toString();

            if (responseData.checkpointsData[dayKey]) {
                if (!responseData.timeline[dayKey][hour]) responseData.timeline[dayKey][hour] = 0;
                responseData.timeline[dayKey][hour] += entry.quantity;

                const cpName = entry.checkpoint?.name?.toUpperCase() || '';
                const mktSource = entry.marketingSource?.toUpperCase() || '';
                let targetCategory = 'Recepcao';
                let isTotal = true;

                if (cpName.includes('DECIS') || cpName.includes('ALTAR') || mktSource.includes('DECIS')) {
                    targetCategory = 'Consolidacao';
                    isTotal = false;
                    responseData.consolidationCount += entry.quantity;
                } else if (cpName.includes('KIDS') || cpName.includes('CRIANÇA') || entry.ageGroup === 'CRIANCA') {
                    targetCategory = 'Kids';
                }

                const addToStats = (categoryName: string) => {
                    const stats = responseData.checkpointsData[dayKey][categoryName];
                    stats.total += entry.quantity;

                    if (entry.type === 'MEMBER') stats.type.MEMBER += entry.quantity; else stats.type.VISITOR += entry.quantity;
                    if (entry.gender === 'M') stats.gender.M += entry.quantity; if (entry.gender === 'F') stats.gender.F += entry.quantity;
                    if (entry.ageGroup === 'CRIANCA') stats.age.CRIANCA += entry.quantity;
                    if (entry.ageGroup === 'JOVEM') stats.age.JOVEM += entry.quantity;
                    if (entry.ageGroup === 'ADULTO') stats.age.ADULTO += entry.quantity;

                    if (entry.marketingSource) {
                        const src = entry.marketingSource;
                        if (!stats.marketing[src]) stats.marketing[src] = 0;
                        stats.marketing[src] += entry.quantity;
                    }
                    if (entry.church) {
                        const ch = entry.church;
                        if (!stats.church[ch]) stats.church[ch] = 0;
                        stats.church[ch] += entry.quantity;
                    }
                    if (targetCategory === 'Consolidacao') stats.accepted += entry.quantity;
                };

                addToStats(targetCategory);
                if (isTotal) {
                    addToStats('Total');
                    responseData.manualCount += entry.quantity;
                }
            }
        });

        // --- 4. SCANNER (INGRESSOS) ---
        // CORREÇÃO: Removemos a chamada ao prisma.ticket para evitar o erro
        responseData.scannerCount = 0;

        // --- 5. FILTRO DE DIAS ---
        const todayKey = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const mandatoryDays = ['14/02', '15/02', '16/02', '17/02'];

        responseData.availableDays = Object.keys(responseData.checkpointsData).filter(day => {
            const hasData = responseData.checkpointsData[day]['Total'].total > 0 ||
                responseData.checkpointsData[day]['Kids'].total > 0 ||
                responseData.checkpointsData[day]['Consolidacao'].total > 0;
            return day === todayKey || mandatoryDays.includes(day) || hasData;
        }).sort((a: string, b: string) => {
            const [da, ma] = a.split('/').map(Number);
            const [db, mb] = b.split('/').map(Number);
            return (ma - mb) || (da - db);
        });

        res.json(responseData);

    } catch (error) {
        console.error("Erro Dashboard:", error);
        res.status(500).json({ error: "Erro ao carregar dados" });
    }
});

export default router;