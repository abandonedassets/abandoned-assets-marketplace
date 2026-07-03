const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// NASA-TITANIC V5.0: PREDICTIVE EXECUTION ENGINE (HARDENED V8.0)
const calculateSplashdown = (status, updatedAt) => {
    try {
        const s = (status || '').toUpperCase();
        
        // SAFETY GUARDRAIL: Validate date input
        if (!updatedAt) return null;
        const lastUpdate = new Date(updatedAt);
        
        // ICEBERG DETECTION: Check for invalid dates
        if (isNaN(lastUpdate.getTime())) {
            console.warn(`[HULL_BREACH_DETECTED] Invalid timestamp for status ${s}: ${updatedAt}`);
            return null;
        }
        
        let etaHours = 0;
        if (s === 'AWAITING_TITLE_WIRE' || s === 'ESCROW') etaHours = 24;
        else if (s === 'TITLE_OPENED' || s === 'GRABBED') etaHours = 72;
        else if (s === 'MATCH_CONFIRMED') etaHours = 120;
        else return null;

        const splashdown = new Date(lastUpdate.getTime() + etaHours * 60 * 60 * 1000);
        
        // FINAL SAFETY CHECK: Ensure splashdown is valid
        if (isNaN(splashdown.getTime())) {
            console.warn(`[CALCULATION_ERROR] Failed to calculate splashdown for status ${s}`);
            return null;
        }
        
        return splashdown.toISOString();
    } catch (error) {
        console.error(`[EMERGENCY_PROTOCOL] Splashdown calculation failed:`, error.message);
        return null;
    }
};

const mapStatus = (status, spread, updatedAt) => {
    const s = (status || '').toUpperCase();
    const netProfit = spread * 0.7;
    const taxReserve = spread * 0.3;
    try {
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
    } catch (error) {
        console.error(`[MAPSTATUS_ERROR] Failed to map status:`, error.message);
        return {
            label: 'SYSTEM_ERROR',
            color: '#ff0000',
            pulse: false,
            icon: '⚠️',
            netProfit: '$0.00',
            taxReserve: '$0.00',
            splashdown: 'ERROR: TRAJECTORY UNKNOWN'
        };
    }
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

    const channel = supabase.channel('schema-db-changes');
    channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'deals_master' }, (payload) => {
            const deal = payload.new;
            const enriched = {
                ...deal,
                gross_arbitrage_spread: Math.abs(deal.gross_arbitrage_spread),
                meta: mapStatus(deal.status, Math.abs(deal.gross_arbitrage_spread), deal.updated_at)
            };
            ws.send(JSON.stringify({ type: 'DELTA_UPDATE', data: enriched }));
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('Successfully subscribed to Realtime channel');
            }
        });

    ws.on('close', () => channel.unsubscribe());
});

server.listen(process.env.PORT || 3000, () => {
    console.log('Juggernaut Cockpit: [V5.0_SPLASHDOWN_ACTIVE]');
});
