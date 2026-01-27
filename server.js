import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import admin from "firebase-admin";
import fs from "fs";
import { MercadoPagoConfig, Preference } from 'mercadopago';

dotenv.config();

const app = express();
// A Render define a porta automaticamente, por isso usamos process.env.PORT
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*" }));
app.use(express.json());

// --- CONFIGURAÇÃO FIREBASE ---
const firebaseKeyPath = "./firebase-key.json";
if (fs.existsSync(firebaseKeyPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(firebaseKeyPath, "utf8"));
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
}
const db = admin.firestore();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- CONFIGURAÇÃO MERCADO PAGO ---
// Aqui usamos o seu token APP_USR que agora está protegido pelo link da Render
const client = new MercadoPagoConfig({ 
    accessToken: process.env.MP_ACCESS_TOKEN 
});
const preference = new Preference(client);

// ROTA: CONFIG (Necessária para o Front-end pegar as chaves do Firebase)
app.get("/api/config", (req, res) => {
    res.json({
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID
    });
});

// MIDDLEWARE DE AUTENTICAÇÃO
async function autenticar(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).send("Não autorizado");
    const token = authHeader.split(" ")[1];
    try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.uid = decoded.uid;
        next();
    } catch (err) { res.status(401).send("Token inválido"); }
}

// ROTA: GERAR ANÚNCIO (IA)
app.post("/api/anuncio", autenticar, async (req, res) => {
    try {
        const { produto } = req.body;
        const userRef = db.collection("usuarios").doc(req.uid);
        const doc = await userRef.get();
        let creditos = doc.exists ? doc.data().creditos : 3;

        if (creditos <= 0) return res.status(403).json({ resultado: "Sem créditos" });

        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: `Crie um anúncio persuasivo para: ${produto}` }],
        });

        creditos -= 1;
        await userRef.set({ creditos }, { merge: true });
        res.json({ resultado: completion.choices[0].message.content, creditosRestantes: creditos });
    } catch (err) { 
        console.error("Erro OpenAI:", err);
        res.status(500).json({ erro: "Erro ao gerar anúncio" }); 
    }
});

// ROTA: PAGAMENTO (Mercado Pago)
app.post("/api/pagamento", autenticar, async (req, res) => {
    try {
        const response = await preference.create({
            body: {
                items: [{
                    title: "🚀 Pack 10 Créditos Hucks IA",
                    quantity: 1,
                    unit_price: 7.99,
                    currency_id: "BRL"
                }],
                metadata: { uid: req.uid },
                back_urls: {
                    // Aqui você deve colocar o seu link da NETLIFY quando ele estiver pronto
                    success: "https://seu-site.netlify.app", 
                    failure: "https://seu-site.netlify.app"
                },
                auto_return: "approved"
            }
        });
        
        console.log("✅ Checkout Gerado para:", req.uid);
        res.json({ checkout_url: response.init_point });
    } catch (err) {
        console.error("❌ Erro Mercado Pago:", err);
        res.status(500).json({ error: "Erro ao processar pagamento" });
    }
});

app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));