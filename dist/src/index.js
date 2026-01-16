"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
// 1. ATUALIZE OS IMPORTS NO TOPO
const client_1 = require("@prisma/client");
const date_fns_1 = require("date-fns");
const zod_1 = require("zod"); // Biblioteca de validação
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
const PORT = process.env.PORT || 3001;
// --- MIDDLEWARES (Segurança e Logs) ---
app.use((0, cors_1.default)({ origin: '*' }));
app.use((0, helmet_1.default)()); // Proteção de headers HTTP
app.use(express_1.default.json());
app.use((0, morgan_1.default)('dev')); // Log detalhado no terminal (GET /dashboard 200 15ms)
// --- CONFIGURAÇÕES E CONSTANTES ---
const CHURCHES = [
    "Ibmg Alphaville", "Ibmg Orlando", "Ibmg Sede", "Ibmg Santa Maria", "Ibmg Caldas", "Outra"
];
// Locais que permitem bipar a mesma pessoa várias vezes no dia (Atendimentos)
const SERVICE_CATEGORIES = ['PROPHETIC', 'PRAYER', 'EVANGELISM', 'CONSOLIDATION', 'STORE'];
// --- SCHEMAS DE VALIDAÇÃO (ZOD) ---
const CountSchema = zod_1.z.object({
    checkpointId: zod_1.z.string().min(1),
    type: zod_1.z.enum(['MEMBER', 'VISITOR']),
    church: zod_1.z.string().optional(),
    quantity: zod_1.z.number().min(1).default(1),
    ageGroup: zod_1.z.string().optional(),
    gender: zod_1.z.string().optional(),
    marketingSource: zod_1.z.string().nullable().optional()
});
const RegisterSchema = zod_1.z.object({
    name: zod_1.z.string().min(3),
    email: zod_1.z.string().email().optional().or(zod_1.z.literal('')),
    phone: zod_1.z.string().optional(),
    type: zod_1.z.string(),
    church: zod_1.z.string().optional(),
    gender: zod_1.z.string().optional(),
    marketingSource: zod_1.z.string().optional(),
    age: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional(),
    isStaff: zod_1.z.boolean().optional()
});
// --- ROTAS PÚBLICAS ---
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'Ekklesia Event API Running 🚀',
        timestamp: new Date()
    });
});
app.get('/config/churches', (req, res) => res.json(CHURCHES));
// --- 1. AUTENTICAÇÃO ---
app.post('/auth/login', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { email } = req.body;
    try {
        if (!email)
            return res.status(400).json({ error: "E-mail obrigatório" });
        const user = yield prisma.person.findUnique({ where: { email: String(email) } });
        if (!user)
            return res.status(404).json({ error: "E-mail não encontrado na base." });
        if (user.role !== 'STAFF')
            return res.status(403).json({ error: "Acesso restrito à equipe." });
        // Log de acesso
        console.log(`[LOGIN] Staff ${user.name} logou às ${new Date().toLocaleTimeString()}`);
        res.json(user);
    }
    catch (error) {
        console.error("Erro Login:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
}));
// --- 2. CONTADOR MANUAL (Melhorado) ---
app.post('/count', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Validação dos dados recebidos
        const data = CountSchema.parse(req.body);
        // DEBOUNCE: Evita cliques duplos acidentais (se for idêntico e < 2s)
        const lastEntry = yield prisma.manualEntry.findFirst({
            where: { checkpointId: data.checkpointId, type: data.type },
            orderBy: { timestamp: 'desc' }
        });
        if (lastEntry) {
            const diff = new Date().getTime() - new Date(lastEntry.timestamp).getTime();
            // Se foi há menos de 2 segundos E os dados são iguais, ignora
            if (diff < 2000 && lastEntry.gender === data.gender && lastEntry.ageGroup === data.ageGroup && lastEntry.church === data.church) {
                return res.json({ success: true, message: "Duplicidade evitada (clique rápido)", ignored: true });
            }
        }
        const entry = yield prisma.manualEntry.create({
            data: {
                checkpointId: data.checkpointId,
                type: data.type,
                church: data.church || 'Ibmg Sede',
                ageGroup: data.ageGroup || 'ADULTO',
                gender: data.gender || 'M',
                quantity: data.quantity,
                marketingSource: data.marketingSource || null,
                timestamp: new Date()
            }
        });
        // Retorna o total do dia para aquele checkpoint (Feedback instantâneo)
        const todayStart = (0, date_fns_1.startOfDay)(new Date());
        const todayEnd = (0, date_fns_1.endOfDay)(new Date());
        const totalToday = yield prisma.manualEntry.aggregate({
            where: {
                checkpointId: data.checkpointId,
                timestamp: { gte: todayStart, lte: todayEnd }
            },
            _sum: { quantity: true }
        });
        res.json({ success: true, totalToday: totalToday._sum.quantity || 0, entry });
    }
    catch (error) {
        console.error(error);
        res.status(400).json({ error: "Dados inválidos ou erro ao salvar." });
    }
}));
// --- 3. TRACKING QR CODE (Lógica Inteligente de Reentrada) ---
app.post('/track', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { personId, checkpointId } = req.body;
    const todayStart = (0, date_fns_1.startOfDay)(new Date());
    const todayEnd = (0, date_fns_1.endOfDay)(new Date());
    if (!personId || !checkpointId)
        return res.status(400).json({ error: "IDs obrigatórios" });
    try {
        // 1. Busca informações do Local (Checkpoint) para saber se é Serviço ou Entrada
        const checkpoint = yield prisma.checkpoint.findUnique({ where: { id: checkpointId } });
        if (!checkpoint)
            return res.status(404).json({ error: "Local não encontrado" });
        // Se o local for de categoria "SERVIÇO" (Oração, Profético), permite contar várias vezes
        // Se for "GERAL" (Entrada) ou "KIDS", bloqueia repetição
        const allowReentry = SERVICE_CATEGORIES.includes(checkpoint.category || '');
        // 2. Verifica registro existente HOJE
        const existing = yield prisma.movement.findFirst({
            where: {
                personId,
                checkpointId,
                timestamp: { gte: todayStart, lte: todayEnd }
            },
            include: { person: true, checkpoint: true }
        });
        // 3. Rate Limit Preventivo: Se a pessoa foi bipada no MESMO local há menos de 1 minuto, ignora
        if (existing) {
            const secondsDiff = (new Date().getTime() - new Date(existing.timestamp).getTime()) / 1000;
            if (secondsDiff < 60) {
                return res.json({ success: true, status: 'IGNORED', person: existing.person, message: `⏳ Aguarde para bipar novamente.` });
            }
        }
        // 4. Lógica de Bloqueio (Se não for serviço e já existir, barra a contagem)
        if (existing && !allowReentry) {
            return res.json({
                success: true,
                status: 'REENTRY',
                person: existing.person,
                message: `⚠️ ${existing.person.name.split(' ')[0]} já entrou hoje.`
            });
        }
        // 5. Cria o movimento (Conta +1)
        const newMove = yield prisma.movement.create({
            data: { personId, checkpointId },
            include: { person: true, checkpoint: true }
        });
        return res.json({
            success: true,
            status: 'SUCCESS',
            person: newMove.person,
            message: allowReentry ? `✅ Atendimento registrado!` : `✅ Acesso Liberado!`
        });
    }
    catch (error) {
        console.error("Erro /track:", error);
        res.status(500).json({ success: false, error: "Erro interno" });
    }
}));
// --- 4. DASHBOARD (Agregador de Dados Completo) ---
app.get('/dashboard', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Datas do evento (ajuste conforme a realidade)
        const eventStart = new Date('2025-01-01T00:00:00');
        const eventEnd = new Date('2026-12-31T23:59:59');
        // Executa as queries em paralelo para performance
        const [manualEntries, scannerEntries] = yield Promise.all([
            prisma.manualEntry.findMany({
                where: { timestamp: { gte: eventStart, lte: eventEnd } },
                include: { checkpoint: { select: { name: true } } }
            }),
            prisma.movement.findMany({
                where: { timestamp: { gte: eventStart, lte: eventEnd } },
                select: {
                    timestamp: true,
                    // Movimentos QR code contam como 1
                    checkpoint: { select: { name: true } },
                    person: { select: { type: true, gender: true, age: true, church: true, marketingSource: true } }
                }
            })
        ]);
        // Unifica e Normaliza
        const allEntries = [
            ...manualEntries.map(e => {
                var _a;
                return ({
                    timestamp: e.timestamp,
                    quantity: e.quantity,
                    type: e.type,
                    gender: e.gender,
                    ageGroup: e.ageGroup,
                    church: e.church,
                    marketing: e.marketingSource,
                    checkpointName: ((_a = e.checkpoint) === null || _a === void 0 ? void 0 : _a.name) || 'Indefinido'
                });
            }),
            ...scannerEntries.map(e => {
                var _a;
                return ({
                    timestamp: e.timestamp,
                    quantity: 1,
                    type: e.person.type,
                    gender: e.person.gender,
                    ageGroup: e.person.age ? (e.person.age < 12 ? 'CRIANCA' : e.person.age < 18 ? 'JOVEM' : 'ADULTO') : 'ADULTO',
                    church: e.person.church,
                    marketing: e.person.marketingSource,
                    checkpointName: ((_a = e.checkpoint) === null || _a === void 0 ? void 0 : _a.name) || 'Indefinido'
                });
            })
        ];
        // Estruturas de Retorno
        const timeline = {};
        const checkpointsData = {};
        // Processamento em memória
        allEntries.forEach(e => {
            const date = new Date(e.timestamp);
            const day = date.getDate().toString();
            const hour = date.getHours().toString();
            const local = e.checkpointName;
            // 1. Timeline (Por Dia > Hora)
            if (!timeline[day])
                timeline[day] = {};
            if (!timeline[day][hour])
                timeline[day][hour] = 0;
            timeline[day][hour] += e.quantity;
            // 2. Checkpoints Data (Por Dia > Local > Detalhes)
            if (!checkpointsData[day])
                checkpointsData[day] = {};
            if (!checkpointsData[day][local]) {
                checkpointsData[day][local] = {
                    total: 0,
                    gender: { M: 0, F: 0 },
                    age: { CRIANCA: 0, JOVEM: 0, ADULTO: 0 },
                    type: { MEMBER: 0, VISITOR: 0 },
                    marketing: {},
                    church: {}
                };
            }
            const stats = checkpointsData[day][local];
            stats.total += e.quantity;
            // Demografia
            if (e.gender === 'M')
                stats.gender.M += e.quantity;
            else if (e.gender === 'F')
                stats.gender.F += e.quantity;
            if (e.ageGroup === 'CRIANCA')
                stats.age.CRIANCA += e.quantity;
            else if (e.ageGroup === 'JOVEM')
                stats.age.JOVEM += e.quantity;
            else
                stats.age.ADULTO += e.quantity;
            if (e.type === 'MEMBER')
                stats.type.MEMBER += e.quantity;
            else
                stats.type.VISITOR += e.quantity;
            // Marketing (Contagem de ocorrências)
            if (e.marketing) {
                stats.marketing[e.marketing] = (stats.marketing[e.marketing] || 0) + e.quantity;
            }
            // Igreja (Contagem de ocorrências)
            if (e.church) {
                stats.church[e.church] = (stats.church[e.church] || 0) + e.quantity;
            }
        });
        res.json({ timeline, checkpointsData });
    }
    catch (error) {
        console.error("Erro fatal dashboard:", error);
        res.status(500).json({ error: "Erro ao processar dados do dashboard" });
    }
}));
// --- ROTAS AUXILIARES ---
// Lista locais
app.get('/checkpoints', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const spots = yield prisma.checkpoint.findMany({ orderBy: { name: 'asc' } });
    res.json(spots);
}));
// Busca pessoas para o Scanner (Inclui flag se já entrou hoje)
app.get('/people', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { search } = req.query;
    if (!search || String(search).length < 3)
        return res.json([]);
    const todayStart = (0, date_fns_1.startOfDay)(new Date());
    const todayEnd = (0, date_fns_1.endOfDay)(new Date());
    const people = yield prisma.person.findMany({
        where: { name: { contains: String(search), mode: 'insensitive' } },
        take: 15, // Aumentei para 15
        include: {
            movements: {
                where: { timestamp: { gte: todayStart, lte: todayEnd } },
                select: { id: true, checkpoint: { select: { name: true } } }
            }
        }
    });
    const result = people.map(p => (Object.assign(Object.assign({}, p), { hasEntered: p.movements.length > 0, lastLocation: p.movements.length > 0 ? p.movements[0].checkpoint.name : null })));
    res.json(result);
}));
// Busca pendências de cadastro (Saneamento)
app.get('/people/incomplete', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const people = yield prisma.person.findMany({
            where: {
                OR: [
                    { gender: null },
                    { phone: null },
                    { marketingSource: null },
                    { age: null }
                ]
            },
            orderBy: { name: 'asc' },
            take: 50
        });
        res.json(people);
    }
    catch (error) {
        res.status(500).json({ error: "Erro ao buscar pendências" });
    }
}));
// Atualiza pessoa (Smart Check-in)
app.put('/person/:id', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    try {
        const updated = yield prisma.person.update({
            where: { id },
            data: req.body
        });
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ error: "Erro update" });
    }
}));
app.post('/register', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const data = RegisterSchema.parse(req.body);
        const user = yield prisma.person.create({
            data: Object.assign(Object.assign({}, data), {
                age: data.age ? Number(data.age) : null,
                // CORREÇÃO AQUI: Forçar o tipo para o Enum do Prisma
                type: data.type, role: data.isStaff ? client_1.Role.STAFF : client_1.Role.PARTICIPANT
            })
        });
        res.json(user);
    }
    catch (e) {
        res.status(400).json({ error: "Erro cadastro", details: e });
    }
}));
// Exportação CSV Completa
app.get('/export', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const people = yield prisma.person.findMany({ orderBy: { createdAt: 'desc' } });
        let csv = "Nome,Idade,Tipo,Genero,Igreja,WhatsApp,Origem,Data Cadastro\n";
        people.forEach(p => {
            const cleanName = p.name ? p.name.replace(/,/g, '') : 'Sem Nome';
            const data = new Date(p.createdAt).toLocaleDateString('pt-BR');
            csv += `${cleanName},${p.age || ''},${p.type},${p.gender || ''},${p.church || ''},${p.phone || ''},${p.marketingSource || ''},${data}\n`;
        });
        res.header('Content-Type', 'text/csv');
        res.attachment('relatorio_geral.csv');
        res.send(csv);
    }
    catch (error) {
        res.status(500).send("Erro ao gerar relatório");
    }
}));
// Rota de Setup (Criação de Tabelas/Locais)
app.get('/setup', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield prisma.checkpoint.createMany({
            data: [
                { name: "Recepção / Entrada", category: CheckpointCategory.GENERAL },
                { name: "Psalms", category: CheckpointCategory.STORE },
                { name: "Salinha Kids", category: CheckpointCategory.KIDS },
                { name: "Tenda de Oração", category: CheckpointCategory.PRAYER },
                { name: "Cantina", category: CheckpointCategory.PRAYER },
                { name: "Casa dos Mártires", category: CheckpointCategory.PRAYER },
                { name: "Sala Profética", category: CheckpointCategory.PROPHETIC },
                { name: "Livraria", category: CheckpointCategory.STORE }
            ],
            skipDuplicates: true
        });
        res.send("Setup OK: Locais criados.");
    }
    catch (e) {
        res.status(500).send("Erro setup: " + e);
    }
}));
// Inicialização
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`🔥 Servidor local rodando na porta ${PORT}`);
    });
}
exports.default = app;
