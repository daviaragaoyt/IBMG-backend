import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';

const router = Router();

// Schema para Cadastro Rápido (Consolidação e Kids)
const QuickRegisterSchema = z.object({
    name: z.string().min(3),
    phone: z.string().optional(), // WhatsApp
    email: z.string().email().optional().or(z.literal('')),
    age: z.union([z.string(), z.number()]).optional(),
    guardianName: z.string().optional(), // Para Kids
    decisionType: z.enum(['ACEITOU', 'RECONCILIACAO', 'VISITANTE']).optional(), // Para Altar
    department: z.string().optional() // KIDS, CONSOLIDATION
});

// Rota: POST /people/quick-register
router.post('/quick-register', async (req, res) => {
    try {
        const data = QuickRegisterSchema.parse(req.body);

        // Formata telefone
        const cleanPhone = data.phone ? data.phone.replace(/\D/g, '') : null;

        // Cria a pessoa (ou atualiza se já existir pelo telefone/email)
        // Usamos telefone como chave secundária se não tiver email
        let person = null;

        if (data.email) {
            person = await prisma.person.upsert({
                where: { email: data.email },
                update: {
                    name: data.name,
                    phone: cleanPhone,
                    marketingSource: data.decisionType || undefined
                },
                create: {
                    name: data.name,
                    email: data.email,
                    phone: cleanPhone,
                    age: Number(data.age) || null,
                    type: 'VISITOR',
                    marketingSource: data.decisionType, // Salva se aceitou Jesus

                }
            });
        } else {
            // Se não tem email (comum no Altar/Kids), cria direto
            person = await prisma.person.create({
                data: {
                    name: data.name,
                    phone: cleanPhone,
                    age: Number(data.age) || null,
                    type: 'VISITOR',
                    marketingSource: data.decisionType,

                }
            });
        }

        // Se for Kids ou Altar, registra também um movimento automático no Checkpoint
        // Isso mata dois coelhos: cadastra os dados E conta no dashboard
        if (data.department) {
            // Tenta achar o checkpoint (ex: "Salinha Kids" ou "Altar")
            const checkpoint = await prisma.checkpoint.findFirst({
                where: {
                    category: data.department === 'KIDS' ? 'KIDS' :
                        data.department === 'CONSOLIDATION' ? 'CONSOLIDATION' : 'GENERAL'
                }
            });

            if (checkpoint) {
                await prisma.movement.create({
                    data: { personId: person.id, checkpointId: checkpoint.id }
                });
            }
        }

        res.json({ success: true, person });
    } catch (e) {
        console.error(e);
        res.status(400).json({ error: "Erro ao realizar cadastro rápido." });
    }
});

// Rota de Busca (Para o Check-in do Kids)
router.get('/search', async (req, res) => {
    const { q } = req.query;
    try {
        const people = await prisma.person.findMany({
            where: {
                OR: [
                    { name: { contains: String(q), mode: 'insensitive' } },
                    { phone: { contains: String(q) } }
                ]
            },
            take: 5
        });
        res.json(people);
    } catch (e) {
        res.status(500).json({ error: "Erro na busca." });
    }
});

export default router;