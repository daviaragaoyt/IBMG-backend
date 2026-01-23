import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';
import { PersonType, Role } from '@prisma/client';

const router = Router();

const RegisterSchema = z.object({
    name: z.string().min(3),
    email: z.string().email().optional().or(z.literal('')),
    phone: z.string().optional().nullable(),
    type: z.enum(['MEMBER', 'VISITOR', 'LEADER', 'PASTOR', 'STAFF']).default('VISITOR'),
    department: z.string().optional(),
    church: z.string().optional(),
    gender: z.string().optional(),
    marketingSource: z.string().optional(),
    age: z.union([z.string(), z.number()]).optional(),
    isStaff: z.boolean().optional()
});

router.post('/auth/login', async (req, res) => {
    const { email } = req.body;
    try {
        if (!email) return res.status(400).json({ error: "E-mail obrigatório" });
        const user = await prisma.person.findFirst({
            where: { email: { equals: String(email).trim(), mode: 'insensitive' }, role: 'STAFF' }
        });
        if (!user) return res.status(404).json({ error: "Acesso negado." });
        res.json(user);
    } catch (error) { res.status(500).json({ error: "Erro interno." }); }
});

router.get('/person/by-email', async (req, res) => {
    const { email } = req.query;
    try {
        const person = await prisma.person.findFirst({ where: { email: { equals: String(email).trim(), mode: 'insensitive' } } });
        if (!person) return res.status(404).json({ error: "Não encontrado." });
        res.json(person);
    } catch (error) { res.status(500).json({ error: "Erro interno." }); }
});

router.post('/register', async (req, res) => {
    try {
        const d = RegisterSchema.parse(req.body);
        const user = await prisma.person.create({
            data: { ...d, age: Number(d.age) || null, type: d.type as PersonType, role: d.isStaff ? Role.STAFF : Role.PARTICIPANT }
        });
        res.json(user);
    } catch (e) { res.status(400).json({ error: "Erro dados" }); }
});

export default router;