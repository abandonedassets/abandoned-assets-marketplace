const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// NASA-TITANIC V3.2: INSTITUTIONAL DOMINANCE
const mapStatus = (status, spread) => {
    const s = (status || '').toUpperCase();
    if (s === 'FUNDS_SETTLED' || s === 'SETTLED') return { label: 'FUNDS SETTLED', color: '#00ff00', pulse: false, icon: '💰' };
    if (s === 'AWAITING_TITLE_WIRE' || s === 'ESCROW') return { label: 'AWAITING TITLE WIRE', color: '#ff8c00', pulse: true, icon: '📡' };
    if (s === 'TITLE_OPENED' || s === 'GRABBED') return { label: 'TITLE OPENED (THE GRAB)', color: '#00ffff', pulse: true, icon: '🏗️' };
    if (s === 'MATCH_CONFIRMED') return { label: 'MATCH CONFIRMED', color: '#0047ff', pulse: true, icon: '🤝' };
    
    // LIQUIDITY RADAR: High-Probability Detection
    if (spread > 10000) return { label: 'HIGH-PROBABILITY DEAL', color: '#ff00ff', pulse: true, icon: '🔥' };
    
    return { label: 'SIGNATURES PENDING', color: '#ffffff', pulse: false, icon: '📝' };
};

app.use(express.static('public'));

wss.on('connection', async (ws) => {
    console.log('Juggernaut Handshake: [ESTABLISHED]');
    
    const { data: deals } = await supabase.from('deals_master').select('*');
    const enrichedDeals = (deals || []).map(d => ({
        ...d,
        gross_arbitrage_spread: Math.abs(d.gross_arbitrage_spread),
        meta: mapStatus(d.status, Math.abs(d.gross_arbitrage_spread))
    }));

    ws.send(JSON.stringify({ type: 'INITIAL_LOAD', data: enrichedDeals }));

    const channel = supabase
        .channel('schema-db-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'deals_master' }, (payload) => {
            const deal = payload.new;
            const enriched = {
                ...deal,
                gross_arbitrage_spread: Math.abs(deal.gross_arbitrage_spread),
                meta: mapStatus(deal.status, Math.abs(deal.gross_arbitrage_spread))
            };
            ws.send(JSON.stringify({ type: 'DELTA_UPDATE', data: enriched }));
        })
        .subscribe();

    ws.on('close', () => channel.unsubscribe());
});

server.listen(process.env.PORT || 3000, () => {
    console.log('Juggernaut Cockpit: [V3.2_DOMINANCE_ACTIVE]');
});
