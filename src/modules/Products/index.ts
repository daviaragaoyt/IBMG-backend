import { Router } from 'express';
import { prisma } from '../../lib/prisma';

const router = Router();

// Rota: GET /products
router.get('/', async (req, res) => {
    try {
        const { category } = req.query;

        // Filtro inteligente: Se não tiver categoria ou for 'Todos', traz tudo.
        const where = (category && category !== 'Todos' && category !== 'STORE')
            ? { category: String(category) }
            : {};

        const products = await prisma.product.findMany({
            where,
            orderBy: { name: 'asc' }
        });

        res.json(products);
    } catch (e) {
        console.error("Erro ao buscar produtos:", e);
        res.status(500).json({ error: "Erro ao carregar catálogo." });
    }
});

router.post('/', async (req, res) => {
    try {
        const { name, description, price, category, imageUrl } = req.body;
        const product = await prisma.product.create({
            data: {
                name,
                description,
                price: Number(price),
                category: category || 'LOJA',
                imageUrl
            }
        });
        res.json(product);
    } catch (e) { res.status(500).json({ error: "Erro ao criar" }); }
});

router.delete('/:id', async (req, res) => {
    try {
        await prisma.product.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erro ao deletar" }); }
});

export default router;