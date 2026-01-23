import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { upload } from '../../lib/upload';

const router = Router();

// 1. Criar Pedido Completo (Upload + Cadastro)
router.post('/checkout/full', upload.single('proof'), async (req: any, res: any) => {
    try {
        const { name, email, phone, age, church, items } = req.body;
        const proofFile = req.file;

        if (!name || !phone || !items) return res.status(400).json({ error: "Dados obrigatórios." });

        // Upsert Pessoa
        const person = await prisma.person.upsert({
            where: { email: email || `temp_${phone}@checkout.com` },
            update: { name, phone, church, age: Number(age) },
            create: {
                name,
                email: email || `temp_${phone}@checkout.com`,
                phone,
                church,
                age: Number(age),
                type: 'VISITOR',
                role: 'PARTICIPANT'
            }
        });

        const parsedItems = JSON.parse(items);
        let total = 0;
        const dbItems = [];

        for (const item of parsedItems) {
            const prod = await prisma.product.findUnique({ where: { id: item.productId } });
            if (prod) {
                total += Number(prod.price) * item.quantity;
                dbItems.push({ productId: prod.id, quantity: item.quantity });
            }
        }

        const uniqueCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        const proofUrl = proofFile ? `/uploads/${proofFile.filename}` : null;

        const order = await prisma.order.create({
            data: {
                orderCode: uniqueCode,
                personId: person.id,
                buyerName: person.name,
                buyerPhone: person.phone || "",
                total: total,
                status: 'PENDING',
                proofUrl: proofUrl,
                items: { create: dbItems }
            }
        });

        res.json({ success: true, orderCode: uniqueCode, personId: person.id });
    } catch (e) { res.status(500).json({ error: "Erro checkout" }); }
});

// 2. Listar Pendentes (Staff)
router.get('/orders/pending', async (req, res) => {
    const orders = await prisma.order.findMany({
        where: { status: 'PENDING', proofUrl: { not: null } },
        orderBy: { createdAt: 'desc' },
        include: { items: { include: { product: true } } }
    });
    res.json(orders);
});

// 3. Receber Pagamento / Aprovar
router.post('/orders/pay', async (req, res) => {
    const { orderCode } = req.body;
    try {
        const updated = await prisma.order.update({
            where: { orderCode },
            data: { status: 'PAID', paidAt: new Date() }
        });
        res.json({ success: true, order: updated });
    } catch (e) { res.status(500).json({ error: "Erro pagamento" }); }
});

// 4. Rejeitar
router.post('/orders/reject', async (req, res) => {
    const { orderCode } = req.body;
    try {
        await prisma.orderItem.deleteMany({ where: { order: { orderCode } } });
        await prisma.order.delete({ where: { orderCode } });
        res.json({ success: true, message: "Removido." });
    } catch (e) { res.status(500).json({ error: "Erro rejeição" }); }
});

// 5. Entregar
router.post('/orders/deliver', async (req, res) => {
    const { orderCode } = req.body;
    try {
        const updated = await prisma.order.update({
            where: { orderCode },
            data: { status: 'DELIVERED', deliveredAt: new Date() }
        });
        res.json({ success: true, order: updated });
    } catch (e) { res.status(500).json({ error: "Erro entrega" }); }
});

// 6. Consultas (Voucher e Pessoa)
router.get('/orders/:code', async (req, res) => {
    const order = await prisma.order.findUnique({
        where: { orderCode: req.params.code.toUpperCase() },
        include: { items: { include: { product: true } } }
    });
    if (!order) return res.status(404).json({ error: "Pedido não encontrado" });
    res.json(order);
});

router.get('/person/:id/orders', async (req, res) => {
    const person = await prisma.person.findUnique({
        where: { id: req.params.id },
        include: {
            orders: {
                where: { status: { not: 'DELIVERED' } },
                include: { items: { include: { product: true } } }
            }
        }
    });
    if (!person) return res.status(404).json({ error: "Pessoa não encontrada" });
    res.json({ personName: person.name, orders: person.orders });
});

export default router;