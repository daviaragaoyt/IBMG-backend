import { Router } from 'express';
import { z } from 'zod';
import { HcampTeam } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { requireStaff } from '../../lib/auth';

// =====================================================================
// HCAMP — Sorteio equilibrado dos times da gincana
//   POST   /hcamp/draw    (público)  { name, deviceId? } -> ticket
//   GET    /hcamp/me?deviceId=...  (público) ticket deste celular (404 se não houver)
//   GET    /hcamp/stats   (staff)    placar + lista de participantes
//   DELETE /hcamp/stats   (staff)    zera o sorteio
// =====================================================================

const router = Router();

const TEAMS: HcampTeam[] = ['VERMELHO', 'AMARELO', 'AZUL', 'VERDE'];

// Chave do "cadeado" do Postgres: garante que só um sorteio acontece por vez,
// assim dois celulares ao mesmo tempo nunca desequilibram os times.
const DRAW_LOCK_KEY = 74220026;

const DrawSchema = z.object({
    name: z.string().trim().min(5, 'Digite nome e sobrenome.').max(60),
    deviceId: z.string().trim().min(8).max(64).optional(),
});

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I/L
const genCode = () => {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return `HC-${c}`;
};

const emptyCounts = (): Record<HcampTeam, number> => ({ VERMELHO: 0, AMARELO: 0, AZUL: 0, VERDE: 0 });

const toTicket = (p: { code: string; name: string; team: HcampTeam; teamNumber: number; createdAt: Date }) => ({
    code: p.code, name: p.name, team: p.team, teamNumber: p.teamNumber, createdAt: p.createdAt,
});

// ---------------------------------------------------------------------
// 1. SORTEIO (público — acessado pelo QR Code)
// ---------------------------------------------------------------------
router.post('/draw', async (req, res) => {
    const parsed = DrawSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Dados inválidos.' });
    }
    const name = parsed.data.name.replace(/\s+/g, ' ');
    const deviceId = parsed.data.deviceId;

    try {
        const participant = await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${DRAW_LOCK_KEY})`);

            // Mesmo celular sorteando de novo -> devolve a mesma cor
            if (deviceId) {
                const existing = await tx.hcampParticipant.findUnique({ where: { deviceId } });
                if (existing) return existing;
            }

            const grouped = await tx.hcampParticipant.groupBy({ by: ['team'], _count: { _all: true } });
            const counts = emptyCounts();
            grouped.forEach(g => { counts[g.team] = g._count._all; });

            // Time com MENOS gente (empate = sorteio entre os empatados)
            const min = Math.min(...TEAMS.map(t => counts[t]));
            const candidates = TEAMS.filter(t => counts[t] === min);
            const team = candidates[Math.floor(Math.random() * candidates.length)];

            let code = genCode();
            while (await tx.hcampParticipant.findUnique({ where: { code } })) code = genCode();

            return tx.hcampParticipant.create({
                data: { code, name, team, teamNumber: counts[team] + 1, deviceId },
            });
        }, { timeout: 15000 });

        console.log(`🎲 HCAMP: ${participant.name} -> ${participant.team} #${participant.teamNumber}`);
        res.json(toTicket(participant));
    } catch (e) {
        console.error('Erro no sorteio HCAMP:', e);
        res.status(500).json({ error: 'Não foi possível sortear agora. Tente novamente.' });
    }
});

// ---------------------------------------------------------------------
// 1b. MEU TICKET (público) — confirma se o ticket do celular ainda existe
//     (ex.: depois que o staff zerou o sorteio)
// ---------------------------------------------------------------------
router.get('/me', async (req, res) => {
    const deviceId = String(req.query.deviceId || '').trim();
    if (deviceId.length < 8) return res.status(400).json({ error: 'deviceId inválido.' });
    try {
        const p = await prisma.hcampParticipant.findUnique({ where: { deviceId } });
        if (!p) return res.status(404).json({ error: 'Nenhum ticket para este celular.' });
        res.json(toTicket(p));
    } catch (e) {
        console.error('Erro em /hcamp/me:', e);
        res.status(500).json({ error: 'Erro interno.' });
    }
});

// ---------------------------------------------------------------------
// 2. PLACAR (staff)
// ---------------------------------------------------------------------
router.get('/stats', requireStaff, async (_req, res) => {
    try {
        const participants = await prisma.hcampParticipant.findMany({ orderBy: { createdAt: 'asc' } });
        const counts = emptyCounts();
        participants.forEach(p => { counts[p.team] += 1; });
        res.json({ counts, total: participants.length, participants: participants.map(toTicket) });
    } catch (e) {
        console.error('Erro em /hcamp/stats:', e);
        res.status(500).json({ error: 'Erro ao carregar o placar.' });
    }
});

// ---------------------------------------------------------------------
// 3. ZERAR SORTEIO (staff)
// ---------------------------------------------------------------------
router.delete('/stats', requireStaff, async (req, res) => {
    try {
        const { count } = await prisma.hcampParticipant.deleteMany({});
        console.log(`🧹 HCAMP zerado por ${(req as any).staffUser?.name}: ${count} participantes removidos`);
        res.status(204).end();
    } catch (e) {
        console.error('Erro ao zerar HCAMP:', e);
        res.status(500).json({ error: 'Erro ao zerar o sorteio.' });
    }
});

export default router;
