import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';
import { PersonType } from '@prisma/client';

const router = Router();

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

router.post('/sales', async (req, res) => {
    try {
        const data = SaleSchema.parse(req.body);
        let total = 0;
        data.items.forEach(i => total += (i.price * i.quantity));

        const sale = await prisma.sale.create({
            data: {
                checkpointId: data.checkpointId,
                paymentMethod: data.paymentMethod,
                total: total,
                buyerType: data.buyerType as PersonType,
                buyerGender: data.buyerGender,
                items: {
                    create: data.items.map(i => ({ productId: i.productId, quantity: i.quantity, price: i.price }))
                }
            }
        });
        res.json({ success: true, sale });
    } catch (e) { res.status(500).json({ error: "Erro venda" }); }
});

export default router;