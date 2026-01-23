// prisma/seed.ts
import {
    PrismaClient,
    CheckpointCategory,
    PersonType,
    Role
} from '@prisma/client'; // Certifique-se que o VS Code não está reclamando aqui

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Iniciando seed do banco de dados...');

    // ========================================================================
    // 1. LOCAIS (CHECKPOINTS)
    // ========================================================================
    const locations = [
        { name: "Recepção / Entrada", category: CheckpointCategory.GENERAL },
        { name: "Kombi Evangelística", category: CheckpointCategory.GENERAL },
        { name: "Psalms", category: CheckpointCategory.STORE },
        { name: "Salinha Kids", category: CheckpointCategory.KIDS },
        { name: "Tenda de Oração", category: CheckpointCategory.PRAYER },
        { name: "Cantina", category: CheckpointCategory.PRAYER },
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
    console.log(`✅ Locais garantidos.`);

    // ========================================================================
    // 2. PRODUTOS (LOJA E CANTINA) COM IMAGENS
    // ========================================================================
    const productCount = await prisma.product.count();

    if (productCount === 0) {
        await prisma.product.createMany({
            data: [
                // Cantina (Comidas)
                { name: "Água sem Gás", price: 3.00, category: "CANTINA", imageUrl: "https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&q=80&w=500" },
                { name: "Refrigerante Lata", price: 6.00, category: "CANTINA", imageUrl: "https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&q=80&w=500" },
                { name: "Salgado Assado", price: 8.00, category: "CANTINA", imageUrl: "https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&q=80&w=500" },
                { name: "Café Expresso", price: 4.00, category: "CANTINA", imageUrl: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&q=80&w=500" },
                { name: "Chocolate", price: 5.00, category: "CANTINA", imageUrl: "https://images.unsplash.com/photo-1511381978829-f011418d229d?auto=format&fit=crop&q=80&w=500" },

                // Loja Psalms (Roupas)
                { name: "Camiseta Ekklesia 2026", price: 69.90, category: "LOJA", imageUrl: "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&q=80&w=500" },
                { name: "Livro: Avivamento", price: 45.00, category: "LOJA", imageUrl: "https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&q=80&w=500" },
                { name: "Boné Trucker", price: 50.00, category: "LOJA", imageUrl: "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?auto=format&fit=crop&q=80&w=500" },
                { name: "Caneca Personalizada", price: 35.00, category: "LOJA", imageUrl: "https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&q=80&w=500" }
            ]
        });
        console.log(`✅ Produtos criados com imagens.`);
    } else {
        console.log(`⚡ Produtos já existem.`);
    }

    // ========================================================================
    // 3. CONTADOR DE REUNIÕES
    // ========================================================================
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
        { name: "Marcos Cantina", email: "marcos@cantina.com", dept: "CANTINA" },
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

    console.log('🏁 Seed finalizado com sucesso!');
}

main()
    .then(async () => { await prisma.$disconnect(); })
    .catch(async (e) => {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
    });