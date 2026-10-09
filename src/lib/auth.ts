import { Request, Response, NextFunction } from 'express';
import { prisma } from './prisma';

/**
 * Exige um usuário STAFF no header "Authorization: Bearer <token>".
 * Usa o mesmo esquema do login atual (/auth/login devolve token = id da pessoa).
 */
export async function requireStaff(req: Request, res: Response, next: NextFunction) {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '').trim();
        if (!token) return res.status(401).json({ error: 'Faça login como staff.' });

        const user = await prisma.person.findUnique({ where: { id: token } });
        if (!user || user.role !== 'STAFF') return res.status(401).json({ error: 'Acesso restrito ao staff.' });

        (req as any).staffUser = user;
        next();
    } catch (e) {
        console.error('Erro em requireStaff:', e);
        res.status(500).json({ error: 'Erro interno.' });
    }
}
