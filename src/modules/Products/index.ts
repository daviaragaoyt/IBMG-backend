import { Router } from 'express';
import { prisma } from '../../lib/prisma';

const router = Router();

router.get('/products', async (req, res) => {
    const { category } = req.query;
    try {
        const products = await prisma.product.findMany({
            where: category ? { category: String(category) } : undefined,
            orderBy: { name: 'asc' }
        });
        res.json(products);
    } catch (e) { res.status(500).json({ error: "Erro produtos" }); }
});

export default router;