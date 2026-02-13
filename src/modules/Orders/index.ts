import { Router } from 'express';
import axios from 'axios';
import { prisma } from '../../lib/prisma';
import { PersonType } from '@prisma/client'; // 👈 IMPORTAÇÃO NECESSÁRIA PARA CORRIGIR O ERRO

const router = Router();

// ============================================================================
// 1. CONFIGURAÇÃO E HELPERS
// ============================================================================

const ABACATE_TOKEN = process.env.PSALMSKEY;
if (!ABACATE_TOKEN) console.error('❌ PSALMSKEY não configurada');

const gatewayApi = axios.create({
    baseURL: 'https://api.abacatepay.com/v1',
    headers: { Authorization: `Bearer ${ABACATE_TOKEN}`, 'Content-Type': 'application/json' },
    timeout: 15000
});

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
// 2. WEBHOOK (AUTOMÁTICO)
// ============================================================================
router.post('/webhook/abacatepay', async (req, res) => {
    try {
        const { event, data } = req.body;
        console.log('🥑 Webhook:', event);

        if (event !== 'billing.paid') return res.sendStatus(200);

        const paymentId = data?.billing?.id || data?.id;
        if (!paymentId) return res.sendStatus(200);

        const sale = await prisma.sale.findUnique({ where: { externalId: paymentId } });
        if (!sale || sale.status === 'PAID') return res.sendStatus(200);

        await prisma.sale.update({
            where: { id: sale.id },
            data: { status: 'PAID' }
        });

        console.log(`🚀 Venda ${sale.orderCode} PAGA via Webhook.`);
        res.sendStatus(200);
    } catch (err: any) {
        console.error('❌ Erro webhook:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
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

        // --- B. Define Tipo de Comprador (CORRIGIDO O ERRO DE TYPE) ---
        // O padrão é VISITOR, mas tipado corretamente como PersonType
        let buyerType: PersonType = 'VISITOR';
        let buyerPersonId = personId || null;

        if (manualType && (manualType === 'MEMBER' || manualType === 'VISITOR')) {
            // 1. Prioridade: Botão do Modal (Forçamos o tipo para evitar erro de string)
            buyerType = manualType as PersonType;
        } else if (personId) {
            // 2. Se não marcou, mas tem cadastro
            const person = await prisma.person.findUnique({ where: { id: personId } });
            if (person) buyerType = person.type; // Aqui já vem tipado do banco
        }


        // --- C. ROTA STAFF (Dinheiro/Cartão OU PIX Manual de Balcão) ---
        // Se for PIX e for Staff, entra aqui também
        if ((paymentMethod && paymentMethod !== 'PIX') || (isStaffAction && paymentMethod === 'PIX')) {
            const orderCode = Math.random().toString(36).substring(2, 8).toUpperCase();

            const sale = await prisma.sale.create({
                data: {
                    orderCode,
                    total,
                    status: status || 'PAID', // Staff já registra como PAGO se for PIX Balcão
                    paymentMethod: paymentMethod || 'MONEY',
                    buyerName: name || 'Balcão',
                    buyerType: buyerType, // 👈 Agora vai funcionar
                    buyerGender: gender || null,
                    personId: buyerPersonId,
                    items: {
                        create: finalItems.map(i => ({
                            productId: i.productId, quantity: i.quantity, price: i.price
                        }))
                    }
                },
                include: { items: { include: { product: true } } }
            });

            return res.json({ sale: { ...sale, total: Number(sale.total) } });
        }

        // --- D. ROTA ONLINE (PIX / AbacatePay) - APENAS SE NÃO FOR STAFF ---
        // OBS: Relaxando validação para caso o frontend não envie tudo (pedido do usuário).
        // if (!name || !email || !cpf || !phone) {
        //    return res.status(400).json({ error: 'Para PIX Online, preencha todos os dados.' });
        // }

        const cleanCPF = normalizeCPF(cpf);
        const cleanPhone = String(phone).replace(/\D/g, '');
        if (!isValidCPF(cleanCPF)) return res.status(400).json({ error: 'CPF inválido.' });

        // Upsert Pessoa
        const person = await prisma.person.upsert({
            where: { email },
            update: { name, phone: cleanPhone, age: Number(age) || null, church, gender },
            create: { name, email, phone: cleanPhone, age: Number(age) || null, church, gender: gender || 'M', type: 'VISITOR' }
        });

        // Se não veio manualType, usa o do cadastro. Se veio, usa o manualType.
        // Convertendo para PersonType para evitar erro
        if (!manualType) {
            buyerType = person.type;
        } else {
            // Garante que é um dos valores válidos do Enum
            buyerType = (manualType === 'MEMBER' || manualType === 'VISITOR') ? manualType as PersonType : 'VISITOR';
        }

        buyerPersonId = person.id;

        // Integração Abacate
        let customerId = '';
        try {
            const resCustomer = await gatewayApi.post('/customer/create', { name, email, cellphone: cleanPhone, taxId: cleanCPF });
            customerId = resCustomer.data?.data?.id || resCustomer.data?.id;
        } catch (e) {
            const list = await gatewayApi.get('/customer/list');
            const found = (list.data?.data || []).find((c: any) => c.email === email || c.taxId === cleanCPF);
            if (found) customerId = found.id;
        }

        if (!customerId) return res.status(400).json({ error: 'Erro no gateway de pagamento.' });

        const billing = await gatewayApi.post('/billing/create', {
            frequency: 'ONE_TIME', methods: ['PIX'], customerId,
            products: finalItems.map(i => ({ externalId: i.productId, name: i.name, quantity: i.quantity, price: Math.round(Number(i.price) * 100) })),
            returnUrl: 'https://ibmg-three.vercel.app/ekklesia', completionUrl: 'https://ibmg-three.vercel.app/ekklesia'
        });

        const billingData = billing.data?.data || billing.data;
        if (!billingData?.id) return res.status(500).json({ error: 'Erro ao gerar PIX.' });

        const orderCode = Math.random().toString(36).substring(2, 8).toUpperCase();

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
                    orderCode, externalId: billingData.id, total, status: 'PENDING', paymentMethod: 'PIX',
                    buyerName: name,
                    buyerType: buyerType, // 👈 Agora vai funcionar
                    buyerGender: gender || 'M', personId: buyerPersonId,
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
            pixData: { paymentId: billingData.id, copyPaste: billingData.pix?.code || billingData.url }
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

        if (localSale?.status === 'PAID') return res.json({ status: 'PAID', orderCode: localSale.orderCode });

        const response = await gatewayApi.get('/billing/list', { params: { id: paymentId } });
        const list = response.data?.data || response.data;
        const bill = Array.isArray(list) ? list.find((b: any) => b.id === paymentId) : list;

        if (bill && (bill.status === 'PAID' || bill.status === 'COMPLETED')) {
            if (localSale && localSale.status !== 'PAID') {
                await prisma.sale.update({ where: { id: localSale.id }, data: { status: 'PAID' } });
            }
            return res.json({ status: 'PAID', orderCode: localSale?.orderCode });
        }
        return res.json({ status: 'PENDING' });
    } catch (err) { return res.json({ status: 'PENDING' }); }
});

router.get('/pending', async (req, res) => {
    try {
        // 1. FILTRO DE PENDÊNCIAS (Rota /pending)
        const sales = await prisma.sale.findMany({
            where: {
                OR: [
                    { status: 'PAID' }, // Vendas Pagas aparecem
                    { status: 'PENDING', paymentMethod: { not: 'PIX' } } // Pendentes aparecem SÓ se NÃO forem Pix Online
                ]
            },
            include: { items: { include: { product: true } }, person: true },
            orderBy: { timestamp: 'desc' }
        });

        // Conversão de Decimal para Number (Essencial para não quebrar o JSON)
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

// Rota PATCH (Legado)
router.patch('/:id/deliver', async (req, res) => {
    try {
        const { id } = req.params;
        const updatedSale = await prisma.sale.update({ where: { id }, data: { status: 'DELIVERED' } });
        res.json({ success: true, sale: { ...updatedSale, total: Number(updatedSale.total) } });
    } catch (e) { res.status(500).json({ error: "Erro ao confirmar entrega." }); }
});

export default router;