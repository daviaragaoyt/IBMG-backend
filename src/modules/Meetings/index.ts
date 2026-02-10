import { Router } from 'express';
import { prisma } from '../../lib/prisma';

const router = Router();

router.get('/', async (req, res) => {
    try {
        // PASSO MÁGICO: Antes de listar, atualiza tudo que já passou do horário
        const now = new Date();

        // Opcional: subtrair 1 ou 2 horas para dar uma margem de segurança
        // now.setHours(now.getHours() - 2); 

        await prisma.meeting.updateMany({
            where: {
                type: 'AGENDADA', // Só mexe nas agendadas
                date: { lt: now } // Cuja data seja MENOR que agora (já passou)
            },
            data: {
                type: 'REALIZADA' // Ou outro status como 'PENDENTE_ATA'
            }
        });

        // Agora busca a lista já atualizada
        const meetings = await prisma.meeting.findMany({
            orderBy: { date: 'desc' }
        });

        res.json(meetings);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Erro ao buscar reuniões." });
    }
});

router.post('/', async (req, res) => {
    try {
        const { title, date, type, notes, createdBy } = req.body;
        const meeting = await prisma.meeting.create({
            data: { title, date: new Date(date), type, notes, createdBy }
        });
        res.json({ success: true, meeting });
    } catch (e) { res.status(500).json({ error: "Erro meetings" }); }
});

router.delete('/:id', async (req, res) => {
    try {
        await prisma.meeting.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erro delete" }); }
});

export default router;