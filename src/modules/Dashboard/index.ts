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
// 2. CONSOLIDAÇÃO (SALVAR FICHA)
// =========================================================
router.post('/consolidation/save', async (req, res) => {
    try {
        const { name, phone, decision, observer } = req.body;
        const person = await prisma.person.create({
            data: {
                name,
                phone,
                type: 'VISITOR',
                role: 'PARTICIPANT',
                marketingSource: `Decisão: ${decision}`,
                church: 'Consolidação',
                department: observer
            }
        });
        res.json({ success: true, person });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Erro ao salvar ficha" });
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
            marketing: {} as Record<string, number>,
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

        // --- BUSCAS PARALELAS (OTIMIZAÇÃO) ---
        const [manual, sales, meetings, consolidationCount] = await Promise.all([
            // 1. Contagens Manuais
            prisma.manualEntry.findMany({ where: { timestamp: { gte: start, lte: end } }, include: { checkpoint: true } }),
            // 2. Vendas Pagas
            prisma.sale.findMany({ where: { status: 'PAID', timestamp: { gte: start, lte: end } }, include: { items: { include: { product: true } } } }),
            // 3. Reuniões
            prisma.meeting.groupBy({ by: ['type'], _count: { id: true } }),
            // 4. Consolidação Total
            prisma.person.count({ where: { marketingSource: { startsWith: 'Decisão' } } })
        ]);

        responseData.consolidationCount = consolidationCount;

        // --- PROCESSAR VENDAS (AQUI ESTAVA O ERRO NO SEU CÓDIGO) ---
        sales.forEach(s => {
            let saleTotal = 0;

            // 1. Soma os Itens
            s.items.forEach(i => {
                const itemTotal = Number(i.price) * i.quantity;
                saleTotal += itemTotal;

                // LÓGICA CORRIGIDA:
                // Se a categoria no banco for explicitamente CANTINA ou FOOD, vai pra Cantina.
                // Todo o resto (Null, Psalms, Livros, Camisetas) cai na LOJA.
                const dbCat = i.product?.category?.toUpperCase() || '';
                const category = (dbCat === 'CANTINA' || dbCat === 'FOOD') ? 'CANTINA' : 'LOJA';

                responseData.salesStats.byCategory[category] = (responseData.salesStats.byCategory[category] || 0) + itemTotal;
            });

            responseData.salesStats.totalRevenue += saleTotal;

            // 2. Conta se foi Membro ou Visitante
            // Se buyerType for nulo (venda rápida), conta como VISITOR
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
                    'Total': emptyStats(), 'Kids': emptyStats(), 'Recepcao': emptyStats(), 'Consolidacao': emptyStats()
                };
            }

            // Agrupamento Dinâmico
            const cpName = entry.checkpoint?.name || 'Desconhecido';
            const cpNameUpper = cpName.toUpperCase();

            let targetCategory = cpName; // Padrão: O nome do próprio checkpoint vira a categoria
            let isTotal = true;

            // Regras Especiais de Agrupamento - REMOVIDAS
            // Agora passamos o nome original do checkpoint
            // targetCategory = cpName; // Já está definido acima
            isTotal = true; // Tudo conta para o total, a menos que seja algo muito específico que queira excluir depois.

            // Inicializa a categoria se não existir neste dia
            if (!responseData.checkpointsData[dayKey][targetCategory]) {
                responseData.checkpointsData[dayKey][targetCategory] = emptyStats();
            }

            // Função auxiliar para somar
            const addToStats = (categoryName: string) => {
                const stats = responseData.checkpointsData[dayKey][categoryName];
                if (!stats) return; // Segurança

                stats.total += entry.quantity;

                if (entry.type === 'MEMBER') stats.type.MEMBER += entry.quantity;
                else stats.type.VISITOR += entry.quantity;

                if (entry.ageGroup) {
                    const ageKey = entry.ageGroup as keyof typeof stats.age;
                    if (stats.age[ageKey] !== undefined) {
                        stats.age[ageKey] += entry.quantity;
                    }
                }

                // Lógica de Desfechos Espirituais
                if (entry.isSalvation) {
                    stats.salvation.total += entry.quantity;
                    if (entry.gender === 'M') stats.salvation.M += entry.quantity;
                    if (entry.gender === 'F') stats.salvation.F += entry.quantity;
                    if (entry.type === 'VISITOR') stats.salvation.VISITOR += entry.quantity;
                    if (entry.type === 'MEMBER') stats.salvation.MEMBER += entry.quantity;
                }
                if (entry.isHealing) {
                    stats.healing.total += entry.quantity;
                    if (entry.gender === 'M') stats.healing.M += entry.quantity;
                    if (entry.gender === 'F') stats.healing.F += entry.quantity;
                    if (entry.type === 'VISITOR') stats.healing.VISITOR += entry.quantity;
                    if (entry.type === 'MEMBER') stats.healing.MEMBER += entry.quantity;
                }
                if (entry.isDeliverance) {
                    stats.deliverance.total += entry.quantity;
                    if (entry.gender === 'M') stats.deliverance.M += entry.quantity;
                    if (entry.gender === 'F') stats.deliverance.F += entry.quantity;
                    if (entry.type === 'VISITOR') stats.deliverance.VISITOR += entry.quantity;
                    if (entry.type === 'MEMBER') stats.deliverance.MEMBER += entry.quantity;
                }

                if (entry.gender) {
                    const genderKey = entry.gender as keyof typeof stats.gender;
                    if (stats.gender[genderKey] !== undefined) {
                        stats.gender[genderKey] += entry.quantity;
                    }
                }
            };

            addToStats(targetCategory);

            if (isTotal) {
                addToStats('Total');
                responseData.manualCount += entry.quantity;
            }
        });

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