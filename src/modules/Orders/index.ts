import { Router } from 'express';
import axios from 'axios';
import { prisma } from '../../lib/prisma';

const router = Router();

/* ======================================================
   CONFIG ABACATEPAY
====================================================== */

const ABACATE_TOKEN = process.env.PSALMSKEY;

if (!ABACATE_TOKEN) {
    console.error('❌ PSALMSKEY não configurada');
}

const gatewayApi = axios.create({
    baseURL: 'https://api.abacatepay.com/v1',
    headers: {
        Authorization: `Bearer ${ABACATE_TOKEN}`,
        'Content-Type': 'application/json'
    },
    timeout: 15000
});

/* ======================================================
   HELPERS
====================================================== */

function isValidCPF(cpf: string) {
    cpf = cpf.replace(/\D/g, '');
    if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;

    let sum = 0;
    for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
    let rest = (sum * 10) % 11;
    if (rest === 10) rest = 0;
    if (rest !== Number(cpf[9])) return false;

    sum = 0;
    for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
    rest = (sum * 10) % 11;
    if (rest === 10) rest = 0;

    return rest === Number(cpf[10]);
}

const normalizeCPF = (cpf: string) => cpf.replace(/\D/g, '');

const formatCPF = (cpf: string) =>
    cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

/* ======================================================
   WEBHOOK (ABACATEPAY → BACKEND)
====================================================== */

router.post('/webhook/abacatepay', async (req, res) => {
    try {
        const { event, data } = req.body;

        console.log('🥑 Webhook recebido:', event, data?.id, data?.status);

        if (event !== 'billing.paid' && data?.status !== 'PAID') {
            return res.sendStatus(200);
        }

        const sale = await prisma.sale.findUnique({
            where: { externalId: data.id }
        });

        if (!sale) return res.sendStatus(200);
        if (sale.status === 'PAID') return res.sendStatus(200);

        await prisma.sale.update({
            where: { id: sale.id },
            data: { status: 'PAID' }
        });

        console.log(`✅ Venda ${sale.orderCode} confirmada via webhook`);
        res.sendStatus(200);
    } catch (err) {
        console.error('❌ Erro webhook:', err);
        res.sendStatus(500);
    }
});

/* ======================================================
   CRIAR PEDIDO / GERAR PIX
====================================================== */

router.post('/', async (req, res) => {
    try {
        const { name, email, phone, cpf, age, church, items } = req.body;

        if (!name || !email || !cpf || !phone) {
            return res.status(400).json({ error: 'Dados obrigatórios ausentes.' });
        }

        const cleanCPF = normalizeCPF(cpf);
        const cleanPhone = String(phone).replace(/\D/g, '');

        if (!isValidCPF(cleanCPF)) {
            return res.status(400).json({ error: 'CPF inválido.' });
        }

        const parsedItems =
            typeof items === 'string' ? JSON.parse(items) : items;

        if (!Array.isArray(parsedItems) || !parsedItems.length) {
            return res.status(400).json({ error: 'Carrinho vazio.' });
        }

        /* ============================
           BUSCA PRODUTOS
        ============================ */

        const productIds = parsedItems.map(i => i.productId);

        const products = await prisma.product.findMany({
            where: { id: { in: productIds } }
        });

        let total = 0;
        const finalItems: any[] = [];

        for (const item of parsedItems) {
            const product = products.find(p => p.id === item.productId);
            if (!product) continue;

            const quantity = Math.max(1, Number(item.quantity));
            const price = Number(product.price);
            total += price * quantity;

            finalItems.push({
                productId: product.id,
                name: product.name,
                quantity,
                price: product.price
            });
        }

        if (!finalItems.length) {
            return res.status(400).json({ error: 'Produtos inválidos.' });
        }

        /* ============================
           UPSERT PERSON
        ============================ */

        const person = await prisma.person.upsert({
            where: { email },
            update: {
                name,
                phone: cleanPhone,
                age: age ? Number(age) : undefined,
                church
            },
            create: {
                name,
                email,
                phone: cleanPhone,
                age: age ? Number(age) : null,
                church,
                type: 'VISITOR'
            }
        });

        /* ============================
           CUSTOMER ABACATEPAY
        ============================ */

        let customerId = '';

        try {
            const resCustomer = await gatewayApi.post('/customer/create', {
                name,
                email,
                cellphone: cleanPhone,
                taxId: cleanCPF
            });

            customerId = resCustomer.data?.data?.id;
        } catch {
            const list = await gatewayApi.get('/customer/list', {
                params: { email }
            });

            const found = (list.data?.data || []).find(
                (c: any) => c.email === email
            );

            if (found) customerId = found.id;
        }

        if (!customerId) {
            return res
                .status(400)
                .json({ error: 'Erro ao criar cliente de pagamento.' });
        }

        /* ============================
           CRIA BILLING (PIX)
        ============================ */

        const billing = await gatewayApi.post('/billing/create', {
            frequency: 'ONE_TIME',
            methods: ['PIX'],
            customerId,
            products: finalItems.map(i => ({
                externalId: i.productId,
                name: i.name,
                quantity: i.quantity,
                price: Math.round(i.price * 100)
            })),
            returnUrl: 'https://ibmg-three.vercel.app/ekklesia',
            completionUrl: 'https://ibmg-three.vercel.app/ekklesia'
        });

        const billingData = billing.data?.data;

        if (!billingData?.id) {
            return res.status(500).json({ error: 'Erro ao gerar PIX.' });
        }

        /* ============================
           SALVA VENDA
        ============================ */

        const orderCode = Math.random().toString(36).substring(2, 8).toUpperCase();

        const sale = await prisma.sale.create({
            data: {
                orderCode,
                externalId: billingData.id,
                total,
                status: 'PENDING',
                paymentMethod: 'PIX',
                buyerName: name,
                buyerType: person.type,
                buyerGender: person.gender || 'U',
                personId: person.id,
                items: {
                    create: finalItems.map(i => ({
                        productId: i.productId,
                        quantity: i.quantity,
                        price: i.price
                    }))
                }
            }
        });

        res.json({
            sale,
            pixData: {
                paymentId: billingData.id,
                copyPaste: billingData.pix?.code || billingData.url
            }
        });
    } catch (err: any) {
        console.error('❌ Erro criar pedido:', err.message);
        res.status(500).json({ error: 'Erro interno.' });
    }
});

/* ======================================================
   CHECK STATUS (POLLING)
====================================================== */

router.get('/check-status/:paymentId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    try {
        const { paymentId } = req.params;

        const response = await gatewayApi.get('/billing/list', {
            params: { id: paymentId }
        });

        const list = response.data?.data || response.data;
        const bill = Array.isArray(list)
            ? list.find((b: any) => b.id === paymentId)
            : null;

        if (!bill) return res.json({ status: 'PENDING' });

        if (bill.status === 'PAID' || bill.status === 'COMPLETED') {
            const sale = await prisma.sale.findUnique({
                where: { externalId: paymentId }
            });

            if (sale && sale.status !== 'PAID') {
                await prisma.sale.update({
                    where: { id: sale.id },
                    data: { status: 'PAID' }
                });
            }

            return res.json({
                status: 'PAID',
                orderCode: sale?.orderCode
            });
        }

        return res.json({ status: 'PENDING' });
    } catch (err: any) {
        console.error('❌ check-status error:', err.message);
        return res.json({ status: 'PENDING' });
    }
});

/* ======================================================
   LISTAGEM (ADMIN / DEBUG)
====================================================== */

router.get('/pending', async (_, res) => {
    try {
        const sales = await prisma.sale.findMany({
            where: { status: { in: ['PENDING', 'PAID'] } },
            include: {
                items: { include: { product: true } },
                person: true
            },
            orderBy: { timestamp: 'desc' }
        });

        res.json(sales);
    } catch {
        res.status(500).json({ error: 'Erro ao listar pedidos.' });
    }
});

export default router;
