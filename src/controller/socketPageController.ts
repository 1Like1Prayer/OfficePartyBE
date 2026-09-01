import { Request, Response } from 'express';

export const getSocketTestPage = (req: Request, res: Response) => {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Socket.IO Test</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; background: #1a1a2e; color: #eee; }
        h1 { color: #00d9ff; }
        #messages { background: #16213e; padding: 15px; border-radius: 8px; min-height: 200px; }
        p { margin: 5px 0; padding: 8px; background: #0f3460; border-radius: 4px; }
    </style>
</head>
<body>
    <h1>Socket.IO Test</h1>
    <div id="messages"></div>
    
    <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
    <script>
        const socket = io(window.location.origin + '/socket');
        
        socket.on('connect', () => {
            document.getElementById('messages').innerHTML += '<p>✅ Connected!</p>';
        });
        
        socket.on('message', (msg) => {
            document.getElementById('messages').innerHTML += '<p>📨 ' + msg + '</p>';
        });
        
        socket.on('disconnect', () => {
            document.getElementById('messages').innerHTML += '<p>❌ Disconnected</p>';
        });
    </script>
</body>
</html>`;
    
    res.type('html').send(html);
};
