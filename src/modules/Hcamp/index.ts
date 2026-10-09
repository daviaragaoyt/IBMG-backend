import { Router } from 'express';
import { z } from 'zod';
import { HcampTeam } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { requireStaff } from '../../lib/auth';

// =====================================================================
// HCAMP — Sorteio equilibrado dos times da gincana
//   POST   /hcamp/draw    (público)  { name, deviceId? } -> ticket
//   GET    /hcamp/me?deviceId=...  (público) ticket deste celular (404 se não houver)
//   GET    /hcamp/config  (público)  data da revelação dos times
//   PUT    /hcamp/config  (staff)    { revealAt } muda a data da revelação
//   POST   /hcamp/reveal  (público)  { name, code? } -> ticket com o time (só após a revelação)
//   GET    /hcamp/stats   (staff)    placar + lista de participantes
//   DELETE /hcamp/stats   (staff)    zera o sorteio
//
// O time fica LACRADO (team = null) para o participante até a data da revelação.
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

type ParticipantRow = { code: string; name: string; team: HcampTeam; teamNumber: number; createdAt: Date };

const toTicket = (p: ParticipantRow) => ({
    code: p.code, name: p.name, team: p.team, teamNumber: p.teamNumber, createdAt: p.createdAt,
});

// ---------------------------------------------------------------------
// Revelação dos times (data salva na tabela global_config)
// ---------------------------------------------------------------------
const REVEAL_KEY = 'HCAMP_REVEAL_AT';
const DEFAULT_REVEAL_AT = '2026-11-14T08:00:00-03:00'; // usado até o staff definir a data no painel

async function getRevealAt(): Promise<Date> {
    const row = await prisma.globalConfig.findUnique({ where: { key: REVEAL_KEY } });
    const d = new Date(row?.value || DEFAULT_REVEAL_AT);
    return isNaN(d.getTime()) ? new Date(DEFAULT_REVEAL_AT) : d;
}
const isRevealed = (revealAt: Date) => Date.now() >= revealAt.getTime();

/** Ticket como o participante vê: sem o time até a revelação. */
const toPublicTicket = (p: ParticipantRow, revealed: boolean) => revealed
    ? { ...toTicket(p), revealed: true }
    : { code: p.code, name: p.name, team: null, teamNumber: null, createdAt: p.createdAt, revealed: false };

/** Normaliza nomes para comparar: minúsculas, sem acentos, espaços únicos. */
const normalizeName = (n: string) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

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
        res.json(toPublicTicket(participant, isRevealed(await getRevealAt())));
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
        res.json(toPublicTicket(p, isRevealed(await getRevealAt())));
    } catch (e) {
        console.error('Erro em /hcamp/me:', e);
        res.status(500).json({ error: 'Erro interno.' });
    }
});

// ---------------------------------------------------------------------
// 1c. CONFIGURAÇÃO DA REVELAÇÃO
// ---------------------------------------------------------------------
router.get('/config', async (_req, res) => {
    try {
        const revealAt = await getRevealAt();
        res.json({ revealAt: revealAt.toISOString(), revealed: isRevealed(revealAt), serverNow: new Date().toISOString() });
    } catch (e) {
        console.error('Erro em /hcamp/config:', e);
        res.status(500).json({ error: 'Erro interno.' });
    }
});

const ConfigSchema = z.object({ revealAt: z.string().min(10) });

router.put('/config', requireStaff, async (req, res) => {
    const parsed = ConfigSchema.safeParse(req.body);
    const d = parsed.success ? new Date(parsed.data.revealAt) : null;
    if (!d || isNaN(d.getTime())) return res.status(400).json({ error: 'Data inválida.' });
    try {
        await prisma.globalConfig.upsert({
            where: { key: REVEAL_KEY },
            update: { value: d.toISOString() },
            create: { key: REVEAL_KEY, value: d.toISOString() },
        });
        console.log(`⏰ HCAMP: revelação definida para ${d.toISOString()} por ${(req as any).staffUser?.name}`);
        res.json({ revealAt: d.toISOString(), revealed: isRevealed(d), serverNow: new Date().toISOString() });
    } catch (e) {
        console.error('Erro ao salvar config HCAMP:', e);
        res.status(500).json({ error: 'Erro ao salvar.' });
    }
});

// ---------------------------------------------------------------------
// 1d. REVELAR MEU TIME (público, só depois da data da revelação)
// ---------------------------------------------------------------------
const RevealSchema = z.object({
    name: z.string().trim().min(3, 'Digite seu nome.').max(60),
    code: z.string().trim().max(12).optional(),
});

router.post('/reveal', async (req, res) => {
    const parsed = RevealSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Dados inválidos.' });

    try {
        const revealAt = await getRevealAt();
        if (!isRevealed(revealAt)) {
            return res.status(403).json({ error: 'Os times ainda não foram revelados.', revealAt: revealAt.toISOString() });
        }

        const target = normalizeName(parsed.data.name);
        const code = parsed.data.code?.toUpperCase().replace(/\s+/g, '');
        const all = await prisma.hcampParticipant.findMany({ orderBy: { createdAt: 'asc' } });
        let matches = all.filter(p => normalizeName(p.name) === target);
        if (code) matches = matches.filter(p => p.code === code || p.code === `HC-${code.replace(/^HC-?/, '')}`);

        if (matches.length === 0) {
            return res.status(404).json({ error: code ? 'Nome e código não conferem.' : 'Nome não encontrado. Digite exatamente como no sorteio.' });
        }
        if (matches.length > 1) {
            return res.status(409).json({ error: 'Tem mais de uma pessoa com esse nome. Digite também o código do seu ticket.', needCode: true });
        }
        res.json(toPublicTicket(matches[0], true));
    } catch (e) {
        console.error('Erro em /hcamp/reveal:', e);
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
