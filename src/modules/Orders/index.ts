import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { MercadoPagoConfig, Payment } from 'mercadopago';

const router = Router();

// --- CONFIGURAÇÃO DO MERCADO PAGO ---
// ⚠️ COLOQUE SEU ACCESS TOKEN ABAIXO
const client = new MercadoPagoConfig({ accessToken: 'SEU_ACCESS_TOKEN_AQUI' });
const payment = new Payment(client);

// ============================================================================
// 1. CRIAR PEDIDO + GERAR PIX AUTOMÁTICO
// ============================================================================
router.post('/orders', async (req, res) => {
    try {
        const { name, phone, age, email, church, total, items } = req.body;

        let parsedItems = [];
        try { parsedItems = JSON.parse(items || '[]'); } catch (e) { }

        // 1. Criar/Atualizar Cliente
        const userEmail = email || `${phone.replace(/\D/g, '')}@noemail.com`;
        const person = await prisma.person.upsert({
            where: { email: userEmail },
            update: { name, phone, church, age: Number(age) },
            create: { name, email: userEmail, phone, church, age: Number(age), type: 'VISITOR' }
        });

        // 2. Gerar Código Único
        const orderCode = Math.random().toString(36).substring(2, 6).toUpperCase();

        // 3. Salvar Venda como PENDING
        const sale = await prisma.sale.create({
            data: {
                buyerName: name,
                buyerType: 'VISITOR',
                personId: person.id,
                total: Number(total),
                paymentMethod: 'PIX',
                status: 'PENDING',
                orderCode: orderCode,
                items: {
                    create: parsedItems.map((i: any) => ({
                        productId: i.productId, quantity: Number(i.quantity), price: Number(i.price)
                    }))
                }
            }
        });

        // 4. CHAMAR MERCADO PAGO
        const mpResponse = await payment.create({
            body: {
                transaction_amount: Number(total),
                description: `Pedido #${orderCode} - Loja Psalms`,
                payment_method_id: 'pix',
                payer: {
                    email: userEmail,
                    first_name: name.split(' ')[0],
                    last_name: name.split(' ').slice(1).join(' ') || 'Cliente'
                },
                metadata: {
                    order_code: orderCode,
                    sale_id: sale.id
                }
            }
        });

        const pixData = {
            qrCode: mpResponse.point_of_interaction?.transaction_data?.qr_code_base64,
            copyPaste: mpResponse.point_of_interaction?.transaction_data?.qr_code,
            paymentId: mpResponse.id
        };

        res.json({ sale, pixData });

    } catch (error) {
        console.error("Erro MP/Backend:", error);
        res.status(500).json({ error: "Erro ao gerar PIX." });
    }
});

// ============================================================================
// 2. CHECKAGEM DE PAGAMENTO (POLLING)
// ============================================================================
router.post('/orders/check-payment', async (req, res) => {
    try {
        const { paymentId, saleId } = req.body;
        const mpCheck = await payment.get({ id: paymentId });

        if (mpCheck.status === 'approved') {
            const updated = await prisma.sale.update({
                where: { id: saleId },
                data: { status: 'PAID' }
            });
            return res.json({ status: 'PAID', orderCode: updated.orderCode });
        }
        res.json({ status: 'PENDING' });
    } catch (error) {
        res.status(500).json({ error: "Erro cheque MP" });
    }
});

// ============================================================================
// 3. ROTAS DE STAFF (LISTAGEM E AÇÕES)
// ============================================================================
router.get('/orders/pending', async (req, res) => {
    const orders = await prisma.sale.findMany({
        where: { status: { in: ['PENDING', 'ANALYSIS', 'PAID'] } },
        include: { items: { include: { product: true } }, person: true },
        orderBy: { timestamp: 'desc' }
    });
    res.json(orders);
});

// Aprovar manual (caso precise)
router.post('/orders/pay', async (req, res) => {
    await prisma.sale.updateMany({ where: { orderCode: req.body.orderCode }, data: { status: 'PAID' } });
    res.json({ success: true });
});

// Rejeitar/Cancelar
router.post('/orders/reject', async (req, res) => {
    await prisma.sale.updateMany({ where: { orderCode: req.body.orderCode }, data: { status: 'CANCELLED' } });
    res.json({ success: true });
});

// Entregar (Retirada)
router.post('/orders/deliver', async (req, res) => {
    await prisma.sale.updateMany({ where: { orderCode: req.body.orderCode }, data: { status: 'DELIVERED' } });
    res.json({ success: true });
});

export default router;