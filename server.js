import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MercadoPagoConfig, Preference } from 'mercadopago';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.static(__dirname)); // Serve o index.html e CSS da raiz

// --- INICIALIZAÇÃO DO FIREBASE ---
try {
    const firebaseKeyPath = path.join(__dirname, "firebase-key.json");
    if (fs.existsSync(firebaseKeyPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(firebaseKeyPath, "utf8"));
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log("✅ Firebase Admin conectado!");
        }
    } else {
        console.error("❌ Erro: firebase-key.json não encontrado na raiz!");
    }
} catch (error) {
    console.error("❌ Erro ao ler chave do Firebase:", error.message);
}

const db = admin.firestore();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const preference = new Preference(client);

// Middleware de Autenticação
const autenticar = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ erro: "Não autorizado" });
    const token = authHeader.split(" ")[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.uid = decodedToken.uid;
        next();
    } catch (err) {
        res.status(401).json({ erro: "Token inválido" });
    }
};

// ROTA: Envia chaves pro Front-end
app.get("/api/config", (req, res) => {
    res.json({
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID
    });
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// ROTA: Geração de Anúncio
app.post("/api/anuncio", autenticar, async (req, res) => {
    const { produto } = req.body;
    if (!produto) return res.status(400).json({ erro: "Produto é obrigatório" });

    try {
        const userRef = db.collection("usuarios").doc(req.uid);
        const doc = await userRef.get();
        let creditos = doc.exists ? doc.data().creditos : 3;

        if (creditos <= 0) return res.status(403).json({ erro: "Créditos esgotados" });

        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: `Crie um anúncio persuasivo para o produto: ${produto}` }],
        });

        const resultadoIA = completion.choices[0].message.content;
        await userRef.set({ creditos: creditos - 1 }, { merge: true });

        res.json({ resultado: resultadoIA, creditosRestantes: creditos - 1 });
    } catch (err) {
        console.error("Erro na rota de anúncio:", err);
        res.status(500).json({ erro: "Falha na geração" });
    }
});

// ROTA: Checkout Mercado Pago
app.post("/api/pagamento", autenticar, async (req, res) => {
    try {
        const response = await preference.create({
            body: {
                items: [{ title: "🚀 Pack 10 Créditos Hucks IA", quantity: 1, unit_price: 7.99, currency_id: "BRL" }],
                metadata: { uid: req.uid },
                back_urls: { success: "https://therux.netlify.app", failure: "https://therux.netlify.app" },
                auto_return: "approved"
            }
        });
        res.json({ checkout_url: response.init_point });
    } catch (err) {
        res.status(500).json({ erro: "Erro ao gerar pagamento" });
    }
});

app.listen(PORT, () => console.log(`🚀 Hucks IA online na porta ${PORT}`));
