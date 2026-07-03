const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// NASA-TITANIC V5.0: PREDICTIVE EXECUTION ENGINE
const calculateSplashdown = (status, updatedAt) => {
    const s = (status || '').toUpperCase();
    const lastUpdate = new Date(updatedAt);
    let etaHours = 0;

    if (s === 'AWAITING_TITLE_WIRE' || s === 'ESCROW') etaHours = 24;
    else if (s === 'TITLE_OPENED' || s === 'GRABBED') etaHours = 72;
    else if (s === 'MATCH_CONFIRMED') etaHours = 120;
    else return null;

    const splashdown = new Date(lastUpdate.getTime() + etaHours * 60 * 60 * 1000);
    return splashdown.toISOString();
};

const mapStatus = (status, spread, updatedAt) => {
    const s = (status || '').toUpperCase();
    const netProfit = spread * 0.7;
    const taxReserve = spread * 0.3;
    const splashdown = calculateSplashdown(status, updatedAt);

    let config = { label: 'SIGNATURES PENDING', color: '#ffffff', pulse: false, icon: '📝' };

    if (s === 'FUNDS_SETTLED' || s === 'SETTLED') config = { label: 'FUNDS SETTLED', color: '#00ff00', pulse: false, icon: '💰' };
    else if (s === 'AWAITING_TITLE_WIRE' || s === 'ESCROW') config = { label: 'AWAITING TITLE WIRE', color: '#ff8c00', pulse: true, icon: '📡' };
    else if (s === 'TITLE_OPENED' || s === 'GRABBED') config = { label: 'TITLE OPENED (THE GRAB)', color: '#00ffff', pulse: true, icon: '🏗️' };
    else if (s === 'MATCH_CONFIRMED') config = { label: 'MATCH CONFIRMED', color: '#0047ff', pulse: true, icon: '🤝' };
    else if (spread > 10000) config = { label: 'HIGH-PROBABILITY DEAL', color: '#ff00ff', pulse: true, icon: '🔥' };

    return {
        ...config,
        netProfit: netProfit.toLocaleString('en-US', { style: 'currency', currency: 'USD' }),
        taxReserve: taxReserve.toLocaleString('en-US', { style: 'currency', currency: 'USD' }),
        splashdown: splashdown ? `PREDICTED SPLASHDOWN: ${new Date(splashdown).toLocaleString()}` : 'SCANNING TRAJECTORY...'
    };
};

app.use(express.static('public'));

wss.on('connection', async (ws) => {
    console.log('Juggernaut Handshake: [V5.0_PREDICTIVE_ACTIVE]');
    
    const { data: deals } = await supabase.from('deals_master').select('*');
    const enrichedDeals = (deals || []).map(d => ({
        ...d,
        gross_arbitrage_spread: Math.abs(d.gross_arbitrage_spread),
        meta: mapStatus(d.status, Math.abs(d.gross_arbitrage_spread), d.updated_at)
    }));

    ws.send(JSON.stringify({ type: 'INITIAL_LOAD', data: enrichedDeals }));

    const channel = supabase
        .channel('schema-db-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'deals_master' }, (payload) => {
            const deal = payload.new;
            const enriched = {
                ...deal,
                gross_arbitrage_spread: Math.abs(deal.gross_arbitrage_spread),
                meta: mapStatus(deal.status, Math.abs(deal.gross_arbitrage_spread), deal.updated_at)
            };
            ws.send(JSON.stringify({ type: 'DELTA_UPDATE', data: enriched }));
        })
        .subscribe();

    ws.on('close', () => channel.unsubscribe());
});

server.listen(process.env.PORT || 3000, () => {
    console.log('Juggernaut Cockpit: [V5.0_SPLASHDOWN_ACTIVE]');
});
