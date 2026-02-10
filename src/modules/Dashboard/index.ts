import { Router } from 'express';
import { prisma } from '../../lib/prisma';

const router = Router();

// =========================================================
// 1. CONFIGURAÇÃO GLOBAL (CONTADOR DE REUNIÕES)
// =========================================================
router.get('/meeting-count', async (req, res) => {
    try {
        const config = await prisma.globalConfig.findUnique({ where: { key: 'MEETING_COUNT' } });
        res.json({ count: config ? Number(config.value) : 0 });
    } catch (e) {
        res.status(500).json({ error: "Erro ao buscar contagem" });
    }
});

router.post('/meeting-count/increment', async (req, res) => {
    try {
        const current = await prisma.globalConfig.findUnique({ where: { key: 'MEETING_COUNT' } });
        const newValue = current ? Number(current.value) + 1 : 1;
        await prisma.globalConfig.upsert({
            where: { key: 'MEETING_COUNT' },
            update: { value: String(newValue) },
            create: { key: 'MEETING_COUNT', value: "1" }
        });
        res.json({ count: newValue });
    } catch (e) {
        res.status(500).json({ error: "Erro ao incrementar" });
    }
});

// =========================================================
// 3. DASHBOARD GERAL (GRÁFICOS E ESTATÍSTICAS)
// =========================================================
router.get('/', async (req, res) => {
    try {
        // Intervalo Fixo (Janeiro a Dezembro 2026)
        const start = new Date('2026-01-01T00:00:00.000Z');
        const end = new Date('2026-12-31T23:59:59.000Z');

        // Estrutura Base Vazia
        const emptyStats = () => ({
            total: 0,
            type: { VISITOR: 0, MEMBER: 0 },
            gender: { M: 0, F: 0 },
            age: { CRIANCA: 0, JOVEM: 0, ADULTO: 0 },
            // Marketing removido
            church: {} as Record<string, number>,
            accepted: 0,
            reconciled: 0,
            // Novos campos espirituais
            salvation: { total: 0, M: 0, F: 0, VISITOR: 0, MEMBER: 0 },
            healing: { total: 0, M: 0, F: 0, VISITOR: 0, MEMBER: 0 },
            deliverance: { total: 0, M: 0, F: 0, VISITOR: 0, MEMBER: 0 }
        });

        const responseData: any = {
            salesStats: {
                totalRevenue: 0,
                byCategory: { LOJA: 0 },
                demographics: { MEMBER: 0, VISITOR: 0 }
            },
            meetingStats: { realizadas: 0, agendadas: 0 },
            checkpointsData: {},
            timeline: {},
            manualCount: 0,
            scannerCount: 0,
            availableDays: []
        };

        // --- BUSCAS PARALELAS (OTIMIZAÇÃO) ---
        const [manual, sales, meetings] = await Promise.all([
            // 1. Contagens Manuais
            prisma.manualEntry.findMany({ where: { timestamp: { gte: start, lte: end } }, include: { checkpoint: true } }),
            // 2. Vendas Pagas
            prisma.sale.findMany({ where: { status: 'PAID', timestamp: { gte: start, lte: end } }, include: { items: { include: { product: true } } } }),
            // 3. Reuniões
            prisma.meeting.groupBy({ by: ['type'], _count: { id: true } })
        ]);

        // --- PROCESSAR VENDAS ---
        sales.forEach(s => {
            let saleTotal = 0;

            // 1. Soma os Itens
            s.items.forEach(i => {
                const itemTotal = Number(i.price) * i.quantity;
                saleTotal += itemTotal;

                // TUDO VAI PARA LOJA
                responseData.salesStats.byCategory.LOJA = (responseData.salesStats.byCategory.LOJA || 0) + itemTotal;
            });

            responseData.salesStats.totalRevenue += saleTotal;

            // 2. Conta se foi Membro ou Visitante
            const type = s.buyerType === 'MEMBER' ? 'MEMBER' : 'VISITOR';
            responseData.salesStats.demographics[type]++;
        });

        // --- PROCESSAR REUNIÕES ---
        responseData.meetingStats.agendadas = meetings.find(m => m.type === 'AGENDADA')?._count.id || 0;
        responseData.meetingStats.realizadas = meetings.find(m => m.type === 'REALIZADA')?._count.id || 0;

        // --- PROCESSAR CHECKPOINTS (MANUAL ENTRY) ---
        manual.forEach((entry: any) => {
            const entryDate = new Date(entry.timestamp);
            const dayKey = entryDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

            // Inicializa o dia se não existir
            if (!responseData.checkpointsData[dayKey]) {
                responseData.checkpointsData[dayKey] = {
                    'Total': emptyStats()
                };
            }

            const dayStats = responseData.checkpointsData[dayKey];

            // DIAGNOSTIC LOGGING
            if (!entry.checkpoint) {
                console.warn(`⚠️ [Dashboard] ManualEntry ${entry.id} has NO Checkpoint relation! ID: ${entry.checkpointId}`);
            } else if (!entry.checkpoint.name) {
                console.warn(`⚠️ [Dashboard] ManualEntry ${entry.id} has Checkpoint with EMPTY name! ID: ${entry.checkpointId}`);
            }

            const name = entry.checkpoint && entry.checkpoint.name ? entry.checkpoint.name.trim() : `Local Indefinido (ID: ${entry.checkpointId.substring(0, 8)})`;

            // Inicializa o checkpoint específico se não existir
            if (!dayStats[name]) dayStats[name] = emptyStats();

            // Função auxiliar para somar estatísticas no objeto alvo
            const addToStats = (stats: any) => {
                stats.total += entry.quantity;

                if (entry.type === 'MEMBER') stats.type.MEMBER += entry.quantity;
                else stats.type.VISITOR += entry.quantity;

                if (entry.gender === 'M') stats.gender.M += entry.quantity;
                if (entry.gender === 'F') stats.gender.F += entry.quantity;

                if (entry.ageGroup) {
                    const ageKey = entry.ageGroup as keyof typeof stats.age;
                    if (stats.age[ageKey] !== undefined) stats.age[ageKey] += entry.quantity;
                }

                // Espiritual
                if (entry.isSalvation) {
                    stats.salvation.total += entry.quantity;
                    if (entry.gender === 'M') stats.salvation.M += entry.quantity;
                    if (entry.gender === 'F') stats.salvation.F += entry.quantity;
                    if (entry.type === 'VISITOR') stats.salvation.VISITOR += entry.quantity;
                    if (entry.type === 'MEMBER') stats.salvation.MEMBER += entry.quantity;
                }
                if (entry.isHealing) {
                    stats.healing.total += entry.quantity;
                    stats.healing[entry.gender === 'M' ? 'M' : 'F'] += entry.quantity;
                    stats.healing[entry.type === 'MEMBER' ? 'MEMBER' : 'VISITOR'] += entry.quantity;
                }
                if (entry.isDeliverance) {
                    stats.deliverance.total += entry.quantity;
                    stats.deliverance[entry.gender === 'M' ? 'M' : 'F'] += entry.quantity;
                    stats.deliverance[entry.type === 'MEMBER' ? 'MEMBER' : 'VISITOR'] += entry.quantity;
                }

                if (entry.gender) {
                    // Removed redundant gender counting block
                }

                // Marketing removido
            };

            // Soma no específico
            addToStats(dayStats[name]);
            // Soma no Total do dia
            addToStats(dayStats['Total']);

            // Soma no Total Geral do período
            responseData.manualCount += entry.quantity;
        });

        // --- CALCULAR TOTAL DO EVENTO (RECEPÇÃO) ---
        // Filtrar apenas checkpoints de recepção e somar
        const receptionCheckpoints = manual.filter((m: any) =>
            m.checkpoint && (
                m.checkpoint.name.toLowerCase().includes('recepção') ||
                m.checkpoint.name.toLowerCase().includes('entrada')
            )
        );
        responseData.totalEventEntrance = receptionCheckpoints.reduce((acc: number, curr: any) => acc + curr.quantity, 0);

        // --- LISTA DE DIAS DISPONÍVEIS ---
        responseData.availableDays = Object.keys(responseData.checkpointsData).sort((a: string, b: string) => {
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