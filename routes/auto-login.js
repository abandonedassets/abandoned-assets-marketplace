// auto-login.js
// Set your master passcode here
const MASTER_CODE = "12345"; 

async function handleAutoLogin(req, res) {
    const { password } = req.body;

    // If the code matches, let them in
    if (password === MASTER_CODE) {
        return res.status(200).json({ success: true, message: "Access Granted" });
    }
    
    // Otherwise, deny access
    return res.status(401).json({ success: false, message: "Invalid Code" });
}

module.exports = { handleAutoLogin };
