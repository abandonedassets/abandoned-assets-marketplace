<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>ASSET_DEAL_TAPE</title>
    <style>
        body { font-family: monospace; background: #000; color: #0f0; padding: 20px; }
        .deal-card { border: 1px solid #0f0; padding: 15px; margin-bottom: 10px; }
        .error-log { color: #f00; border: 1px solid #f00; padding: 10px; margin-top: 20px; }
    </style>
</head>
<body>
    <h1>// ACTIVE DEAL TAPE</h1>
    <div id="status">STATUS: CONNECTING...</div>
    <div id="marketplace-listings"></div>

    <script>
        async function fetchFeed() {
            try {
                const res = await fetch('/api/terminal-feed');
                const json = await res.json();
                
                if (json.source === 'database') {
                    document.getElementById('status').innerText = "STATUS: ONLINE (LIVE)";
                    document.getElementById('marketplace-listings').innerHTML = json.data.map(item => `
                        <div class="deal-card">ASSET: ${item.address} | BASIS: $${item.purchase_price || 0}</div>
                    `).join('');
                } else {
                    document.getElementById('status').innerHTML = `<div class="error-log">SYSTEM ERROR: ${json.error || 'CONNECTION_REJECTED'}</div>`;
                }
            } catch(e) { 
                document.getElementById('status').innerText = "SYSTEM_FAILURE: UNREACHABLE"; 
            }
        }
        setInterval(fetchFeed, 3000);
        fetchFeed();
    </script>
</body>
</html>
