import {
    PrismaClient,
    CheckpointCategory,
    PersonType,
    Role,
    Prisma
} from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Iniciando seed integral (Banco Sincronizado)...');

    // ========================================================================
    // 0. LIMPEZA DE SEGURANÇA
    // ========================================================================
    try {
        await prisma.saleItem.deleteMany({});
        await prisma.sale.deleteMany({});
        await prisma.manualEntry.deleteMany({});
        await prisma.movement.deleteMany({});
    } catch (e) {
        console.log('⚠️ Erro ao limpar tabelas operacionais:', e);
    }

    // ========================================================================
    // 1. LOCAIS (CHECKPOINTS)
    // ========================================================================
    const locations = [
        { name: "Recepção / Entrada", category: CheckpointCategory.GENERAL },
        { name: "Kombi Evangelística", category: CheckpointCategory.EVANGELISM },
        { name: "Psalms Store", category: CheckpointCategory.STORE },
        { name: "Tenda de Oração", category: CheckpointCategory.PRAYER },
        { name: "Casa dos Mártires", category: CheckpointCategory.PRAYER },
        { name: "Tenda Profética", category: CheckpointCategory.PROPHETIC },
        { name: "Salinha Kids", category: CheckpointCategory.KIDS },

    ];

    console.log('📍 Sincronizando locais...');
    for (const loc of locations) {
        await prisma.checkpoint.upsert({
            where: { name: loc.name },
            update: { category: loc.category },
            create: { name: loc.name, category: loc.category }
        });
    }

    // ========================================================================
    // 2. PRODUTOS REAIS (COM CARROSSEL DE IMAGENS DO UPLOADS)
    // ========================================================================
    await prisma.product.deleteMany({});
    console.log('👕 Cadastrando produtos reais da pasta uploads...');

    await prisma.product.createMany({
        data: [
            {
                name: "Camisa Ekklesia 2026 - Branca",
                price: 90.00,
                stockP: 25,
                stockM: 25,
                stockG: 25,
                stockGG: 25,
                category: "LOJA",
                description: "Camisa oficial do evento. Algodão premium 30.1.",
                imageUrl: "camisa-branca.jpeg",
                images: ["camisa-branca.jpeg", "camisa-branca1.jpeg", "camisa-branca2.jpeg"]
            },
            {
                name: "Moletom Ekklesia - Preto",
                price: 185.00,
                stockP: 25,
                stockM: 25,
                stockG: 25,
                stockGG: 25,
                category: "LOJA",
                description: "Moletom oficial flanelado com capuz.",
                imageUrl: "casaco-preto.jpeg",
                images: ["casaco-preto.jpeg", "casaco-preto1.jpeg"]
            },
            {
                name: "Moletom Ekklesia - Vermelho",
                price: 185.00,
                stockP: 25,
                stockM: 25,
                stockG: 25,
                stockGG: 25,
                category: "LOJA",
                description: "Edição limitada. Moletom premium vermelho.",
                imageUrl: "moletom-vermelho.jpeg",
                images: ["moletom-vermelho.jpeg", "moletom-vermelho1.jpeg", "moletom-vermelho2.jpeg"]
            },

        ] as any
    });

    // ========================================================================
    // 3. CONFIGURAÇÃO GLOBAL
    // ========================================================================
    await prisma.globalConfig.upsert({
        where: { key: 'MEETING_COUNT' },
        update: {},
        create: { key: 'MEETING_COUNT', value: "0" }
    });

    // ========================================================================
    // 4. USUÁRIOS STAFF (Acesso às Telas)
    // ========================================================================
    const staffUsers = [
        { name: "Admin Geral", email: "admin@ibmg.com", dept: "ADMIN" },
        { name: "Ana Recepção", email: "ana@recepcao.com", dept: "RECEPTION" },
        { name: "Luiza Loja", email: "luiza@store.com", dept: "STORE" },
        { name: "Marcos Mártires", email: "marcos@martires.com", dept: "MARTIRES" },
        { name: "Paulo Evangelismo", email: "paulo@rua.com", dept: "EVANGELISM" },
        { name: "Pedro Profético", email: "pedro@tenda.com", dept: "PROPHETIC" }
    ];

    console.log('👤 Sincronizando equipe Staff...');
    for (const u of staffUsers) {
        await prisma.person.upsert({
            where: { email: u.email },
            update: { role: Role.STAFF, department: u.dept },
            create: {
                name: u.name,
                email: u.email,
                type: PersonType.MEMBER,
                role: Role.STAFF,
                department: u.dept,
                church: "Ibmg Sede",
                age: 30,
                gender: "M"
            }
        });
    }

    console.log('🏁 Seed finalizado com sucesso. Ambiente pronto.');
}

main()
    .then(async () => { await prisma.$disconnect(); })
    .catch(async (e) => {
        console.error('❌ Erro no Seed:', e);
        await prisma.$disconnect();
        process.exit(1);
    });