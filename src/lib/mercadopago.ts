import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';

const accessToken = process.env.MP_ACCESS_TOKEN;

if (!accessToken) {
    console.error('❌ MP_ACCESS_TOKEN não configurada');
}

const client = new MercadoPagoConfig({ accessToken: accessToken || '' });

export const mpPreference = new Preference(client);
export const mpPayment = new Payment(client);
