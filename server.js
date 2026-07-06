const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');
const { fork } = require('child_process');
require('dotenv').config();

// START AUTONOMOUS ENGINES
console.log('Juggernaut Engine: Igniting Autonomous Systems...');
fork('./ingestion-worker.js');
fork('./manus-engine.js');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// SPLASHDOWN DISPLAY FORMATTER (NO TIME MATH - DATA DIRECTLY FROM DATABASE)
const formatSplashdown = (predicted_splashdown) => {
    try {
        // SAFETY CHECK: Validate input
        if (!predicted_splashdown) {
            return 'SCANNING TRAJECTORY...';
        }

        // Parse the timestamp from database (already has correct time from SQL trigger)
        const splashdownDate = new Date(predicted_splashdown);

        // ICEBERG DETECTION: Check for invalid dates
        if (isNaN(splashdownDate.getTime())) {
            console.warn(`[HULL_BREACH_DETECTED] Invalid timestamp from database: ${predicted_splashdown}`);
            return 'SCANNING TRAJECTORY...';
        }

        // Display the database value as-is (no local timezone conversion or manual math)
        // Format: "PREDICTED SPLASHDOWN: Mar 15, 2025, 9:00:00 AM"
        return `PREDICTED SPLASHDOWN: ${splashdownDate.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        })}`;
    } catch (error) {
        console.error(`[SPLASHDOWN_FORMAT_ERROR] Failed to format splashdown:`, error.message);
        return 'ERROR: TRAJECTORY UNKNOWN';
    }
};

const mapStatus = (status, spread, predicted_splashdown) => {
    const s = (status || '').toUpperCase();
    const netProfit = spread * 0.7;
    const taxReserve = spread * 0.3;
    try {
        // Use predicted_splashdown directly from database (no calculation)
        const splashdownDisplay = formatSplashdown(predicted_splashdown);

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
            splashdown: splashdownDisplay
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
        meta: mapStatus(d.status, Math.abs(d.gross_arbitrage_spread), d.predicted_splashdown)
    }));

    ws.send(JSON.stringify({ type: 'INITIAL_LOAD', data: enrichedDeals }));

    const channel = supabase.channel("schema-db-changes");

    channel
      .on("postgres_changes", { event: "*", schema: "public", table: "deals_master" }, (payload) => {
          const enriched = payload.new;
          ws.send(JSON.stringify({ type: "DELTA_UPDATE", data: enriched }));
      })
      .subscribe((status) => {
          if (status === "SUBSCRIBED") {
              console.log("Successfully subscribed to Realtime channel");
          }
      });

    ws.on('close', () => channel.unsubscribe());
});

server.listen(process.env.PORT || 3000, () => {
    console.log('Juggernaut Cockpit: [V5.0_SPLASHDOWN_ACTIVE]');
});
