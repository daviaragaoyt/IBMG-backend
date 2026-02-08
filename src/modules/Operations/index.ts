import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';
import { PersonType, CheckpointCategory } from '@prisma/client';
import { startOfDay } from 'date-fns';

const router = Router();
const SERVICE_CATEGORIES = ['PROPHETIC', 'PRAYER', 'EVANGELISM', 'CONSOLIDATION', 'STORE'];

/* ======================================================
   SCHEMAS DE VALIDAÇÃO (ZOD)
====================================================== */

const CountSchema = z.object({
    checkpointId: z.string().min(1),
    type: z.enum(['MEMBER', 'VISITOR']),
    church: z.string().optional(),
    quantity: z.number().min(1).default(1),
    ageGroup: z.string().optional(),
    gender: z.string().optional(),
    marketingSource: z.string().nullable().optional(),
    isSalvation: z.boolean().optional().default(false),
    isHealing: z.boolean().optional().default(false),
    isDeliverance: z.boolean().optional().default(false)
});

const SaleSchema = z.object({
    checkpointId: z.string().min(1),
    paymentMethod: z.string(),
    buyerType: z.enum(['MEMBER', 'VISITOR']).default('VISITOR'),
    buyerGender: z.enum(['M', 'F']).default('M'),
    items: z.array(z.object({
        productId: z.string(),
        quantity: z.number(),
        price: z.number()
    }))
});

/* ======================================================
   ROTAS DE LEITURA
====================================================== */

// Lista todos os locais para o Select da Staff
router.get('/checkpoints', async (req, res) => {
    try {
        const list = await prisma.checkpoint.findMany({ orderBy: { name: 'asc' } });
        res.json(list);
    } catch (e) {
        res.status(500).json({ error: "Erro ao listar locais." });
    }
});

// 1. Contagem Manual (+1 Homem, +1 Mulher)
router.post('/count', async (req, res) => {
    try {
        const data = CountSchema.parse(req.body);


        // Map inputs to Prisma Enums
        const genderInput = data.gender ? (data.gender.startsWith('M') ? 'M' : 'F') : undefined;
        const ageGroupInput = data.ageGroup ? String(data.ageGroup) : undefined;

        // Proteção contra duplo clique (Debounce de 500ms)
        // Buscamos o último registro apenas por tipo e local
        const lastEntry = await prisma.manualEntry.findFirst({
            where: {
                checkpointId: data.checkpointId,
                type: data.type as PersonType
            } as any,
            orderBy: { timestamp: 'desc' }
        });

        // Verificamos se é idêntico (mesmo gênero/idade ou ambos nulos) e se foi recente
        const isSameEntry = lastEntry &&
            String(lastEntry.gender || '') === String(genderInput || '') &&
            String(lastEntry.ageGroup || '') === String(ageGroupInput || '');

        if (isSameEntry && (new Date().getTime() - new Date(lastEntry.timestamp).getTime() < 500)) {
            return res.json({ success: true, ignored: true });
        }

        const entry = await prisma.manualEntry.create({
            data: {
                checkpointId: data.checkpointId,
                type: data.type as PersonType,
                church: data.church || 'Ibmg Sede',
                ageGroup: ageGroupInput,
                gender: genderInput,
                quantity: data.quantity,
                marketingSource: data.marketingSource,
                isSalvation: data.isSalvation,
                isHealing: data.isHealing,
                isDeliverance: data.isDeliverance
            } as any
        });
        res.json({ success: true, entry });
    } catch (error) {
        console.error(error);
        res.status(400).json({ error: "Erro ao registrar contagem." });
    }
});

// 2. Scan de QR Code (Entrada Automática)
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

        // Lógica de reentrada: ignora se for muito rápido (<60s) ou se o local não permitir reentrada
        if (existing) {
            if ((new Date().getTime() - new Date(existing.timestamp).getTime()) / 1000 < 60) {
                return res.json({ success: true, status: 'IGNORED', message: "⏳ Aguarde..." });
            }
            if (!allowReentry) {
                return res.json({ success: true, status: 'REENTRY', message: `⚠️ Já entrou hoje.` });
            }
        }

        const newMove = await prisma.movement.create({
            data: { personId, checkpointId },
            include: { person: true }
        });
        res.json({ success: true, status: 'SUCCESS', person: newMove.person });
    } catch (error) {
        res.status(500).json({ error: "Erro ao processar scan." });
    }
});

// 3. Venda Manual (Lançamento direto pela Staff sem AbacatePay)
router.post('/sales', async (req, res) => {
    try {
        const data = SaleSchema.parse(req.body);
        let total = 0;
        data.items.forEach(i => total += (Number(i.price) * Number(i.quantity)));

        const sale = await prisma.sale.create({
            data: {
                orderCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
                checkpointId: data.checkpointId,
                paymentMethod: data.paymentMethod,
                total: total,
                status: 'PAID', // Venda manual assume-se paga na hora (dinheiro/maquininha externa)
                buyerType: data.buyerType as PersonType,
                buyerGender: data.buyerGender,
                items: {
                    create: data.items.map(i => ({
                        productId: i.productId,
                        quantity: i.quantity,
                        price: i.price
                    }))
                }
            }
        });
        res.json({ success: true, sale });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Erro ao registrar venda manual." });
    }
});

export default router;