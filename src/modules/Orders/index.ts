import { Router } from 'express';
import { prisma } from '../../lib/prisma'; // Ajuste o caminho conforme sua estrutura

const router = Router();

// ============================================================================
// 1. CRIAR PEDIDO (Cliente clica em "Finalizar")
// ============================================================================
router.post('/orders', async (req, res) => {
    try {
        const { buyerName, items, total, buyerType } = req.body;

        // Gera um código curto aleatório (Ex: "A1B2")
        const orderCode = Math.random().toString(36).substring(2, 6).toUpperCase();

        // Cria a Venda com status PENDING
        const sale = await prisma.sale.create({
            data: {
                buyerName: buyerName || "Visitante",
                buyerType: buyerType || 'VISITOR',
                total: Number(total),
                paymentMethod: 'PENDING', // Ainda não pagou
                status: 'PENDING',        // Pedido pendente de preparo/pagamento
                orderCode: orderCode,     // Código para chamar no balcão
                items: {
                    create: items.map((i: any) => ({
                        productId: i.productId,
                        quantity: i.quantity,
                        price: Number(i.price) // Salva o preço da hora da compra
                    }))
                }
            }
        });

        console.log(`✅ Novo pedido criado: #${orderCode} - ${buyerName}`);
        res.json(sale);

    } catch (error) {
        console.error("Erro ao criar pedido:", error);
        res.status(500).json({ error: "Erro interno ao processar pedido." });
    }
});

// ============================================================================
// 2. LISTAR PEDIDOS PENDENTES (Para o Staff/Cozinha)
// ============================================================================
router.get('/orders/pending', async (req, res) => {
    try {
        const orders = await prisma.sale.findMany({
            where: {
                status: { in: ['PENDING', 'PAID'] } // Mostra o que precisa ser feito
            },
            include: {
                items: {
                    include: { product: true }
                }
            },
            orderBy: { timestamp: 'asc' } // Mais antigos primeiro
        });

        res.json(orders);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erro ao buscar pedidos." });
    }
});

// ============================================================================
// 3. PAGAR PEDIDO (Staff recebe o dinheiro/PIX)
// ============================================================================
router.post('/orders/pay', async (req, res) => {
    try {
        const { orderCode } = req.body;

        if (!orderCode) return res.status(400).json({ error: "Código obrigatório" });

        await prisma.sale.updateMany({
            where: { orderCode: orderCode },
            data: {
                status: 'PAID',         // Agora está pago
                paymentMethod: 'PIX'    // Ou DINHEIRO (Pode vir do body se quiser)
            }
        });

        res.json({ success: true, message: "Pedido pago com sucesso." });
    } catch (error) {
        res.status(500).json({ error: "Erro ao atualizar pedido." });
    }
});

// ============================================================================
// 4. ENTREGAR PEDIDO (Sai da tela da cozinha)
// ============================================================================
router.post('/orders/deliver', async (req, res) => {
    try {
        const { orderCode } = req.body;

        await prisma.sale.updateMany({
            where: { orderCode: orderCode },
            data: { status: 'DELIVERED' } // Finalizado
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Erro ao entregar pedido." });
    }
});

// ============================================================================
// 5. REJEITAR/CANCELAR PEDIDO
// ============================================================================
router.post('/orders/reject', async (req, res) => {
    try {
        const { orderCode } = req.body;

        await prisma.sale.updateMany({
            where: { orderCode: orderCode },
            data: { status: 'CANCELLED' }
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Erro ao cancelar pedido." });
    }
});

export default router;