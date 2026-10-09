import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { PersonType } from '@prisma/client';
import { mpPreference, mpPayment } from '../../lib/mercadopago';

const router = Router();

// ============================================================================
// 1. HELPERS
// ============================================================================

const normalizeCPF = (cpf: string) => cpf.replace(/\D/g, '');

function isValidCPF(cpf: string) {
    cpf = cpf.replace(/\D/g, '');
    if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
    let sum = 0, rest;
    for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
    rest = (sum * 10) % 11;
    if (rest === 10 || rest === 11) rest = 0;
    if (rest !== Number(cpf[9])) return false;
    sum = 0;
    for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
    rest = (sum * 10) % 11;
    if (rest === 10 || rest === 11) rest = 0;
    return rest === Number(cpf[10]);
}

// ============================================================================
// 2. WEBHOOK MERCADO PAGO
// ============================================================================
router.post('/webhook/mercadopago', async (req, res) => {
    try {
        const { type, data } = req.body;
        // O Mercado Pago envia 'action' ou 'type'. Se for 'payment', verificamos.

        const paymentId = data?.id || req.query.id;
        const topic = type || req.query.topic; // topic pode vir na URL

        console.log('🥑 Webhook MP:', topic, paymentId);

        // Ajuste: MP manda topic='payment' na query string muitas vezes
        // Se topic for payment ou action for payment.created/updated
        if ((topic === 'payment' || req.body.action?.startsWith('payment')) && paymentId) {
            const payment = await mpPayment.get({ id: paymentId });

            if (payment && payment.status === 'approved') {
                const externalReference = payment.external_reference;

                if (externalReference) {
                    // ERROR FIX: findUnique -> findFirst (orderCode is not unique in schema)
                    const sale = await prisma.sale.findFirst({ where: { orderCode: externalReference } });

                    if (sale && sale.status !== 'PAID') {
                        await prisma.sale.update({
                            where: { id: sale.id },
                            data: { status: 'PAID', externalId: String(payment.id) }
                        });
                        console.log(`🚀 Venda ${sale.orderCode} PAGA via Webhook MP.`);
                    }
                }
            }
        }

        res.sendStatus(200);
    } catch (err: any) {
        console.error('❌ Erro webhook:', err.message);
        res.sendStatus(500);
    }
});

// ============================================================================
// 3. CRIAR PEDIDO (HÍBRIDO: ONLINE + STAFF)
// ============================================================================
router.post('/', async (req, res) => {
    try {
        const {
            name, email, phone, cpf, age, church, gender, // Dados Cliente Online
            items,
            paymentMethod, // 'PIX', 'MONEY', 'CREDIT'
            manualType,    // 'MEMBER' ou 'VISITOR' (Do Modal)
            personId,      // ID se selecionou alguém
            status         // Status se já pagou
        } = req.body;

        // VERIFICAÇÃO DE STAFF (Via Token/Header)
        const authHeader = req.headers.authorization;
        const token = authHeader?.replace('Bearer ', '');
        let isStaffAction = false;

        if (token) {
            const staffUser = await prisma.person.findUnique({ where: { id: token } });
            if (staffUser && staffUser.role === 'STAFF') {
                isStaffAction = true;
                console.log(`👮‍♂️ Ação de Staff detectada: ${staffUser.name}`);
            }
        }

        const parsedItems = typeof items === 'string' ? JSON.parse(items) : items;
        if (!Array.isArray(parsedItems) || !parsedItems.length) return res.status(400).json({ error: 'Carrinho vazio.' });

        // --- A. Processa Produtos e Total ---
        const productIds = parsedItems.map((i: any) => i.productId);
        const products = await prisma.product.findMany({ where: { id: { in: productIds } } });

        let total = 0;
        const finalItems: any[] = [];

        for (const item of parsedItems) {
            const product = products.find(p => p.id === item.productId);
            if (!product) continue;
            const quantity = Math.max(1, Number(item.quantity));
            const price = Number(product.price);
            const size = item.size || null;
            total += price * quantity;
            finalItems.push({ productId: product.id, name: product.name, quantity, price, size });
        }

        if (!finalItems.length) return res.status(400).json({ error: 'Produtos inválidos.' });

        // --- B. Define Tipo de Comprador ---
        let buyerType: PersonType = 'VISITOR';
        let buyerPersonId = personId || null;

        if (manualType && (manualType === 'MEMBER' || manualType === 'VISITOR')) {
            buyerType = manualType as PersonType;
        } else if (personId) {
            const person = await prisma.person.findUnique({ where: { id: personId } });
            if (person) buyerType = person.type;
        }


        // --- C. ROTA STAFF (Dinheiro/Cartão OU PIX Manual de Balcão) ---
        // Se for PIX e NÃO tiver email, assume balcão manual (para não gerar link)
        // Se tiver email, assume que o Staff quer gerar link (cai no D)
        const wantsLink = isStaffAction && paymentMethod === 'PIX' && email;

        if ((paymentMethod && paymentMethod !== 'PIX') || (isStaffAction && paymentMethod === 'PIX' && !wantsLink)) {
            const orderCode = Math.random().toString(36).substring(2, 8).toUpperCase();

            const sale = await prisma.sale.create({
                data: {
                    orderCode,
                    total,
                    status: status || 'PAID',
                    paymentMethod: paymentMethod || 'MONEY',
                    buyerName: name || 'Balcão',
                    buyerPhone: phone ? String(phone).replace(/\D/g, '') : null,
                    buyerType: buyerType,
                    buyerGender: gender || null,
                    personId: buyerPersonId,
                    items: {
                        create: finalItems.map(i => ({
                            productId: i.productId, quantity: i.quantity, price: i.price, size: i.size
                        }))
                    }
                },
                include: { items: { include: { product: true } } }
            });

            // Decrementa estoque staff
            for (const i of finalItems) {
                if (i.size) {
                    const field = `stock${i.size}` as 'stockP' | 'stockM' | 'stockG' | 'stockGG';
                    await prisma.product.update({
                        where: { id: i.productId },
                        data: { [field]: { decrement: i.quantity } }
                    });
                }
            }

            return res.json({ sale: { ...sale, total: Number(sale.total) } });
        }

        // --- D. ROTA ONLINE (Mercado Pago) ---

        const cleanCPF = normalizeCPF(cpf || '');
        const cleanPhone = String(phone || '').replace(/\D/g, '');

        if (email) {
            const person = await prisma.person.upsert({
                where: { email },
                update: { name, phone: cleanPhone || undefined, age: Number(age) || null, church, gender },
                create: { name, email, phone: cleanPhone, age: Number(age) || null, church, gender: gender || 'M', type: 'VISITOR' }
            });
            buyerPersonId = person.id;
            if (!manualType) buyerType = person.type;
        }

        const orderCode = Math.random().toString(36).substring(2, 8).toUpperCase();

        // Cria Pagamento PIX no Mercado Pago (Checkout Transparente)
        const paymentData = await mpPayment.create({
            body: {
                transaction_amount: total,
                description: `Pedido ${orderCode} - IBMG`,
                payment_method_id: 'pix',
                payer: {
                    email: email || 'cliente@email.com',
                    first_name: name || 'Cliente'
                },
                external_reference: orderCode
            }
        });

        if (!paymentData.id) return res.status(500).json({ error: 'Erro ao gerar pagamento PIX.' });

        const qrCode = paymentData.point_of_interaction?.transaction_data?.qr_code;
        const qrCodeBase64 = paymentData.point_of_interaction?.transaction_data?.qr_code_base64;

        const sale = await prisma.$transaction(async (tx) => {
            // Decrementa o estoque
            for (const i of finalItems) {
                if (i.size) {
                    const field = `stock${i.size}` as 'stockP' | 'stockM' | 'stockG' | 'stockGG';
                    await tx.product.update({
                        where: { id: i.productId },
                        data: { [field]: { decrement: i.quantity } }
                    });
                }
            }

            return await tx.sale.create({
                data: {
                    orderCode,
                    externalId: String(paymentData.id),
                    total,
                    status: 'PENDING',
                    paymentMethod: 'PIX',
                    buyerName: name,
                    buyerType: buyerType,
                    buyerGender: gender || 'M',
                    personId: buyerPersonId,
                    items: {
                        create: finalItems.map(i => ({
                            productId: i.productId,
                            quantity: i.quantity,
                            price: i.price,
                            size: i.size
                        }))
                    }
                }
            });
        });

        res.json({
            sale: { ...sale, total: Number(sale.total) },
            pixData: {
                paymentId: String(paymentData.id),
                url: qrCodeBase64 ? `data:image/jpeg;base64,${qrCodeBase64}` : null,
                copyPaste: qrCode || null
            }
        });

    } catch (err: any) {
        console.error('❌ Erro Criar Pedido:', err);
        res.status(500).json({ error: 'Erro interno.' });
    }
});

// ============================================================================
// 4. ROTAS DE STATUS E CONSULTA
// ============================================================================

router.get('/check-status/:paymentId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        const { paymentId } = req.params;

        const localSale = await prisma.sale.findUnique({ where: { externalId: paymentId } });
        if (!localSale) return res.json({ status: 'PENDING' });

        if (localSale.status === 'PAID') return res.json({ status: 'PAID', orderCode: localSale.orderCode });

        // Tenta buscar no MP pelo external_reference (orderCode)
        if (localSale.orderCode) {
            // ERROR FIX: Ensure external_reference is not null/undefined and cast if needed
            const search = await mpPayment.search({
                options: { external_reference: localSale.orderCode }
            });

            const completedPayment = search.results?.find(p => p.status === 'approved');

            if (completedPayment) {
                await prisma.sale.update({
                    where: { id: localSale.id },
                    data: { status: 'PAID', externalId: String(completedPayment.id) }
                });
                return res.json({ status: 'PAID', orderCode: localSale.orderCode });
            }
        }

        return res.json({ status: 'PENDING' });
    } catch (err) {
        console.error(err);
        return res.json({ status: 'PENDING' });
    }
});

router.get('/pending', async (req, res) => {
    try {
        const sales = await prisma.sale.findMany({
            where: {
                OR: [
                    { status: 'PAID' },
                    { status: 'PENDING', paymentMethod: { not: 'PIX' } }
                ]
            },
            include: { items: { include: { product: true } }, person: true },
            orderBy: { timestamp: 'desc' }
        });

        const safeSales = sales.map(sale => ({
            ...sale,
            total: Number(sale.total),
            items: sale.items.map(item => ({
                ...item,
                price: Number(item.price)
            }))
        }));

        res.json(safeSales);
    } catch (err) {
        console.error("Erro ao listar pedidos:", err);
        res.status(500).json({ error: 'Erro ao listar pedidos.' });
    }
});

router.post('/pay', async (req, res) => {
    const { orderCode } = req.body;
    try {
        const order = await prisma.sale.findFirst({ where: { orderCode } });
        if (!order) return res.status(404).json({ error: "Pedido não encontrado" });
        const updated = await prisma.sale.update({ where: { id: order.id }, data: { status: 'PAID' } });
        res.json({ ...updated, total: Number(updated.total) });
    } catch (e) { res.status(500).json({ error: "Erro ao pagar" }); }
});

router.post('/deliver', async (req, res) => {
    const { orderCode } = req.body;
    try {
        const order = await prisma.sale.findFirst({ where: { orderCode } });
        if (!order) return res.status(404).json({ error: "Pedido não encontrado" });
        const updated = await prisma.sale.update({ where: { id: order.id }, data: { status: 'DELIVERED' } });
        res.json({ ...updated, total: Number(updated.total) });
    } catch (e) { res.status(500).json({ error: "Erro ao entregar" }); }
});

router.post('/reject', async (req, res) => {
    const { orderCode } = req.body;
    try {
        const order = await prisma.sale.findFirst({ where: { orderCode } });
        if (!order) return res.status(404).json({ error: "Pedido não encontrado" });
        const updated = await prisma.sale.update({ where: { id: order.id }, data: { status: 'CANCELED' } });
        res.json({ ...updated, total: Number(updated.total) });
    } catch (e) { res.status(500).json({ error: "Erro ao cancelar" }); }
});

router.get('/:code', async (req, res) => {
    try {
        const order = await prisma.sale.findFirst({
            where: { orderCode: req.params.code },
            include: { items: { include: { product: true } } }
        });
        if (!order) return res.status(404).json({ error: "Não encontrado" });
        res.json({ ...order, total: Number(order.total) });
    } catch (e) { res.status(500).json({ error: "Erro" }); }
});

router.patch('/:id/deliver', async (req, res) => {
    try {
        const { id } = req.params;
        const updatedSale = await prisma.sale.update({ where: { id }, data: { status: 'DELIVERED' } });
        res.json({ success: true, sale: { ...updatedSale, total: Number(updatedSale.total) } });
    } catch (e) { res.status(500).json({ error: "Erro ao confirmar entrega." }); }
});

export default router;
