import {
    PrismaClient,
    CheckpointCategory,
    PersonType,
    Role
} from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Iniciando seed (Banco Atualizado)...');

    // 0. LIMPEZA (Removido Order e OrderItem que não existem mais)
    try {
        await prisma.saleItem.deleteMany({});
        await prisma.sale.deleteMany({});
        // Order e OrderItem foram removidos do schema, não precisamos deletar aqui
    } catch (e) { console.log('⚠️ Tabelas já limpas ou inexistentes.'); }

    // ========================================================================
    // 1. LOCAIS (SEM GOURMET)
    // ========================================================================
    const locations = [
        { name: "Recepção / Entrada", category: CheckpointCategory.GENERAL },
        { name: "Kombi Evangelística", category: CheckpointCategory.GENERAL },
        { name: "Psalms", category: CheckpointCategory.STORE },
        { name: "Salinha Kids", category: CheckpointCategory.KIDS },
        { name: "Tenda de Oração", category: CheckpointCategory.PRAYER },
        { name: "Casa dos Mártires", category: CheckpointCategory.PRAYER },
        { name: "Sala Profética", category: CheckpointCategory.PROPHETIC },
        { name: "Livraria", category: CheckpointCategory.STORE }
    ];

    for (const loc of locations) {
        await prisma.checkpoint.upsert({
            where: { name: loc.name },
            update: { category: loc.category },
            create: { name: loc.name, category: loc.category }
        });
    }
    console.log(`✅ Locais atualizados.`);

    // ========================================================================
    // 2. PRODUTOS (COM SUPORTE A CARROSSEL)
    // ========================================================================
    await prisma.product.deleteMany({});

    // Função auxiliar para gerar array de imagens (simula carrossel)
    const imgs = (url: string) => [url, url, url];

    await prisma.product.createMany({
        data: [
            // --- Espaço Gourmet (Apenas Visualização) ---
            // {
            //     name: "Água sem Gás",
            //     price: 3.00,
            //     category: "CANTINA",
            //     imageUrl: "https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&q=80&w=500",
            //     images: imgs("https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&q=80&w=500")
            // },
            // {
            //     name: "Refrigerante Lata",
            //     price: 6.00,
            //     category: "CANTINA",
            //     imageUrl: "https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&q=80&w=500",
            //     images: imgs("https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&q=80&w=500")
            // },
            // {
            //     name: "Salgado Assado",
            //     price: 8.00,
            //     category: "CANTINA",
            //     imageUrl: "https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&q=80&w=500",
            //     images: imgs("https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&q=80&w=500")
            // },

            // --- Loja Psalms (Venda Ativa) ---
            {
                name: "Camiseta Ekklesia 2026",
                price: 0.01,
                category: "LOJA",
                description: "Camiseta oficial do evento. 100% Algodão.",
                imageUrl: "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&q=80&w=500",
                images: [
                    "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&q=80&w=500", // Preta
                    "https://images.unsplash.com/photo-1618354691373-d851c5c3a990?auto=format&fit=crop&q=80&w=500", // Detalhe
                    "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?auto=format&fit=crop&q=80&w=500"  // Modelo
                ]
            },
            {
                name: "Livro: Avivamento",
                price: 0.01,
                category: "LOJA",
                description: "Livro exclusivo sobre o tema do ano.",
                imageUrl: "https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&q=80&w=500",
                images: [
                    "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&q=80&w=500", // Preta
                    "https://images.unsplash.com/photo-1618354691373-d851c5c3a990?auto=format&fit=crop&q=80&w=500", // Detalhe
                    "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?auto=format&fit=crop&q=80&w=500"  // Modelo
                ]
            },
            {
                name: "Boné Trucker",
                price: 0.01,
                category: "LOJA",
                imageUrl: "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?auto=format&fit=crop&q=80&w=500",
                images: [
                    "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&q=80&w=500", // Preta
                    "https://images.unsplash.com/photo-1618354691373-d851c5c3a990?auto=format&fit=crop&q=80&w=500", // Detalhe
                    "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?auto=format&fit=crop&q=80&w=500"  // Modelo
                ]
            }
        ]
    });
    console.log(`✅ Produtos recriados.`);

    // 3. CONFIGURAÇÃO GLOBAL
    await prisma.globalConfig.upsert({
        where: { key: 'MEETING_COUNT' },
        update: {},
        create: { key: 'MEETING_COUNT', value: "0" }
    });

    // ========================================================================
    // 4. USUÁRIOS STAFF
    // ========================================================================
    const staffUsers = [
        { name: "Admin Geral", email: "admin@ibmg.com", dept: "ADMIN" },
        { name: "Ana Recepção", email: "ana@recepcao.com", dept: "RECEPTION" },
        { name: "Luiza Loja", email: "luiza@store.com", dept: "STORE" },
        { name: "Carlos Kids", email: "carlos@kids.com", dept: "KIDS" },
        { name: "Paulo Evangelismo", email: "paulo@rua.com", dept: "EVANGELISM" },
        { name: "Pedro Profético", email: "pedro@tenda.com", dept: "PROPHETIC" },
        { name: "Sarah Consolidação", email: "sarah@ficha.com", dept: "CONSOLIDATION" }
    ];

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
                age: 30
            }
        });
        console.log(`👤 Staff: ${u.name}`);
    }

    console.log('🏁 Seed concluído com sucesso.');
}

main()
    .then(async () => { await prisma.$disconnect(); })
    .catch(async (e) => {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
    });
