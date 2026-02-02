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
   CRIAR PEDIDO / GERAR PIX (CORRIGIDO ERRO 500)
====================================================== */

router.post('/', async (req, res) => {
    try {
        const { name, email, phone, cpf, age, church, items, gender } = req.body;

        if (!name || !email || !cpf || !phone) {
            return res.status(400).json({ error: 'Dados obrigatórios ausentes.' });
        }

        const cleanCPF = normalizeCPF(cpf);
        const cleanPhone = String(phone).replace(/\D/g, '');

        if (!isValidCPF(cleanCPF)) {
            return res.status(400).json({ error: 'CPF inválido.' });
        }

        const parsedItems = typeof items === 'string' ? JSON.parse(items) : items;

        if (!Array.isArray(parsedItems) || !parsedItems.length) {
            return res.status(400).json({ error: 'Carrinho vazio.' });
        }

        // 1. Busca Produtos
        const productIds = parsedItems.map((i: any) => i.productId);
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

        // 2. Upsert Person (Contagem de Visitante)
        const person = await prisma.person.upsert({
            where: { email },
            update: {
                name,
                phone: cleanPhone,
                age: age ? Number(age) : undefined,
                church,
                gender: gender || undefined
            },
            create: {
                name,
                email,
                phone: cleanPhone,
                age: age ? Number(age) : null,
                church,
                gender: gender || 'M', // Default Masculino se não vier
                type: 'VISITOR'
            }
        });

        // 3. Cliente AbacatePay (Anti-Falha 422)
        let customerId = '';

        try {
            const resCustomer = await gatewayApi.post('/customer/create', {
                name,
                email,
                cellphone: cleanPhone,
                taxId: cleanCPF
            });
            customerId = resCustomer.data?.data?.id || resCustomer.data?.id;
        } catch (e) {
            // Se falhar (já existe), busca na lista
            const list = await gatewayApi.get('/customer/list');
            const found = (list.data?.data || list.data || []).find(
                (c: any) => c.email === email || c.taxId === cleanCPF
            );
            if (found) customerId = found.id;
        }

        if (!customerId) {
            return res.status(400).json({ error: 'Erro ao criar cliente de pagamento.' });
        }

        // 4. Cria Billing (PIX)
        const billing = await gatewayApi.post('/billing/create', {
            frequency: 'ONE_TIME',
            methods: ['PIX'],
            customerId,
            products: finalItems.map(i => ({
                externalId: i.productId,
                name: i.name,
                quantity: i.quantity,
                price: Math.round(Number(i.price) * 100) // Centavos
            })),
            returnUrl: 'https://ibmg-three.vercel.app/ekklesia',
            completionUrl: 'https://ibmg-three.vercel.app/ekklesia'
        });

        const billingData = billing.data?.data || billing.data;

        if (!billingData?.id) {
            return res.status(500).json({ error: 'Erro ao gerar PIX.' });
        }

        // 5. Salva Venda no Banco
        const orderCode = Math.random().toString(36).substring(2, 8).toUpperCase();

        const sale = await prisma.sale.create({
            data: {
                orderCode,
                externalId: billingData.id,
                total, // Prisma aceita number e converte pra Decimal
                status: 'PENDING',
                paymentMethod: 'PIX',
                buyerName: name,
                buyerType: person.type,
                buyerGender: person.gender || 'M',
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

        // 🔥 CORREÇÃO DO ERRO 500: Converte Decimal para Number antes de responder
        const safeSale = {
            ...sale,
            total: Number(sale.total)
        };

        res.json({
            sale: safeSale,
            pixData: {
                paymentId: billingData.id,
                copyPaste: billingData.pix?.code || billingData.url
            }
        });

    } catch (err: any) {
        console.error('❌ Erro criar pedido:', err);
        res.status(500).json({ error: 'Erro interno.' });
    }
});

/* ======================================================
   CHECK STATUS (POLLING)
====================================================== */

router.get('/check-status/:paymentId', async (req, res) => {
    // 1. Mata o Cache para garantir dados frescos
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    try {
        const { paymentId } = req.params;
        // console.log(`🔍 [POLLING] Verificando ID: ${paymentId}`);

        // 2. Chama a API
        const response = await gatewayApi.get('/billing/list', {
            params: { id: paymentId }
        });

        const list = response.data?.data || response.data;

        // 3. Log de Debug (Vai aparecer no terminal)
        // console.log("📦 [DEBUG API] Resposta crua:", JSON.stringify(list, null, 2));

        // Tenta encontrar o boleto/pix específico
        const bill = Array.isArray(list)
            ? list.find((b: any) => b.id === paymentId)
            : list;

        if (!bill) {
            console.warn("⚠️ [DEBUG] Bill não encontrado na lista.");
            return res.json({ status: 'PENDING' });
        }

        console.log(`👀 [DEBUG] Status na API: ${bill.status}`);

        // 4. Verificação de Pagamento (Aceita PAID, paid, COMPLETED, completed)
        const status = String(bill.status).toUpperCase();

        if (status === 'PAID' || status === 'COMPLETED') {

            // Busca a venda no banco
            const sale = await prisma.sale.findUnique({
                where: { externalId: paymentId }
            });

            if (sale) {
                // Se ainda não estiver pago no NOSSO banco, atualiza
                if (sale.status !== 'PAID') {
                    console.log(`✅ [ATUALIZANDO] Venda ${sale.orderCode} mudou para PAID!`);
                    await prisma.sale.update({
                        where: { id: sale.id },
                        data: { status: 'PAID' }
                    });
                }

                return res.json({
                    status: 'PAID',
                    orderCode: sale.orderCode
                });
            }
        }

        return res.json({ status: 'PENDING' });

    } catch (err: any) {
        console.error('❌ [ERRO POLLING]:', err.message);
        // Em caso de erro, mantém o front esperando, não quebra
        return res.json({ status: 'PENDING' });
    }
});

/* ======================================================
   ENTREGA DO PRODUTO (STAFF - CENÁRIO RETIRADA)
====================================================== */

router.patch('/:id/deliver', async (req, res) => {
    try {
        const { id } = req.params;

        const sale = await prisma.sale.findUnique({ where: { id } });

        if (!sale) return res.status(404).json({ error: "Pedido não encontrado." });

        const updatedSale = await prisma.sale.update({
            where: { id },
            data: { status: 'DELIVERED' }
        });

        console.log(`📦 Pedido ${sale.orderCode} entregue.`);

        // Conversão de Decimal para segurança
        const safeSale = { ...updatedSale, total: Number(updatedSale.total) };
        res.json({ success: true, sale: safeSale });

    } catch (e) {
        res.status(500).json({ error: "Erro ao confirmar entrega." });
    }
});

/* ======================================================
   LISTA DE RETIRADA (STAFF)
====================================================== */

router.get('/pending', async (_, res) => {
    try {
        const sales = await prisma.sale.findMany({
            where: { status: 'PAID' }, // Mostra apenas o que já foi pago e precisa entregar
            include: {
                items: { include: { product: true } },
                person: true
            },
            orderBy: { timestamp: 'asc' } // Fila por ordem de chegada
        });

        // Tratamento de Decimals para o Front não quebrar
        const safeSales = sales.map(s => ({
            ...s,
            total: Number(s.total),
            items: s.items.map(i => ({
                ...i,
                price: Number(i.price)
            }))
        }));

        res.json(safeSales);
    } catch {
        res.status(500).json({ error: 'Erro ao listar pedidos.' });
    }
});

export default router;