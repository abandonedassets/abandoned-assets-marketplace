// Set your master passcode here
const MASTER_CODE = "12345"; 

async function handleAutoLogin(req, res) {
    const { password } = req.body;

    if (password === MASTER_CODE) {
        // Sets a secure cookie that keeps you logged in
        res.setHeader('Set-Cookie', 'authenticated=true; HttpOnly; Path=/');
        return res.status(200).json({ success: true, message: "Access Granted" });
    }
    
    return res.status(401).json({ success: false, message: "Invalid Code" });
}

module.exports = { handleAutoLogin };
